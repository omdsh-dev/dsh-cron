/**
 * Scheduling runtime: turns the durable job store into timers and deliveries.
 * All host contact goes through the injected boundary so tests can fake
 * clocks, timers, and agents.
 * @module dsh-cron/scheduler
 */

import { isValidTimeZone, nextOccurrence, parseCronExpression, type CronSpec } from './cron.ts'
import type { CronJob, CronRunRecord, CronStore, JobSchedule } from './store.ts'

/** A live agent that can receive a scheduled task. */
export interface CronTarget {
  readonly id: string
  /** Agent status; `'idle'` receives a follow-up turn, anything else an inject. */
  readonly status: string
  followup(message: unknown): void
  inject(message: unknown): void
}

/** Input accepted from tools, commands, and the provided `cron` service. */
export interface AddJobInput {
  /** Task prompt delivered when the schedule fires. */
  readonly prompt: string
  /** Five-field cron expression; exactly one of `cron` / `at` is required. */
  readonly cron?: string
  /** IANA zone for `cron`; defaults to the configured default zone. */
  readonly timeZone?: string
  /** One-shot RFC 3339 target with an explicit offset or `Z`. */
  readonly at?: string
  /** Creating session id, preferred at dispatch. */
  readonly createdBy?: string | null
}

/** Result of adding a job. */
export interface AddJobResult {
  readonly job: CronJob
  /** True when an identical active job already existed; nothing was inserted. */
  readonly deduplicated: boolean
  /** The next fire times (up to three), RFC 3339 UTC. */
  readonly nextOccurrences: readonly string[]
}

/** Host boundary injected into the scheduler. */
export interface CronSchedulerOptions {
  readonly store: CronStore
  /** Wall clock in epoch milliseconds. */
  now(): number
  /** Live dispatch targets, in preference order. */
  targets(): readonly CronTarget[]
  /** Build the model-facing message for one due job. */
  buildMessage(job: CronJob, scheduledAt: string): unknown
  /** Deliver a built message to one target. */
  deliver(target: CronTarget, message: unknown): void
  /** Called after each successful delivery so the host can track the turn. */
  readonly onDispatched?: ((job: CronJob, target: CronTarget) => void) | undefined
  /** Arm a one-shot timer; the return value cancels it. */
  armTimer(callback: () => void, delayMs: number): () => void
  /**
   * Wake a due job's cold creating session and return it as a target, or null
   * to leave the job overdue. Absent disables cold wake entirely.
   */
  readonly wakeCold?: ((job: CronJob) => Promise<CronTarget | null>) | undefined
  /** Log a recoverable scheduling problem. */
  readonly warn?: ((message: string) => void) | undefined
  readonly defaultTimeZone: string
  readonly maxJobs: number
  readonly minIntervalMinutes: number
}

/** Programmatic service published as `ctx.cron` for other plugins. */
export interface CronService {
  /** Add a job; throws an `Error` prefixed with a stable reason code. */
  add(input: AddJobInput): AddJobResult
  /** Remove a job by id. */
  remove(id: string): boolean
  /** List all jobs, including done history. */
  list(): readonly CronJob[]
  /** Dispatch one job immediately, independent of its schedule. */
  fireNow(id: string): Promise<'fired' | 'not_found' | 'no_target'>
  /** Pause or resume a job; returns false when unknown or already done. */
  setPaused(id: string, paused: boolean): boolean
}

/** Largest delay accepted by a Node timer; longer waits are segmented. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Re-check floor for overdue jobs that found no dispatch target. */
const OVERDUE_RETRY_MS = 60_000

/** Strict RFC 3339 with an explicit offset or Z; no local-time guessing. */
const STRICT_AT = new RegExp('^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?(Z|[+-]\\d{2}:\\d{2})$')

/**
 * The cron scheduler. Durable state lives in the store; the timer and
 * dispatch bookkeeping are disposable projections rebuilt on start.
 */
export class CronScheduler {
  private cancelTimer: (() => void) | null = null
  private firing = false
  private pendingFire = false
  private running = false
  private readonly specs = new Map<string, CronSpec>()

  constructor(private readonly options: CronSchedulerOptions) {}

  /** Service view published to other plugins. */
  service(): CronService {
    return {
      add: input => this.addJob(input),
      remove: id => this.removeJob(id),
      list: () => this.listJobs(),
      fireNow: id => this.fireNow(id),
      setPaused: (id, paused) => this.setPaused(id, paused),
    }
  }

  /** Arm the timer and dispatch anything already due. */
  start(): void {
    this.running = true
    this.requestFire()
  }

  /** Cancel the timer; durable jobs are untouched. */
  stop(): void {
    this.running = false
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  /**
   * Reconsider dispatch after the store gained or lost jobs through a hot
   * reload: the timer is armed from the job list, so a store change without a
   * local mutation would otherwise leave the scheduler asleep. No-op while not
   * running, so passive instances never double-dispatch.
   */
  storeChanged(): void {
    if (this.running) this.requestFire()
  }

  /** Re-check due jobs, e.g. when a new live target appears. */
  notifyTargets(): void {
    this.requestFire()
  }

  /** List jobs in insertion order, including done history. */
  listJobs(): readonly CronJob[] {
    return this.options.store.list()
  }

  /**
   * Validate and persist a new job.
   * @param input - the schedule request.
   * @returns the job with dedupe and preview metadata.
   * @throws {Error} with a stable reason code prefix (`invalid_prompt`,
   *   `invalid_selector`, `invalid_cron_expression`, `invalid_time_zone`,
   *   `not_future`, `too_frequent`, `too_many_jobs`, `schedule_unreachable`).
   */
  addJob(input: AddJobInput): AddJobResult {
    const { store } = this.options
    const prompt = input.prompt.trim()
    if (prompt.length === 0) throw new Error('invalid_prompt: prompt must be non-blank')
    const hasCron = typeof input.cron === 'string' && input.cron.trim().length > 0
    const hasAt = typeof input.at === 'string' && input.at.trim().length > 0
    if (hasCron === hasAt) throw new Error('invalid_selector: exactly one of cron or at is required')
    const now = this.options.now()
    let schedule: JobSchedule
    let nextAtMs: number
    let spec: CronSpec | null = null
    if (hasCron) {
      const expression = (input.cron as string).trim()
      const timeZone = input.timeZone?.trim() ?? this.options.defaultTimeZone
      spec = parseCronExpression(expression)
      if (!isValidTimeZone(timeZone)) throw new Error(`invalid_time_zone: unknown IANA time zone "${timeZone}"`)
      const first = nextOccurrence(spec, now, timeZone)
      if (first === null) throw new Error('schedule_unreachable: no occurrence within four years')
      const second = nextOccurrence(spec, first, timeZone)
      if (second !== null && second - first < this.options.minIntervalMinutes * 60_000) {
        throw new Error(`too_frequent: occurrences must be at least ${this.options.minIntervalMinutes} minute(s) apart`)
      }
      schedule = { kind: 'cron', expression, timeZone }
      nextAtMs = first
    } else {
      const at = (input.at as string).trim()
      if (!STRICT_AT.test(at)) {
        throw new Error(`invalid_selector: at must be RFC 3339 with an explicit offset or Z, got "${at}"`)
      }
      const atMs = Date.parse(at)
      if (Number.isNaN(atMs)) throw new Error(`invalid_selector: unparseable RFC 3339 time "${at}"`)
      if (atMs <= now) throw new Error('not_future: at must be in the future')
      schedule = { kind: 'at', at: new Date(atMs).toISOString() }
      nextAtMs = atMs
    }

    // An identical live job (same prompt and schedule) is reused, not duplicated.
    const scheduleJson = JSON.stringify(schedule)
    const duplicate = store.list().find(job =>
      job.state === 'active' && job.prompt === prompt && JSON.stringify(job.schedule) === scheduleJson)
    if (duplicate !== undefined) {
      return { job: duplicate, deduplicated: true, nextOccurrences: this.preview(duplicate, 3) }
    }

    const active = store.list().filter(job => job.state === 'active').length
    if (active >= this.options.maxJobs) {
      throw new Error(`too_many_jobs: at most ${this.options.maxJobs} active jobs are allowed`)
    }
    const job: CronJob = {
      id: store.allocateId(),
      prompt,
      schedule,
      createdBy: input.createdBy ?? null,
      createdAt: new Date(now).toISOString(),
      nextAt: new Date(nextAtMs).toISOString(),
      lastFiredAt: null,
      fireCount: 0,
      state: 'active',
      paused: false,
      lastRun: null,
    }
    store.insert(job)
    if (spec !== null) this.specs.set(job.id, spec)
    this.arm()
    return { job, deduplicated: false, nextOccurrences: this.preview(job, 3) }
  }

  /** Remove a job by id; returns false when unknown. */
  removeJob(id: string): boolean {
    const removed = this.options.store.remove(id)
    if (removed) {
      this.specs.delete(id)
      this.arm()
    }
    return removed
  }

  /**
   * Pause or resume a job. Resuming a recurring job moves its next fire past
   * now (no catch-up); resuming an overdue one-shot fires it on the next pass.
   * @returns false when the job is unknown or already done.
   */
  setPaused(id: string, paused: boolean): boolean {
    const job = this.options.store.get(id)
    if (job === undefined || job.state === 'done') return false
    if (job.paused === paused) return true
    job.paused = paused
    if (!paused && job.schedule.kind === 'cron') {
      const spec = this.specFor(job)
      const next = spec === null ? null : nextOccurrence(spec, this.options.now(), job.schedule.timeZone)
      if (next === null) {
        job.state = 'done'
      } else {
        job.nextAt = new Date(next).toISOString()
      }
    }
    this.options.store.flush()
    this.arm()
    return true
  }

  /**
   * Dispatch one job immediately through the ordinary delivery path. A fired
   * one-shot becomes done; a recurring job advances to its next occurrence.
   */
  async fireNow(id: string): Promise<'fired' | 'not_found' | 'no_target'> {
    const job = this.options.store.get(id)
    if (job === undefined || job.state === 'done') return 'not_found'
    const result = await this.dispatchJob(job, this.options.now())
    this.options.store.flush()
    this.arm()
    return result
  }

  /** Record the settled outcome of one dispatch; unknown jobs are dropped. */
  recordRun(id: string, run: CronRunRecord): void {
    const job = this.options.store.get(id)
    if (job === undefined) return
    job.lastRun = run
    this.options.store.flush()
  }

  /** The next fire times of a job, for previews. */
  private preview(job: CronJob, count: number): readonly string[] {
    const times: string[] = []
    if (job.schedule.kind === 'at') {
      if (job.state === 'active') times.push(job.nextAt)
      return times
    }
    const spec = this.specFor(job)
    if (spec === null) return times
    let cursor = Date.parse(job.nextAt) - 1
    for (let index = 0; index < count; index++) {
      const next = nextOccurrence(spec, cursor, job.schedule.timeZone)
      if (next === null) break
      times.push(new Date(next).toISOString())
      cursor = next
    }
    return times
  }

  private specFor(job: CronJob): CronSpec | null {
    if (job.schedule.kind !== 'cron') return null
    const cached = this.specs.get(job.id)
    if (cached !== undefined) return cached
    const spec = parseCronExpression(job.schedule.expression)
    this.specs.set(job.id, spec)
    return spec
  }

  /** Jobs eligible for dispatch right now. */
  private dueJobs(now: number): CronJob[] {
    return this.options.store.list()
      .filter(job => job.state === 'active' && !job.paused && Date.parse(job.nextAt) <= now)
      .sort((a, b) => Date.parse(a.nextAt) - Date.parse(b.nextAt))
  }

  private arm(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
    let earliest: number | null = null
    for (const job of this.options.store.list()) {
      if (job.state !== 'active' || job.paused) continue
      const at = Date.parse(job.nextAt)
      if (earliest === null || at < earliest) earliest = at
    }
    if (earliest === null) return
    const raw = earliest - this.options.now()
    // An overdue job that found no target retries on a bounded floor instead
    // of spinning a zero-delay timer loop.
    const delay = Math.min(raw > 0 ? raw : OVERDUE_RETRY_MS, MAX_TIMER_DELAY_MS)
    this.cancelTimer = this.options.armTimer(() => {
      this.cancelTimer = null
      this.requestFire()
    }, delay)
  }

  /** Run one dispatch pass, serialized; concurrent requests coalesce. */
  private requestFire(): void {
    if (this.firing) {
      this.pendingFire = true
      return
    }
    this.firing = true
    void this.runFireDue().then(
      () => {
        this.firing = false
        if (this.pendingFire) {
          this.pendingFire = false
          this.requestFire()
          return
        }
        this.arm()
      },
      (error: unknown) => {
        this.firing = false
        this.options.warn?.(`dsh-cron: dispatch pass failed: ${error instanceof Error ? error.message : String(error)}`)
        this.arm()
      },
    )
  }

  private pickTarget(job: CronJob): CronTarget | undefined {
    const targets = this.options.targets()
    if (targets.length === 0) return undefined
    const owned = job.createdBy === null ? undefined : targets.find(target => target.id === job.createdBy)
    if (owned !== undefined) return owned
    return targets.find(target => target.status === 'idle') ?? targets[0]
  }

  private async runFireDue(): Promise<void> {
    const now = this.options.now()
    const due = this.dueJobs(now)
    for (const job of due) {
      await this.dispatchJob(job, now)
    }
    if (due.length > 0) this.options.store.flush()
  }

  /**
   * Dispatch one due job: pick or wake a target, deliver, then advance or
   * retire the schedule. Returns the outcome for direct callers.
   */
  private async dispatchJob(job: CronJob, now: number): Promise<'fired' | 'no_target'> {
    let target = this.pickTarget(job)
    if (target === undefined && this.options.wakeCold !== undefined && job.createdBy !== null) {
      try {
        target = await this.options.wakeCold(job) ?? undefined
      } catch (error) {
        this.options.warn?.(`dsh-cron: cold wake failed for ${job.id}: ${error instanceof Error ? error.message : String(error)}`)
        target = undefined
      }
    }
    if (target === undefined) return 'no_target'
    const scheduledAt = job.nextAt
    try {
      this.options.deliver(target, this.options.buildMessage(job, scheduledAt))
    } catch (error) {
      // A rejected enqueue keeps the job overdue for a later pass.
      this.options.warn?.(`dsh-cron: delivery failed for ${job.id}: ${error instanceof Error ? error.message : String(error)}`)
      return 'no_target'
    }
    job.lastFiredAt = new Date(now).toISOString()
    job.fireCount += 1
    this.options.onDispatched?.(job, target)
    if (job.schedule.kind === 'at') {
      // One-shots stay in the store as done history so their last run remains visible.
      job.state = 'done'
      this.specs.delete(job.id)
      return 'fired'
    }
    const spec = this.specFor(job)
    // Latest-only catch-up: missed occurrences are collapsed, never replayed.
    const next = spec === null ? null : nextOccurrence(spec, now, job.schedule.timeZone)
    if (next === null) {
      job.state = 'done'
      this.specs.delete(job.id)
    } else {
      job.nextAt = new Date(next).toISOString()
    }
    return 'fired'
  }
}
