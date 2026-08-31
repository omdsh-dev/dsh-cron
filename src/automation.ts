/** Public structural boundary consumed from dsh-automation v0.2. */

export type AutomationRunState =
  | 'queued' | 'claimed' | 'running' | 'cancelling'
  | 'succeeded' | 'failed' | 'cancelled' | 'indeterminate'

export interface AutomationTarget {
  readonly kind: 'fresh'
  readonly cwd: string
  readonly preset?: string
  readonly provider?: string
  readonly model?: string
  readonly permissionPreset?: string
}

export interface AutomationRun {
  readonly id: string
  readonly state: AutomationRunState
  readonly outcome?: string
  readonly resultExcerpt?: string
  readonly error?: string
  readonly updatedAt: number
}

export interface AutomationEventPage {
  readonly events: readonly { readonly seq: number; readonly runId: string }[]
  readonly nextSeq: number
  readonly hasMore: boolean
}

export interface AutomationPort {
  submit(request: {
    readonly prompt: string
    readonly target: AutomationTarget
    readonly trigger: {
      readonly kind: 'cron'
      readonly sourceId: string
      readonly occurrenceId: string
      readonly idempotencyKey: string
    }
    readonly concurrency: { readonly key: string; readonly limit: number }
  }): { readonly run: AutomationRun; readonly created: boolean }
  get(id: string): AutomationRun
  changes(query: { readonly afterSeq: number; readonly triggerKind: 'cron'; readonly limit: number }): AutomationEventPage
  checkpointConsumer(id: string, seq: number): unknown
  status(): { readonly eventFeed: { readonly prunedThroughSeq: number } }
}

export function requireAutomation(value: unknown): AutomationPort {
  if (typeof value !== 'object' || value === null) throw new Error('dsh-cron: dsh-automation v0.2 service is required')
  const candidate = value as Partial<Record<keyof AutomationPort, unknown>>
  for (const method of ['submit', 'get', 'changes', 'checkpointConsumer', 'status'] as const) {
    if (typeof candidate[method] !== 'function') throw new Error(`dsh-cron: automation service is missing ${method}()`)
  }
  return value as AutomationPort
}
