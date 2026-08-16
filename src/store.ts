/**
 * Durable JSON job store for dsh-cron. One atomic-write file holds every job;
 * the file is the source of truth and in-memory state is its projection.
 * @module dsh-cron/store
 */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { dirname } from 'node:path'

/** One-shot absolute schedule, RFC 3339 UTC. */
export interface AtSchedule {
  readonly kind: 'at'
  readonly at: string
}

/** Recurring five-field cron schedule interpreted in one IANA zone. */
export interface CronSchedule {
  readonly kind: 'cron'
  readonly expression: string
  readonly timeZone: string
}

/** Job schedule union persisted in the store. */
export type JobSchedule = AtSchedule | CronSchedule

/** The recorded outcome of one dispatch. */
export interface CronRunRecord {
  /** RFC 3339 UTC dispatch time. */
  readonly firedAt: string
  /** RFC 3339 UTC turn completion; absent while pending. */
  readonly completedAt?: string
  /** `delivered` while the turn runs; final states: completed/error/cancelled/timeout. */
  readonly outcome: 'delivered' | 'completed' | 'error' | 'cancelled' | 'timeout'
  /** Leading excerpt of the turn's assistant text (bounded). */
  readonly excerpt?: string
}

/** One durable scheduled job. */
export interface CronJob {
  /** Stable store-local id, never reused within one store file. */
  readonly id: string
  /** Task prompt delivered when the schedule fires. */
  readonly prompt: string
  readonly schedule: JobSchedule
  /** Session id of the creating agent, preferred at dispatch; null when unknown. */
  readonly createdBy: string | null
  /** RFC 3339 UTC creation time. */
  readonly createdAt: string
  /** RFC 3339 UTC of the next pending fire; in the past while overdue. */
  nextAt: string
  /** RFC 3339 UTC of the most recent dispatch, or null. */
  lastFiredAt: string | null
  /** Number of completed dispatches. */
  fireCount: number
  /** `done` one-shots stay in the store as history; they never fire again. */
  state: 'active' | 'done'
  /** Paused jobs are kept but excluded from dispatch. */
  paused: boolean
  /** The most recent dispatch outcome, or null. */
  lastRun: CronRunRecord | null
}

const STORE_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidJob(value: unknown): value is CronJob {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || typeof value.prompt !== 'string') return false
  if (typeof value.nextAt !== 'string' || typeof value.createdAt !== 'string') return false
  if (value.createdBy !== null && typeof value.createdBy !== 'string') return false
  if (value.lastFiredAt !== null && typeof value.lastFiredAt !== 'string') return false
  if (typeof value.fireCount !== 'number') return false
  // Fields introduced after the first store version normalize on load.
  if (value.state !== undefined && value.state !== 'active' && value.state !== 'done') return false
  if (value.paused !== undefined && typeof value.paused !== 'boolean') return false
  if (value.lastRun !== undefined && value.lastRun !== null && !isRecord(value.lastRun)) return false
  const schedule = value.schedule
  if (!isRecord(schedule)) return false
  if (schedule.kind === 'at') return typeof schedule.at === 'string'
  if (schedule.kind === 'cron') return typeof schedule.expression === 'string' && typeof schedule.timeZone === 'string'
  return false
}

/** Fill fields introduced after the first store version. */
function normalizeJob(job: CronJob): CronJob {
  job.state ??= 'active'
  job.paused ??= false
  job.lastRun ??= null
  return job
}

/**
 * JSON-file job store. Writes are atomic (temporary file plus rename). A
 * corrupt store file is quarantined aside and the store starts empty, because
 * a plugin must not take down the whole host boot.
 */
export class CronStore {
  private seq = 0
  private jobList: CronJob[] = []
  private watcher: ReturnType<typeof setInterval> | null = null
  private lastWritten: string | null = null
  private lastStat: { mtimeMs: number; size: number } | null = null

  /**
   * @param filePath - absolute path of the JSON store file.
   * @param warn - sink for recoverable store problems (quarantine, dropped entries).
   */
  constructor(
    private readonly filePath: string,
    private readonly warn: (message: string) => void,
  ) {}

  /** Load the store from disk; a missing file means an empty store. */
  load(): void {
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    this.lastWritten = raw
    this.applyRaw(raw, false)
  }

  /**
   * Replace the in-memory projection with the given file content. Hot reloads
   * (external writes from another process sharing this store) degrade to a
   * warning on an unsupported format instead of failing the host boot.
   */
  private applyRaw(raw: string, hot: boolean): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      const quarantine = `${this.filePath}.corrupt-${Date.now()}`
      renameSync(this.filePath, quarantine)
      this.warn(`dsh-cron: corrupt job store moved to ${quarantine}; starting empty`)
      return
    }
    if (!isRecord(parsed) || parsed.version !== STORE_VERSION || !Array.isArray(parsed.jobs)) {
      if (hot) {
        this.warn(`dsh-cron: unsupported job store format in ${this.filePath}; keeping current state`)
        return
      }
      throw new Error(`dsh-cron: unsupported job store format in ${this.filePath}`)
    }
    const jobs: CronJob[] = []
    const ids = new Set<string>()
    for (const entry of parsed.jobs) {
      if (!isValidJob(entry) || ids.has(entry.id)) {
        this.warn('dsh-cron: dropped invalid or duplicate job entry from the store')
        continue
      }
      ids.add(entry.id)
      jobs.push(normalizeJob(entry))
    }
    this.jobList = jobs
    this.seq = typeof parsed.seq === 'number' && Number.isSafeInteger(parsed.seq) ? parsed.seq : jobs.length
  }

  /** List jobs in insertion order. */
  list(): readonly CronJob[] {
    return this.jobList
  }

  /** Find one job by id. */
  get(id: string): CronJob | undefined {
    return this.jobList.find(job => job.id === id)
  }

  /** Allocate the next never-reused job id. */
  allocateId(): string {
    this.seq += 1
    return `cron-${this.seq}`
  }

  /** Insert a job and persist. */
  insert(job: CronJob): void {
    this.jobList.push(job)
    this.persist()
  }

  /** Remove a job by id and persist; returns false when unknown. */
  remove(id: string): boolean {
    const index = this.jobList.findIndex(job => job.id === id)
    if (index === -1) return false
    this.jobList.splice(index, 1)
    this.persist()
    return true
  }

  /** Persist after an in-place job mutation. */
  flush(): void {
    this.persist()
  }

  /**
   * Watch the store file for external changes (another dsh process sharing
   * this Harness home) and hot-reload the in-memory projection. Polling is
   * used instead of `fs.watch`: libuv's fs-event on Windows aborts the
   * process when the watched directory is deleted, which the tests' teardown
   * (and a removed data dir in production) would trigger. Self-writes are
   * recognized by content equality and skipped. Returns a disposer.
   * @param onReload - called once per applied external reload.
   * @param intervalMs - poll interval; tests use a short one.
   */
  watch(onReload?: (jobs: number) => void, intervalMs = 500): () => void {
    if (this.watcher !== null) return () => {}
    const timer = setInterval(() => this.poll(onReload), intervalMs)
    // Do not keep a one-shot headless process alive just for the watcher.
    timer.unref()
    this.watcher = timer
    return () => this.stopWatch()
  }

  /** One poll tick: reload when the file changed since our last sighting. */
  private poll(onReload?: (jobs: number) => void): void {
    if (this.watcher === null) return
    let stat: Stats
    try {
      stat = statSync(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.lastStat = null
        return
      }
      this.warn(`dsh-cron: job store watch stat failed: ${String(error)}`)
      return
    }
    const sighting = { mtimeMs: stat.mtimeMs, size: stat.size }
    if (this.lastStat !== null && this.lastStat.mtimeMs === sighting.mtimeMs && this.lastStat.size === sighting.size) return
    this.lastStat = sighting
    if (!this.reloadIfChanged()) return
    if (onReload !== undefined) onReload(this.jobList.length)
  }

  /** Whether the file changed since our last write; reloads when it did. */
  private reloadIfChanged(): boolean {
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.warn(`dsh-cron: job store watch read failed: ${String(error)}`)
      }
      return false
    }
    if (raw === this.lastWritten) return false
    this.lastWritten = raw
    this.applyRaw(raw, true)
    return true
  }

  private stopWatch(): void {
    if (this.watcher !== null) {
      clearInterval(this.watcher)
      this.watcher = null
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const payload = JSON.stringify({ version: STORE_VERSION, seq: this.seq, jobs: this.jobList }, null, 2)
    const content = `${payload}\n`
    this.lastWritten = content
    const temporary = `${this.filePath}.tmp-${process.pid}`
    writeFileSync(temporary, content)
    renameSync(temporary, this.filePath)
  }
}
