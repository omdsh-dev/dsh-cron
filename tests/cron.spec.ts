import { describe, expect, it } from 'vitest'
import { CronParseError, isValidTimeZone, nextOccurrence, parseCronExpression } from '../src/cron.ts'

const T = (iso: string): number => Date.parse(iso)
const ISO = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString())

describe('parseCronExpression', () => {
  it('parses wildcards, values, ranges, steps, and lists', () => {
    const spec = parseCronExpression('*/15 9-17/2 1,15 * 1-5')
    expect(spec.minutes).toEqual([0, 15, 30, 45])
    expect(spec.hours).toEqual([9, 11, 13, 15, 17])
    expect(spec.doms).toEqual([1, 15])
    expect(spec.dows).toEqual([1, 2, 3, 4, 5])
    expect(spec.domUnrestricted).toBe(false)
    expect(spec.dowUnrestricted).toBe(false)
  })

  it('maps both 0 and 7 to Sunday and flags unrestricted fields', () => {
    const spec = parseCronExpression('0 0 * * 0,7')
    expect(spec.dows).toEqual([0])
    expect(spec.domUnrestricted).toBe(true)
    expect(spec.dowUnrestricted).toBe(false)
  })

  it('treats "a/n" as stepping from a through the field maximum', () => {
    expect(parseCronExpression('5/20 * * * *').minutes).toEqual([5, 25, 45])
  })

  it('rejects malformed expressions', () => {
    expect(() => parseCronExpression('* * * *')).toThrow(CronParseError)
    expect(() => parseCronExpression('61 * * * *')).toThrow('minute: value 61')
    expect(() => parseCronExpression('0 24 * * *')).toThrow('hour: value 24')
    expect(() => parseCronExpression('0 0 32 * *')).toThrow('day-of-month')
    expect(() => parseCronExpression('0 0 * 13 *')).toThrow('month')
    expect(() => parseCronExpression('0 0 * * 8')).toThrow('day-of-week')
    expect(() => parseCronExpression('5-1 * * * *')).toThrow('inverted range')
    expect(() => parseCronExpression('*/0 * * * *')).toThrow('invalid step')
    expect(() => parseCronExpression('a b c d e')).toThrow(CronParseError)
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects others', () => {
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })
})

describe('nextOccurrence', () => {
  it('finds the next daily occurrence in UTC', () => {
    const spec = parseCronExpression('0 9 * * *')
    expect(ISO(nextOccurrence(spec, T('2026-08-15T08:00:00Z'), 'UTC'))).toBe('2026-08-15T09:00:00.000Z')
    expect(ISO(nextOccurrence(spec, T('2026-08-15T09:00:00.001Z'), 'UTC'))).toBe('2026-08-16T09:00:00.000Z')
  })

  it('honours weekday ranges across weekends', () => {
    const spec = parseCronExpression('0 9 * * 1-5')
    // 2026-08-14 is a Friday; after Friday 10:00 the next hit is Monday.
    expect(ISO(nextOccurrence(spec, T('2026-08-14T10:00:00Z'), 'UTC'))).toBe('2026-08-17T09:00:00.000Z')
  })

  it('applies the Vixie OR rule when both day fields are restricted', () => {
    const spec = parseCronExpression('0 0 13 * 5')
    // 2026-08-15 is a Saturday: next matches are Friday 2026-08-21, then 2026-08-28.
    expect(ISO(nextOccurrence(spec, T('2026-08-15T00:00:00Z'), 'UTC'))).toBe('2026-08-21T00:00:00.000Z')
    expect(ISO(nextOccurrence(spec, T('2026-08-21T00:00:00Z'), 'UTC'))).toBe('2026-08-28T00:00:00.000Z')
  })

  it('interprets expressions in the requested IANA zone', () => {
    const spec = parseCronExpression('0 9 * * *')
    // Asia/Shanghai is UTC+8 with no DST.
    expect(ISO(nextOccurrence(spec, T('2026-08-15T00:30:00Z'), 'Asia/Shanghai'))).toBe('2026-08-15T01:00:00.000Z')
  })

  it('skips wall times inside a spring-forward gap', () => {
    const spec = parseCronExpression('30 2 * * *')
    // America/New_York springs forward on 2026-03-08: 02:30 does not exist.
    expect(ISO(nextOccurrence(spec, T('2026-03-07T12:00:00Z'), 'America/New_York'))).toBe('2026-03-09T06:30:00.000Z')
  })

  it('chooses the earlier instant inside a fall-back overlap', () => {
    const spec = parseCronExpression('30 1 * * *')
    // America/New_York falls back on 2026-11-01: 01:30 happens twice; EDT wins.
    expect(ISO(nextOccurrence(spec, T('2026-10-31T12:00:00Z'), 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z')
  })

  it('finds rare calendar dates within the search horizon', () => {
    const spec = parseCronExpression('0 0 29 2 *')
    expect(ISO(nextOccurrence(spec, T('2026-01-01T00:00:00Z'), 'UTC'))).toBe('2028-02-29T00:00:00.000Z')
  })
})
