/**
 * Five-field cron expression parsing and timezone-aware occurrence computation.
 * Zero-dependency; the only platform API used is Intl for IANA time zones.
 * @module dsh-cron/cron
 */

/** Parsed five-field cron schedule. */
export interface CronSpec {
  /** Sorted unique minute values (0-59). */
  readonly minutes: readonly number[]
  /** Sorted unique hour values (0-23). */
  readonly hours: readonly number[]
  /** Sorted unique month values (1-12). */
  readonly months: readonly number[]
  /** Sorted unique day-of-month values (1-31). */
  readonly doms: readonly number[]
  /** Sorted unique day-of-week values (0-6, 0 = Sunday). */
  readonly dows: readonly number[]
  /** True when the day-of-month field was `*`. */
  readonly domUnrestricted: boolean
  /** True when the day-of-week field was `*`. */
  readonly dowUnrestricted: boolean
  /** The original expression text. */
  readonly source: string
}

/** A rejected cron expression, with the offending field named in the message. */
export class CronParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CronParseError'
  }
}

interface FieldValues {
  readonly values: number[]
  readonly unrestricted: boolean
}

const DIGITS = new RegExp('^\\d+$')
const RANGE = new RegExp('^(\\d+)-(\\d+)$')
const WHITESPACE = new RegExp('\\s+')

function parseField(text: string, field: string, min: number, max: number, normalize?: (value: number) => number): FieldValues {
  const values = new Set<number>()
  let unrestricted = false
  for (const item of text.split(',')) {
    const slash = item.indexOf('/')
    const rangeText = slash === -1 ? item : item.slice(0, slash)
    const stepText = slash === -1 ? undefined : item.slice(slash + 1)
    if (stepText !== undefined && (!DIGITS.test(stepText) || Number(stepText) < 1)) {
      throw new CronParseError(`${field}: invalid step "${stepText}"`)
    }
    const step = stepText === undefined ? 1 : Number(stepText)
    let lo: number
    let hi: number
    if (rangeText === '*') {
      lo = min
      hi = max
      if (step === 1) unrestricted = true
    } else if (DIGITS.test(rangeText)) {
      lo = Number(rangeText)
      // Vixie semantics: "a/n" steps from a through max.
      hi = stepText === undefined ? lo : max
    } else {
      const range = RANGE.exec(rangeText)
      if (range === null) throw new CronParseError(`${field}: invalid term "${item}"`)
      lo = Number(range[1])
      hi = Number(range[2])
      if (lo > hi) throw new CronParseError(`${field}: inverted range "${rangeText}"`)
    }
    for (let value = lo; value <= hi; value += step) {
      const mapped = normalize === undefined ? value : normalize(value)
      if (mapped < min || mapped > max) throw new CronParseError(`${field}: value ${value} out of range ${min}-${max}`)
      values.add(mapped)
    }
  }
  if (values.size === 0) throw new CronParseError(`${field}: empty field`)
  return { values: [...values].sort((a, b) => a - b), unrestricted }
}

/**
 * Parse a five-field cron expression: minute hour day-of-month month day-of-week.
 * Numeric fields only; day-of-week accepts 0-7 with both 0 and 7 as Sunday.
 * @param expression - the cron expression text.
 * @returns the parsed schedule.
 * @throws {CronParseError} when the expression is malformed.
 */
export function parseCronExpression(expression: string): CronSpec {
  const fields = expression.trim().split(WHITESPACE)
  if (fields.length !== 5) {
    throw new CronParseError(`expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`)
  }
  const [minuteText, hourText, domText, monthText, dowText] = fields as [string, string, string, string, string]
  const minutes = parseField(minuteText, 'minute', 0, 59)
  const hours = parseField(hourText, 'hour', 0, 23)
  const doms = parseField(domText, 'day-of-month', 1, 31)
  const months = parseField(monthText, 'month', 1, 12)
  const dows = parseField(dowText, 'day-of-week', 0, 7, value => (value === 7 ? 0 : value))
  return {
    minutes: minutes.values,
    hours: hours.values,
    months: months.values,
    doms: doms.values,
    dows: dows.values,
    domUnrestricted: doms.unrestricted,
    dowUnrestricted: dows.unrestricted,
    source: expression.trim(),
  }
}

/** Validate an IANA time zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

interface ZonedParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly weekday: number
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const formatters = new Map<string, Intl.DateTimeFormat>()

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached !== undefined) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  })
  formatters.set(timeZone, formatter)
  return formatter
}

function zonedParts(timeZone: string, utcMs: number): ZonedParts {
  const parts: Record<string, string> = {}
  for (const part of zonedFormatter(timeZone).formatToParts(utcMs)) {
    parts[part.type] = part.value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? ''] ?? 0,
  }
}

/** Milliseconds between the zoned wall clock and UTC at one instant. */
function offsetMs(timeZone: string, utcMs: number): number {
  const parts = zonedParts(timeZone, utcMs)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(utcMs / 60000) * 60000
}

/**
 * Convert zoned wall-clock fields to a UTC instant. Returns null when the wall
 * time does not exist in the zone (a DST gap); on a DST overlap the earlier of
 * the two valid instants wins.
 */
function zonedToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): number | null {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = guess - offsetMs(timeZone, guess)
  const candidates = [first]
  const secondOffset = offsetMs(timeZone, first)
  if (guess - secondOffset !== first) candidates.push(guess - secondOffset)
  const valid = candidates.filter((instant) => {
    const parts = zonedParts(timeZone, instant)
    return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute
  })
  if (valid.length === 0) return null
  return Math.min(...valid)
}

/** Maximum calendar days searched for the next occurrence (four leap cycles). */
const MAX_SEARCH_DAYS = 366 * 4 + 2

function matchesDay(spec: CronSpec, month: number, dom: number, weekday: number): boolean {
  if (!spec.months.includes(month)) return false
  const domMatch = spec.doms.includes(dom)
  const dowMatch = spec.dows.includes(weekday)
  // Vixie rule: when both day fields are restricted, either match suffices.
  if (!spec.domUnrestricted && !spec.dowUnrestricted) return domMatch || dowMatch
  return domMatch && dowMatch
}

/**
 * Compute the first occurrence strictly after `afterMs`.
 * @param spec - parsed cron schedule.
 * @param afterMs - exclusive lower bound, milliseconds since the epoch.
 * @param timeZone - IANA zone the expression is interpreted in.
 * @returns the occurrence as epoch milliseconds, or null when the schedule has
 *   no occurrence within four leap cycles.
 */
export function nextOccurrence(spec: CronSpec, afterMs: number, timeZone: string): number | null {
  const start = zonedParts(timeZone, afterMs)
  for (let dayOffset = 0; dayOffset < MAX_SEARCH_DAYS; dayOffset++) {
    const dayDate = new Date(Date.UTC(start.year, start.month - 1, start.day + dayOffset))
    const year = dayDate.getUTCFullYear()
    const month = dayDate.getUTCMonth() + 1
    const day = dayDate.getUTCDate()
    // A calendar day that does not exist in the zone (e.g. a skipped date) has
    // no local noon; treat it as unmatchable.
    const noon = zonedToUtc(timeZone, year, month, day, 12, 0)
    if (noon === null) continue
    const weekday = zonedParts(timeZone, noon).weekday
    if (!matchesDay(spec, month, day, weekday)) continue
    for (const hour of spec.hours) {
      if (dayOffset === 0 && hour < start.hour) continue
      for (const minute of spec.minutes) {
        if (dayOffset === 0 && hour === start.hour && minute <= start.minute) continue
        const instant = zonedToUtc(timeZone, year, month, day, hour, minute)
        if (instant !== null && instant > afterMs) return instant
      }
    }
  }
  return null
}
