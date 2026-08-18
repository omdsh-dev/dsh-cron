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
    useRef: (initial: unknown) => ({ current: initial }),
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

    // closed: useState(false) for open — both effects return early.
    CronPanel({ wide: true, connection, t: (key: string) => key })
    expect(clientMocks.effects).toHaveLength(2)
    const cleanupPoll = clientMocks.effects[0]?.()
    const cleanupDismiss = clientMocks.effects[1]?.()
    expect(clientMocks.callRpc).not.toHaveBeenCalled()
    expect(cleanupPoll).toBeUndefined()
    expect(cleanupDismiss).toBeUndefined()
  })

  it('registers the sidebar footer action slot on apply', () => {
    const registered: unknown[] = []
    const injected: Array<readonly unknown[]> = []
    const ctx = {
      get: (name: string) => (name === 'connection' ? {} : undefined),
      effect: (fn: () => unknown) => { fn() },
      locale: {
        register: vi.fn(() => () => {}),
      },
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
    expect(ctx.locale.register).toHaveBeenCalledWith('sidebar.cron', {
      zh: expect.any(Object),
      en: expect.any(Object),
    })
    expect(injected).toHaveLength(1)
    const registration = registered[0] as [{ name: string; id: string; locale: string }, unknown]
    expect(registration[0].name).toBe('sidebar.footer.action')
    expect(registration[0].id).toBe('cron')
    expect(registration[0].locale).toBe('sidebar.cron')
    expect(registration[1]).toBe(CronPanel)
  })
})
