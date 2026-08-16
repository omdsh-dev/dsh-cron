import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { createPluginHarness } from './harness.ts'

/** Structural view of a captured tool definition for direct execution. */
interface CapturedTool {
  name: string
  execute(args: Record<string, unknown>, exec?: unknown): Promise<unknown>
}

function futureAt(minutesAhead = 60): string {
  return new Date(Date.now() + minutesAhead * 60_000).toISOString()
}

describe('dsh-cron', () => {
  it('preserves the function-plugin namespace through Loader unwrapping', () => {
    expect('default' in plugin).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as Record<string, unknown>
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('dsh-cron')
    expect(unwrapped.inject).toEqual(['agents', 'tools'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('registers the three cron tools and unprovides the cron service on dispose', async () => {
    const harness = await createPluginHarness()
    expect(harness.registered.map(tool => tool.name)).toEqual(['cron_add', 'cron_update', 'cron_list', 'cron_remove'])
    expect(harness.ctx.get('cron')).toBeDefined()

    await harness.dispose()
    expect(harness.ctx.get('cron')).toBeUndefined()
  })

  it('adds, lists, and removes a one-shot job through the tools', async () => {
    const harness = await createPluginHarness()
    const tools = harness.registered as unknown as CapturedTool[]
    const byName = new Map(tools.map(tool => [tool.name, tool]))
    const add = byName.get('cron_add') as CapturedTool
    const list = byName.get('cron_list') as CapturedTool
    const remove = byName.get('cron_remove') as CapturedTool

    const added = await add.execute({ prompt: 'standup summary', at: futureAt() }, { agent: undefined }) as { id: string; nextAt: string }
    expect(added.id).toBe('cron-1')
    expect(Date.parse(added.nextAt)).toBeGreaterThan(Date.now())

    const listed = await list.execute({}) as Array<{ id: string; prompt: string }>
    expect(listed).toHaveLength(1)
    expect(listed[0]?.prompt).toBe('standup summary')

    const removed = await remove.execute({ id: 'cron-1' }) as { removed: boolean }
    expect(removed.removed).toBe(true)
    expect(await list.execute({})).toHaveLength(0)

    const persisted = JSON.parse(readFileSync(join(harness.dataDir, 'jobs.json'), 'utf8')) as { jobs: unknown[] }
    expect(persisted.jobs).toHaveLength(0)
    await harness.dispose()
  })

  it('fails loud when coldWake is enabled without session persistence', async () => {
    await expect(createPluginHarness({ coldWake: true })).rejects.toThrow('coldWake requires the sessionPersistence service')
  })

  it('forwards settled runs to the optional callbacks service when present', async () => {
    const ctx = new Context()
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-cron-cb-'))
    const registered: ToolDefinition[] = []
    const emitted: Array<Record<string, unknown>> = []
    ctx.provide('tools', {
      register: (definition: ToolDefinition) => { registered.push(definition); return () => {} },
    })
    ctx.provide('agents', {
      roots: () => [{ id: 'agent-1', status: 'idle', followup: () => {}, inject: () => {} }],
      list: () => [],
      get: () => undefined,
    })
    ctx.provide('callbacks', {
      emit: (event: Record<string, unknown>) => { emitted.push(event) },
    })
    const fiber = await ctx.plugin(plugin, { dataDir })
    const rootSettled: unknown[] = []
    ctx.on('cron/settled', event => { rootSettled.push(event) })
    const service = ctx.get('cron') as { add(input: unknown): { job: { id: string } }; fireNow(id: string): Promise<string> }
    const added = service.add({ prompt: 'x', at: futureAt(), timeZone: 'UTC' })
    const fired = await service.fireNow(added.job.id)
    expect(fired).toBe('fired')
    ;(ctx as unknown as { emit(name: string, session: unknown, event: unknown): void })
      .emit('session/event', { id: 'agent-1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await vi.waitFor(() => expect(rootSettled).toHaveLength(1))
    await vi.waitFor(() => expect(emitted).toHaveLength(1))
    expect(emitted[0]).toMatchObject({ source: 'cron', jobId: added.job.id, outcome: 'completed', firedAt: expect.any(String) })
    await fiber.dispose()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('rejects invalid schedules with tool-prefixed errors', async () => {
    const harness = await createPluginHarness()
    const tools = harness.registered as unknown as CapturedTool[]
    const add = tools[0] as CapturedTool

    await expect(add.execute({ prompt: 'x', at: '2020-01-01T00:00:00Z' }, { agent: undefined }))
      .rejects.toThrow('cron_add: not_future')
    await expect(add.execute({ prompt: '  ', cron: '* * * * *' }, { agent: undefined }))
      .rejects.toThrow('cron_add: invalid_prompt')
    await expect(add.execute({ prompt: 'x', cron: '* * * * *', at: futureAt() }, { agent: undefined }))
      .rejects.toThrow('cron_add: invalid_selector')
    await expect(add.execute({ prompt: 'x', cron: 'bogus' }, { agent: undefined }))
      .rejects.toThrow('cron_add:')

    await harness.dispose()
  })
})
