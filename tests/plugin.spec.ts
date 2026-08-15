import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
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
    expect(harness.registered.map(tool => tool.name)).toEqual(['cron_add', 'cron_list', 'cron_remove'])
    expect(harness.ctx.get('cron')).toBeDefined()

    await harness.dispose()
    expect(harness.ctx.get('cron')).toBeUndefined()
  })

  it('adds, lists, and removes a one-shot job through the tools', async () => {
    const harness = await createPluginHarness()
    const tools = harness.registered as unknown as CapturedTool[]
    const [add, list, remove] = tools as [CapturedTool, CapturedTool, CapturedTool]

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
