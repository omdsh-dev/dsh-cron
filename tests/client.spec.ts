import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

const clientMocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  states: [] as Array<unknown>,
  callRpc: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => { clientMocks.effects.push(effect) },
    useState: (initial: unknown) => {
      clientMocks.states.push(initial)
      return [initial, vi.fn()]
    },
  }
})

vi.mock('../src/client/rpc.ts', () => ({ callRpc: clientMocks.callRpc }))

import { CronPanel } from '../src/client/CronPanel.tsx'
import { apply } from '../src/client/index.ts'

describe('CronPanel', () => {
  beforeEach(() => {
    clientMocks.effects.length = 0
    clientMocks.states.length = 0
    clientMocks.callRpc.mockReset()
  })

  it('polls the list endpoint only while the panel is open', async () => {
    clientMocks.callRpc.mockResolvedValue({ jobs: [], generatedAt: 1 })
    const connection = {} as ConnectionHandle

    // closed: useState(false) for open — the effect returns early.
    CronPanel({ wide: true, connection })
    expect(clientMocks.effects).toHaveLength(1)
    const cleanupClosed = clientMocks.effects[0]?.()
    expect(clientMocks.callRpc).not.toHaveBeenCalled()
    expect(cleanupClosed).toBeUndefined()
  })

  it('registers the sidebar footer action slot on apply', () => {
    const registered: unknown[] = []
    const injected: Array<readonly unknown[]> = []
    const ctx = {
      get: (name: string) => (name === 'connection' ? {} : undefined),
      slots: {
        inject: (name: string, factory: () => unknown) => {
          const disposer = factory()
          injected.push([name, disposer])
        },
        register: (options: unknown, component: unknown) => {
          registered.push([options, component])
          return () => {}
        },
      },
    }
    apply(ctx as never)
    expect(injected).toHaveLength(1)
    const registration = registered[0] as [{ name: string; id: string }, unknown]
    expect(registration[0].name).toBe('sidebar.footer.action')
    expect(registration[0].id).toBe('cron')
    expect(registration[1]).toBe(CronPanel)
  })
})
