import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CronAutomationAdapter } from '../src/adapter.ts'
import { CronScheduler } from '../src/scheduler.ts'
import { CronStore } from '../src/store.ts'
import { FakeAutomation } from './fake-automation.ts'

const TARGET = { kind: 'fresh' as const, cwd: '/workspace' }

describe('CronScheduler Automation adapter', () => {
  let dir: string
  let now: number
  let store: CronStore
  let automation: FakeAutomation
  let adapter: CronAutomationAdapter
  let timerCallback: (() => void) | null
  let timerDelay: number | null

  function scheduler(): CronScheduler {
    return new CronScheduler({
      store, adapter, now: () => now, defaultTarget: TARGET,
      armTimer: (callback, delay) => {
        timerCallback = callback
        timerDelay = delay
        return () => { timerCallback = null }
      },
      defaultTimeZone: 'UTC', maxJobs: 3, minIntervalMinutes: 5,
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-cron-scheduler-'))
    now = Date.parse('2026-08-15T08:00:00Z')
    store = new CronStore(join(dir, 'jobs.json'), () => {}, TARGET)
    store.load()
    automation = new FakeAutomation()
    adapter = new CronAutomationAdapter(store, automation, () => now, () => {})
    timerCallback = null
    timerDelay = null
  })

  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('arms the earliest calendar occurrence and submits a deterministic Trigger identity', async () => {
    const cron = scheduler()
    cron.start()
    const added = cron.addJob({ prompt: 'daily', cron: '0 9 * * *' })
    expect(added.job.nextAt).toBe('2026-08-15T09:00:00.000Z')
    expect(timerDelay).toBe(3_600_000)

    now = Date.parse('2026-08-15T09:00:01Z')
    timerCallback?.()
    await settle()

    expect(automation.submissions).toHaveLength(1)
    expect(automation.submissions[0]).toMatchObject({
      target: TARGET,
      trigger: {
        kind: 'cron', sourceId: added.job.id, occurrenceId: '2026-08-15T09:00:00.000Z',
        idempotencyKey: `v1:${added.job.id}:2026-08-15T09:00:00.000Z`,
      },
      concurrency: { key: `cron:${added.job.id}`, limit: 1 },
    })
    expect(added.job.runs[0]).toMatchObject({ automationRunId: 'run-1', state: 'queued' })
  })

  it('persists the occurrence before submission and recovers the same Run after a crash window', async () => {
    automation.failAfterCreate = true
    const cron = scheduler()
    cron.start()
    const added = cron.addJob({ prompt: 'once', at: '2026-08-15T09:00:00Z' })
    now = Date.parse('2026-08-15T09:00:01Z')
    timerCallback?.()
    await settle()
    // The coalesced follow-up pass sees the source fact and re-submits the same key.
    expect(automation.submissions).toHaveLength(2)
    expect(added.job.runs[0]).toMatchObject({ automationRunId: 'run-1', state: 'queued' })
    expect(automation.runs).toHaveLength(1)
  })

  it('reconciles terminal Run state through the durable event cursor and checkpoints after local persistence', async () => {
    const cron = scheduler()
    const added = cron.addJob({ prompt: 'later', at: '2026-08-16T09:00:00Z' })
    expect(await cron.fireNow(added.job.id)).toBe('submitted')
    automation.settle('run-1', 'succeeded')

    await cron.reconcile()
    expect(added.job.lastRun).toMatchObject({ state: 'succeeded', outcome: 'completed', excerpt: 'done' })
    expect(store.eventCursor()).toBe(2)
    expect(automation.checkpoints.at(-1)).toEqual({ id: 'cron.adapter.v1', seq: 2 })

    const reloaded = new CronStore(join(dir, 'jobs.json'), () => {}, TARGET)
    reloaded.load()
    expect(reloaded.get(added.job.id)?.lastRun).toMatchObject({ state: 'succeeded', automationRunId: 'run-1' })
    expect(reloaded.eventCursor()).toBe(2)
  })

  it('repairs linked projections and resumes at the retention watermark after cursor expiry', async () => {
    const cron = scheduler()
    const added = cron.addJob({ prompt: 'later', at: '2026-08-16T09:00:00Z' })
    await cron.fireNow(added.job.id)
    automation.settle('run-1', 'indeterminate')
    automation.prunedThroughSeq = 2

    await cron.reconcile()
    expect(added.job.lastRun).toMatchObject({ state: 'indeterminate', outcome: 'interrupted' })
    expect(store.eventCursor()).toBe(2)
    expect(automation.checkpoints.at(-1)).toEqual({ id: 'cron.adapter.v1', seq: 2 })
  })

  it('uses latest-only catch-up while retaining every submitted occurrence independently', async () => {
    const cron = scheduler()
    cron.start()
    const added = cron.addJob({ prompt: 'hourly', cron: '0 * * * *' })
    now = Date.parse('2026-08-15T13:30:00Z')
    timerCallback?.()
    await settle()
    expect(automation.submissions).toHaveLength(1)
    expect(added.job.fireCount).toBe(1)
    expect(Date.parse(added.job.nextAt)).toBeGreaterThan(now)
  })

  it('deduplicates identical active jobs and validates schedule, target, concurrency, and capacity', () => {
    const cron = scheduler()
    const first = cron.addJob({ prompt: 'daily', cron: '0 9 * * 1-5' })
    expect(cron.addJob({ prompt: 'daily', cron: '0 9 * * 1-5' })).toMatchObject({ deduplicated: true })
    expect(first.nextOccurrences).toHaveLength(3)
    expect(() => cron.addJob({ prompt: 'x', cron: '* * * * *' })).toThrow('too_frequent')
    expect(() => cron.addJob({ prompt: 'x', at: '2026-08-16T09:00:00' })).toThrow('invalid_selector')
    expect(() => cron.addJob({ prompt: 'x', at: '2026-08-16T09:00:00Z', concurrencyLimit: 0 })).toThrow('invalid_concurrency')
    expect(() => cron.addJob({ prompt: 'x', at: '2026-08-16T09:00:00Z', target: { kind: 'fresh', cwd: 'relative' } })).toThrow('invalid_target')
    cron.addJob({ prompt: 'two', at: '2026-08-16T10:00:00Z' })
    cron.addJob({ prompt: 'three', at: '2026-08-16T11:00:00Z' })
    expect(() => cron.addJob({ prompt: 'four', at: '2026-08-16T12:00:00Z' })).toThrow('too_many_jobs')
  })

  it('keeps legacy jobs paused until an explicit fresh target is supplied', () => {
    const cron = scheduler()
    const added = cron.addJob({ prompt: 'daily', cron: '0 9 * * *' })
    added.job.target = null
    added.job.paused = true
    expect(cron.setPaused(added.job.id, false)).toBe(false)
    expect(cron.setTarget(added.job.id, TARGET)).toBe(true)
    expect(cron.setPaused(added.job.id, false)).toBe(true)
  })
})

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}
