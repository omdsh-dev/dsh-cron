import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createOutcomeTracker } from '../src/tracking.ts'
import type { CronRunRecord } from '../src/store.ts'

type SessionListener = (session: unknown, event: unknown) => void

function makeHarness() {
  const ctx = new Context()
  let listener: SessionListener | undefined
  const realOn = ctx.on.bind(ctx)
  vi.spyOn(ctx, 'on').mockImplementation(((event: string, cb: SessionListener) => {
    if (event === 'session/event') listener = cb
    return realOn(event as never, cb as never)
  }) as never)
  const recorded: Array<{ jobId: string; run: CronRunRecord }> = []
  const tracker = createOutcomeTracker(ctx, (jobId, run) => { recorded.push({ jobId, run }) })
  const session = { id: 'session-1' }
  return { ctx, tracker, recorded, emit: (event: unknown) => listener?.(session, event) }
}

describe('createOutcomeTracker', () => {
  it('records a completed turn with a bounded excerpt', () => {
    const { tracker, recorded, emit } = makeHarness()
    tracker.track('cron-1', 'session-1', '2026-08-15T09:00:00.000Z')
    emit({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'Summary: ' } } })
    emit({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'all green.' } } })
    emit({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.jobId).toBe('cron-1')
    expect(recorded[0]?.run.outcome).toBe('completed')
    expect(recorded[0]?.run.excerpt).toBe('Summary: all green.')
  })

  it('maps error and abort reasons', () => {
    const { tracker, recorded, emit } = makeHarness()
    tracker.track('cron-1', 'session-1', '2026-08-15T09:00:00.000Z')
    emit({ type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'boom' } } } })
    expect(recorded[0]?.run.outcome).toBe('error')

    tracker.track('cron-2', 'session-1', '2026-08-15T10:00:00.000Z')
    emit({ type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
    expect(recorded[1]?.run.outcome).toBe('cancelled')
  })

  it('ignores events for untracked sessions', () => {
    const { recorded, emit } = makeHarness()
    emit({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    expect(recorded).toHaveLength(0)
  })

  it('times out a turn that never settles', () => {
    vi.useFakeTimers()
    try {
      const { tracker, recorded } = makeHarness()
      tracker.track('cron-1', 'session-1', '2026-08-15T09:00:00.000Z')
      vi.advanceTimersByTime(10 * 60_000 + 1)
      expect(recorded[0]?.run.outcome).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})
