import type { AutomationEventPage, AutomationPort, AutomationRun, AutomationRunState } from '../src/automation.ts'

export class FakeAutomation implements AutomationPort {
  readonly submissions: unknown[] = []
  readonly checkpoints: Array<{ id: string; seq: number }> = []
  readonly runs = new Map<string, AutomationRun>()
  failAfterCreate = false
  prunedThroughSeq = 0
  private readonly byKey = new Map<string, string>()
  private readonly events: Array<{ seq: number; runId: string }> = []

  submit(request: Parameters<AutomationPort['submit']>[0]): ReturnType<AutomationPort['submit']> {
    this.submissions.push(request)
    const existingId = this.byKey.get(request.trigger.idempotencyKey)
    if (existingId !== undefined) return { run: this.runs.get(existingId) as AutomationRun, created: false }
    const id = `run-${this.runs.size + 1}`
    const run: AutomationRun = { id, state: 'queued', updatedAt: Date.now() }
    this.byKey.set(request.trigger.idempotencyKey, id)
    this.runs.set(id, run)
    this.events.push({ seq: this.events.length + 1, runId: id })
    if (this.failAfterCreate) {
      this.failAfterCreate = false
      throw new Error('simulated crash after Automation commit')
    }
    return { run, created: true }
  }

  get(id: string): AutomationRun {
    const run = this.runs.get(id)
    if (run === undefined) throw new Error(`missing Run ${id}`)
    return run
  }

  changes(query: Parameters<AutomationPort['changes']>[0]): AutomationEventPage {
    if (query.afterSeq < this.prunedThroughSeq) {
      throw Object.assign(new Error('cursor expired'), { code: 'EVENT_CURSOR_EXPIRED' })
    }
    const scanned = this.events.filter(event => event.seq > query.afterSeq).slice(0, query.limit)
    const newest = this.events.at(-1)?.seq ?? this.prunedThroughSeq
    return {
      events: scanned,
      nextSeq: scanned.at(-1)?.seq ?? query.afterSeq,
      hasMore: (scanned.at(-1)?.seq ?? query.afterSeq) < newest,
    }
  }

  checkpointConsumer(id: string, seq: number): void {
    this.checkpoints.push({ id, seq })
  }

  status(): { eventFeed: { prunedThroughSeq: number } } {
    return { eventFeed: { prunedThroughSeq: this.prunedThroughSeq } }
  }

  settle(id: string, state: Extract<AutomationRunState, 'succeeded' | 'failed' | 'cancelled' | 'indeterminate'>): void {
    const previous = this.get(id)
    this.runs.set(id, {
      ...previous, state, outcome: state === 'succeeded' ? 'completed' : state === 'indeterminate' ? 'interrupted' : 'error',
      ...(state === 'succeeded' ? { resultExcerpt: 'done' } : {}), updatedAt: Date.now(),
    })
    this.events.push({ seq: this.events.length + 1, runId: id })
  }
}
