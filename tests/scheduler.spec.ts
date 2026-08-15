import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CronScheduler, type CronTarget } from '../src/scheduler.ts'
import { CronStore } from '../src/store.ts'

function makeTarget(id: string, status: string) {
  return {
    id,
    status,
    followup: vi.fn<(message: unknown) => void>(),
    inject: vi.fn<(message: unknown) => void>(),
  }
}

/** Flush the scheduler's post-pass microtasks. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('CronScheduler', () => {
  let dir: string
  let store: CronStore
  let now: number
  let timerCallback: (() => void) | null
  let timerDelay: number | null
  let targets: CronTarget[]
  const delivered: Array<{ target: string; message: unknown }> = []

  function makeScheduler(overrides: Partial<ConstructorParameters<typeof CronScheduler>[0]> = {}): CronScheduler {
    return new CronScheduler({
      store,
      now: () => now,
      targets: () => targets,
      buildMessage: (job, scheduledAt) => ({ job: job.id, scheduledAt }),
      deliver: (target, message) => {
        delivered.push({ target: target.id, message })
        if (target.status === 'idle') target.followup(message)
        else target.inject(message)
      },
      armTimer: (callback, delayMs) => {
        timerCallback = callback
        timerDelay = delayMs
        return () => { timerCallback = null }
      },
      defaultTimeZone: 'UTC',
      maxJobs: 3,
      minIntervalMinutes: 5,
      ...overrides,
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-cron-sched-'))
    store = new CronStore(join(dir, 'jobs.json'), () => {})
    store.load()
    now = Date.parse('2026-08-15T08:00:00Z')
    timerCallback = null
    timerDelay = null
    targets = []
    delivered.length = 0
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('arms the timer for the earliest pending job on add', () => {
    const scheduler = makeScheduler()
    scheduler.start()
    const job = scheduler.addJob({ prompt: 'daily', cron: '0 9 * * *' })
    expect(job.nextAt).toBe('2026-08-15T09:00:00.000Z')
    expect(timerDelay).toBe(3_600_000)
  })

  it('delivers a due job as a follow-up to the idle owning target', async () => {
    const owner = makeTarget('session-a', 'idle')
    targets = [owner]
    const scheduler = makeScheduler()
    scheduler.start()
    const job = scheduler.addJob({ prompt: 'once', at: '2026-08-15T09:00:00.000Z', createdBy: 'session-a' })

    now = Date.parse('2026-08-15T09:00:01Z')
    timerCallback?.()
    await settle()

    expect(owner.followup).toHaveBeenCalledTimes(1)
    expect(owner.inject).not.toHaveBeenCalled()
    expect(delivered[0]?.message).toMatchObject({ job: job.id, scheduledAt: '2026-08-15T09:00:00.000Z' })
    // A fired one-shot leaves the store.
    expect(store.list()).toHaveLength(0)
  })

  it('injects instead of interrupting a busy target', async () => {
    const busy = makeTarget('session-a', 'running')
    targets = [busy]
    const scheduler = makeScheduler()
    scheduler.start()
    scheduler.addJob({ prompt: 'once', at: '2026-08-15T09:00:00.000Z' })

    now = Date.parse('2026-08-15T09:00:01Z')
    timerCallback?.()
    await settle()

    expect(busy.inject).toHaveBeenCalledTimes(1)
    expect(busy.followup).not.toHaveBeenCalled()
  })

  it('holds jobs while no target is live and fires when one appears', async () => {
    const scheduler = makeScheduler()
    scheduler.start()
    scheduler.addJob({ prompt: 'once', at: '2026-08-15T09:00:00.000Z' })

    now = Date.parse('2026-08-15T10:00:00Z')
    timerCallback?.()
    await settle()
    expect(delivered).toHaveLength(0)
    expect(store.list()).toHaveLength(1)
    // An undispatchable overdue job retries on a bounded floor, never a zero-delay spin.
    expect(timerDelay).toBe(60_000)

    const late = makeTarget('session-b', 'idle')
    targets = [late]
    scheduler.notifyTargets()
    await settle()
    expect(late.followup).toHaveBeenCalledTimes(1)
    expect(store.list()).toHaveLength(0)
  })

  it('wakes the cold creating session when no target is live', async () => {
    const woken = makeTarget('session-cold', 'idle')
    const wakeCold = vi.fn<(job: { createdBy: string | null }) => Promise<CronTarget | null>>()
      .mockResolvedValue(woken)
    const scheduler = makeScheduler({ wakeCold })
    scheduler.start()
    scheduler.addJob({ prompt: 'once', at: '2026-08-15T09:00:00.000Z', createdBy: 'session-cold' })

    now = Date.parse('2026-08-15T09:00:01Z')
    timerCallback?.()
    await settle()

    expect(wakeCold).toHaveBeenCalledTimes(1)
    expect(woken.followup).toHaveBeenCalledTimes(1)
    expect(store.list()).toHaveLength(0)
  })

  it('holds the job when cold wake declines or fails', async () => {
    const warn = vi.fn()
    const wakeCold = vi.fn<() => Promise<CronTarget | null>>().mockResolvedValue(null)
    const scheduler = makeScheduler({ wakeCold, warn })
    scheduler.start()
    scheduler.addJob({ prompt: 'once', at: '2026-08-15T09:00:00.000Z', createdBy: 'session-gone' })

    now = Date.parse('2026-08-15T09:00:01Z')
    timerCallback?.()
    await settle()
    expect(wakeCold).toHaveBeenCalledTimes(1)
    expect(delivered).toHaveLength(0)
    expect(store.list()).toHaveLength(1)

    wakeCold.mockRejectedValueOnce(new Error('resume exploded'))
    scheduler.notifyTargets()
    await settle()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resume exploded'))
    expect(store.list()).toHaveLength(1)
  })

  it('never cold-wakes a job without a creating session', async () => {
    const wakeCold = vi.fn<() => Promise<CronTarget | null>>().mockResolvedValue(null)
    const scheduler = makeScheduler({ wakeCold })
    scheduler.start()
    scheduler.addJob({ prompt: 'once', at: '2026-08-15T09:00:00.000Z' })

    now = Date.parse('2026-08-15T09:00:01Z')
    timerCallback?.()
    await settle()
    expect(wakeCold).not.toHaveBeenCalled()
    expect(store.list()).toHaveLength(1)
  })

  it('advances recurring jobs past the fire time with latest-only catch-up', async () => {
    const target = makeTarget('session-a', 'idle')
    targets = [target]
    const scheduler = makeScheduler()
    scheduler.start()
    scheduler.addJob({ prompt: 'hourly', cron: '0 * * * *' })

    // Wake long after several occurrences were missed: only one dispatch.
    now = Date.parse('2026-08-15T13:30:00Z')
    timerCallback?.()
    await settle()
    expect(target.followup).toHaveBeenCalledTimes(1)

    const job = store.list()[0]
    expect(job?.fireCount).toBe(1)
    expect(Date.parse(job?.nextAt ?? '')).toBeGreaterThan(now)
  })

  it('enforces validation and capacity limits', () => {
    const scheduler = makeScheduler()
    scheduler.start()
    expect(() => scheduler.addJob({ prompt: 'x', cron: '* * * * *' })).toThrow('too_frequent')
    expect(() => scheduler.addJob({ prompt: 'x', cron: '0 9 * * *', timeZone: 'Mars/Olympus' })).toThrow('invalid_time_zone')
    scheduler.addJob({ prompt: 'a', at: '2026-08-16T09:00:00.000Z' })
    scheduler.addJob({ prompt: 'b', at: '2026-08-16T10:00:00.000Z' })
    scheduler.addJob({ prompt: 'c', at: '2026-08-16T11:00:00.000Z' })
    expect(() => scheduler.addJob({ prompt: 'd', at: '2026-08-16T12:00:00.000Z' })).toThrow('too_many_jobs')
  })

  it('persists adds and removals across a reload', () => {
    const scheduler = makeScheduler()
    scheduler.start()
    scheduler.addJob({ prompt: 'a', cron: '0 9 * * *' })
    scheduler.addJob({ prompt: 'b', at: '2026-08-16T09:00:00.000Z' })
    scheduler.removeJob('cron-1')

    const reloaded = new CronStore(join(dir, 'jobs.json'), () => {})
    reloaded.load()
    expect(reloaded.list().map(job => job.id)).toEqual(['cron-2'])
  })
})
