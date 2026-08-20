import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { registerCronRpc } from '../src/rpc.ts'
import type { CronService } from '../src/scheduler.ts'

type Handler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>

function makeHarness(service: Partial<CronService>) {
  const ctx = new Context()
  let captured: Handler | undefined
  const disposeChannel = vi.fn()
  ctx.provide('connection', {
    rpc: {
      handle: (channel: string, handler: Handler, _options: unknown) => {
        void channel
        captured = handler
        return disposeChannel
      },
    },
  })
  const disposer = registerCronRpc(ctx, service as CronService)
  return { captured: captured as Handler, disposer, disposeChannel }
}

describe('registerCronRpc', () => {
  it('lists jobs through the channel', async () => {
    const jobs = [{ id: 'cron-1' }]
    const { captured } = makeHarness({ list: () => jobs as never })
    const result = await captured('list', {}, new AbortController().signal) as { ok: boolean; value: { jobs: unknown[] } }
    expect(result.ok).toBe(true)
    expect(result.value.jobs).toEqual(jobs)
  })

  it('adds recurring and one-shot jobs through scheduler validation', async () => {
    const add = vi.fn().mockReturnValue({ job: { id: 'cron-3' }, deduplicated: false, nextOccurrences: [] })
    const { captured } = makeHarness({ add })
    const recurring = await captured('add', {
      prompt: 'prepare standup',
      cron: '0 9 * * 1-5',
      timeZone: 'Asia/Shanghai',
      createdBy: 'session-1',
    }, new AbortController().signal) as { ok: boolean; value: { job: { id: string } } }
    expect(recurring.value.job.id).toBe('cron-3')
    expect(add).toHaveBeenCalledWith({
      prompt: 'prepare standup',
      cron: '0 9 * * 1-5',
      timeZone: 'Asia/Shanghai',
      createdBy: 'session-1',
    })

    await captured('add', {
      prompt: 'ship release',
      at: '2026-09-01T01:00:00.000Z',
    }, new AbortController().signal)
    expect(add).toHaveBeenLastCalledWith({
      prompt: 'ship release',
      at: '2026-09-01T01:00:00.000Z',
    })
  })

  it('removes and fires by payload id', async () => {
    const remove = vi.fn().mockReturnValue(true)
    const fireNow = vi.fn().mockResolvedValue('fired')
    const { captured } = makeHarness({ remove, fireNow })
    const removed = await captured('remove', { id: 'cron-2' }, new AbortController().signal) as { ok: boolean; value: { removed: boolean } }
    expect(removed.value).toEqual({ id: 'cron-2', removed: true })
    const fired = await captured('fire', { id: ' cron-2 ' }, new AbortController().signal) as { ok: boolean; value: { result: string } }
    expect(fired.value.result).toBe('fired')
    expect(fireNow).toHaveBeenCalledWith('cron-2')
  })

  it('rejects unknown endpoints and blank ids with transport errors', async () => {
    const { captured } = makeHarness({})
    const unknown = await captured('bogus', {}, new AbortController().signal) as { ok: boolean; error: { message: string } }
    expect(unknown.ok).toBe(false)
    expect(unknown.error.message).toContain('unknown endpoint')
    const blank = await captured('remove', { id: '  ' }, new AbortController().signal) as { ok: boolean; error: { message: string } }
    expect(blank.ok).toBe(false)
    const malformedAdd = await captured('add', { prompt: 42 }, new AbortController().signal) as { ok: boolean; error: { message: string } }
    expect(malformedAdd.ok).toBe(false)
    expect(malformedAdd.error.message).toContain('payload.prompt must be a string')
    const blankOwner = await captured('add', { prompt: 'task', at: '2026-09-01T01:00:00.000Z', createdBy: ' ' }, new AbortController().signal) as { ok: boolean; error: { message: string } }
    expect(blankOwner.ok).toBe(false)
    expect(blankOwner.error.message).toContain('payload.createdBy must be a non-blank string')
  })

  it('returns a channel disposer', () => {
    const { disposer, disposeChannel } = makeHarness({})
    disposer()
    expect(disposeChannel).toHaveBeenCalledTimes(1)
  })
})
