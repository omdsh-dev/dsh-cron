/**
 * Scheduling runtime: turns the durable job store into timers and deliveries.
 * All host contact goes through the injected boundary so tests can fake
 * clocks, timers, and agents.
 * @module dsh-cron/scheduler
 */

import { isValidTimeZone, nextOccurrence, parseCronExpression, type CronSpec } from './cron.ts'
import type { CronJob, CronStore, JobSchedule } from './store.ts'

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
  add(input: AddJobInput): CronJob
  /** Remove a job by id. */
  remove(id: string): boolean
  /** List all jobs. */
  list(): readonly CronJob[]
}

/** Largest delay accepted by a Node timer; longer waits are segmented. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Re-check floor for overdue jobs that found no dispatch target. */
const OVERDUE_RETRY_MS = 60_000

/**
 * The cron scheduler. Durable state lives in the store; the timer and
 * dispatch bookkeeping are disposable projections rebuilt on start.
 */
export class CronScheduler {
  private cancelTimer: (() => void) | null = null
  private firing = false
  private pendingFire = false
  private readonly specs = new Map<string, CronSpec>()

  constructor(private readonly options: CronSchedulerOptions) {}

  /** Service view published to other plugins. */
  service(): CronService {
    return {
      add: input => this.addJob(input),
      remove: id => this.removeJob(id),
      list: () => this.listJobs(),
    }
  }

  /** Arm the timer and dispatch anything already due. */
  start(): void {
    this.requestFire()
  }

  /** Cancel the timer; durable jobs are untouched. */
  stop(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  /** Re-check due jobs, e.g. when a new live target appears. */
  notifyTargets(): void {
    this.requestFire()
  }

  /** List jobs in insertion order. */
  listJobs(): readonly CronJob[] {
    return this.options.store.list()
  }

  /**
   * Validate and persist a new job.
   * @param input - the schedule request.
   * @returns the durable job.
   * @throws {Error} with a stable reason code prefix (`invalid_prompt`,
   *   `invalid_selector`, `invalid_cron_expression`, `invalid_time_zone`,
   *   `not_future`, `too_frequent`, `too_many_jobs`, `schedule_unreachable`).
   */
  addJob(input: AddJobInput): CronJob {
    const { store } = this.options
    const prompt = input.prompt.trim()
    if (prompt.length === 0) throw new Error('invalid_prompt: prompt must be non-blank')
    const hasCron = typeof input.cron === 'string' && input.cron.trim().length > 0
    const hasAt = typeof input.at === 'string' && input.at.trim().length > 0
    if (hasCron === hasAt) throw new Error('invalid_selector: exactly one of cron or at is required')
    if (store.list().length >= this.options.maxJobs) {
      throw new Error(`too_many_jobs: at most ${this.options.maxJobs} jobs are allowed`)
    }
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
      const atMs = Date.parse(at)
      if (Number.isNaN(atMs)) throw new Error(`invalid_selector: unparseable RFC 3339 time "${at}"`)
      if (atMs <= now) throw new Error('not_future: at must be in the future')
      schedule = { kind: 'at', at: new Date(atMs).toISOString() }
      nextAtMs = atMs
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
    }
    store.insert(job)
    if (spec !== null) this.specs.set(job.id, spec)
    this.arm()
    return job
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

  private specFor(job: CronJob): CronSpec | null {
    if (job.schedule.kind !== 'cron') return null
    const cached = this.specs.get(job.id)
    if (cached !== undefined) return cached
    const spec = parseCronExpression(job.schedule.expression)
    this.specs.set(job.id, spec)
    return spec
  }

  private arm(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
    let earliest: number | null = null
    for (const job of this.options.store.list()) {
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
    const { store } = this.options
    const now = this.options.now()
    const due = store.list()
      .filter(job => Date.parse(job.nextAt) <= now)
      .sort((a, b) => Date.parse(a.nextAt) - Date.parse(b.nextAt))
    for (const job of due) {
      let target = this.pickTarget(job)
      if (target === undefined && this.options.wakeCold !== undefined && job.createdBy !== null) {
        try {
          target = await this.options.wakeCold(job) ?? undefined
        } catch (error) {
          this.options.warn?.(`dsh-cron: cold wake failed for ${job.id}: ${error instanceof Error ? error.message : String(error)}`)
          target = undefined
        }
      }
      if (target === undefined) continue
      const scheduledAt = job.nextAt
      try {
        this.options.deliver(target, this.options.buildMessage(job, scheduledAt))
      } catch (error) {
        // A rejected enqueue keeps the job overdue for a later pass.
        this.options.warn?.(`dsh-cron: delivery failed for ${job.id}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      job.lastFiredAt = new Date(now).toISOString()
      job.fireCount += 1
      if (job.schedule.kind === 'at') {
        store.remove(job.id)
        this.specs.delete(job.id)
        continue
      }
      const spec = this.specFor(job)
      // Latest-only catch-up: missed occurrences are collapsed, never replayed.
      const next = spec === null ? null : nextOccurrence(spec, now, job.schedule.timeZone)
      if (next === null) {
        store.remove(job.id)
        this.specs.delete(job.id)
      } else {
        job.nextAt = new Date(next).toISOString()
      }
    }
    if (due.length > 0) store.flush()
  }
}
