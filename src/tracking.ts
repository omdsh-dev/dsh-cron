/**
 * Dispatch outcome tracking: after a task is delivered into a session, watch
 * that session's event stream until the turn settles and record the result
 * back onto the job.
 * @module dsh-cron/tracking
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { CronRunRecord } from './store.ts'

/** How long a delivered task may run before its outcome records as timeout. */
const RUN_TIMEOUT_MS = 10 * 60_000

/** Assistant text kept for the excerpt; the record keeps a bounded prefix. */
const EXCERPT_CHARS = 200
const EXCERPT_BUFFER_CHARS = 8_192

interface PendingRun {
  readonly jobId: string
  readonly firedAt: string
  chunks: string[]
  readonly timer: ReturnType<typeof setTimeout>
}

function outcomeOf(reason: TurnEndReason): CronRunRecord['outcome'] {
  switch (reason.kind) {
    case 'completed':
    case 'max-tokens':
    case 'blocked':
      return 'completed'
    case 'aborted':
    case 'interrupted':
      return 'cancelled'
    case 'error':
      return 'error'
    default:
      // Merge-extensible union: unknown future reasons mean the turn ended.
      return 'completed'
  }
}

export interface OutcomeTracker {
  /** Begin watching the target session for one dispatched job. */
  track(jobId: string, sessionId: string, firedAt: string): void
}

/**
 * Create the tracker. One pending run per session; a new dispatch to the same
 * session supersedes the previous watch.
 * @param ctx - plugin context providing the session/event feed.
 * @param recordRun - persists one settled outcome.
 * @param now - wall clock, injectable for tests.
 */
export function createOutcomeTracker(
  ctx: Context,
  recordRun: (jobId: string, run: CronRunRecord) => void,
  now: () => number = () => Date.now(),
): OutcomeTracker {
  const pending = new Map<string, PendingRun>()

  const settle = (sessionId: string, outcome: CronRunRecord['outcome']): void => {
    const run = pending.get(sessionId)
    if (run === undefined) return
    pending.delete(sessionId)
    clearTimeout(run.timer)
    const excerpt = run.chunks.join('').slice(0, EXCERPT_CHARS)
    recordRun(run.jobId, {
      firedAt: run.firedAt,
      completedAt: new Date(now()).toISOString(),
      outcome,
      ...(excerpt.length > 0 ? { excerpt } : {}),
    })
  }

  ctx.effect(() => {
    const off = ctx.on('session/event', (session: Session, event: SessionEvent) => {
      const run = pending.get(String(session.id))
      if (run === undefined) return
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
        const total = run.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        if (total < EXCERPT_BUFFER_CHARS) run.chunks.push(event.data.chunk.text)
        return
      }
      if (event.type === 'turn/end') settle(String(session.id), outcomeOf(event.data.reason))
    })
    return () => {
      off()
      for (const run of pending.values()) clearTimeout(run.timer)
      pending.clear()
    }
  }, 'dsh-cron: outcome-tracker')

  return {
    track(jobId, sessionId, firedAt) {
      const existing = pending.get(sessionId)
      if (existing !== undefined) {
        clearTimeout(existing.timer)
        pending.delete(sessionId)
      }
      const timer = setTimeout(() => { settle(sessionId, 'timeout') }, RUN_TIMEOUT_MS)
      pending.set(sessionId, { jobId, firedAt, chunks: [], timer })
    },
  }
}
