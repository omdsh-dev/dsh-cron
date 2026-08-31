import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { FakeAutomation } from './fake-automation.ts'

/** A tool-registration disposer captured from the fake registry. */
export interface CapturedRegistry {
  readonly tools: ToolDefinition[]
  readonly disposers: Array<ReturnType<typeof vi.fn>>
}

/**
 * Mount the production plugin on a real Cordis context with fake `tools` and
 * `agents` services and a temporary job store.
 */
export async function createPluginHarness(config: plugin.Config = {}) {
  const ctx = new Context()
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-cron-test-'))
  const registered: ToolDefinition[] = []
  const disposers: Array<ReturnType<typeof vi.fn>> = []
  ctx.provide('tools', {
    register: (definition: ToolDefinition) => {
      registered.push(definition)
      const disposer = vi.fn()
      disposers.push(disposer)
      return disposer
    },
  })
  const automation = new FakeAutomation()
  ctx.provide('automation', automation)
  const fiber = await ctx.plugin(plugin, { defaultCwd: dataDir, ...config, dataDir })

  return {
    ctx,
    fiber,
    dataDir,
    registered,
    disposers,
    automation,
    async dispose(): Promise<void> {
      try {
        await fiber.dispose()
      } finally {
        rmSync(dataDir, { recursive: true, force: true })
      }
    },
  }
}
