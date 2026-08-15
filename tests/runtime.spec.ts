import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig } from '../src/config.ts'
import { createPluginRuntime } from '../src/runtime.ts'

import type { CronJob } from '../src/store.ts'

function fakeCtx(): Context {
  return {
    agents: { roots: () => [] },
    logger: { warn: vi.fn(), info: vi.fn() },
  } as unknown as Context
}

function fakeTarget(status: string) {
  return {
    id: 's1',
    status,
    followup: vi.fn<(message: unknown) => void>(),
    inject: vi.fn<(message: unknown) => void>(),
  }
}

const job: CronJob = {
  id: 'cron-1',
  prompt: 'daily summary',
  schedule: { kind: 'cron', expression: '0 9 * * *', timeZone: 'UTC' },
  createdBy: null,
  createdAt: '2026-08-15T00:00:00.000Z',
  nextAt: '2026-08-16T09:00:00.000Z',
  lastFiredAt: null,
  fireCount: 0,
  state: 'active',
  paused: false,
  lastRun: null,
}

describe('createPluginRuntime', () => {
  it('defaults to followup delivery even for busy targets', () => {
    const runtime = createPluginRuntime(fakeCtx(), resolveConfig({}))
    const busy = fakeTarget('running')
    runtime.deliver(busy, {})
    expect(busy.followup).toHaveBeenCalledTimes(1)
    expect(busy.inject).not.toHaveBeenCalled()
  })

  it('honours busyDelivery: inject', () => {
    const runtime = createPluginRuntime(fakeCtx(), resolveConfig({ busyDelivery: 'inject' }))
    const busy = fakeTarget('running')
    const idle = fakeTarget('idle')
    runtime.deliver(busy, {})
    runtime.deliver(idle, {})
    expect(busy.inject).toHaveBeenCalledTimes(1)
    expect(idle.followup).toHaveBeenCalledTimes(1)
  })

  it('frames the task for execution, quoting values as JSON', () => {
    const runtime = createPluginRuntime(fakeCtx(), resolveConfig({}))
    const message = runtime.buildMessage(job, job.nextAt)
    const text = (message.content[0] as { text: string }).text
    expect(text).toContain('Execute task_prompt_json')
    expect(text).toContain('job_id_json: "cron-1"')
    expect(text).toContain('task_prompt_json: "daily summary"')
    expect(message.source).toEqual({ kind: 'plugin', plugin: 'dsh-cron' })
  })
})
