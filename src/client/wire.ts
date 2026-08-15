/**
 * Browser wire types for the `/cron` RPC channel. Kept local to the client
 * bundle — the host half's types never cross into browser code.
 * @module
 */

/** One scheduled job in a list payload. */
export interface CronJobWire {
  readonly id: string
  readonly prompt: string
  readonly schedule:
    | { readonly kind: 'at'; readonly at: string }
    | { readonly kind: 'cron'; readonly expression: string; readonly timeZone: string }
  readonly createdBy: string | null
  readonly createdAt: string
  readonly nextAt: string
  readonly lastFiredAt: string | null
  readonly fireCount: number
  readonly state: 'active' | 'done'
  readonly paused: boolean
  readonly lastRun: {
    readonly firedAt: string
    readonly completedAt?: string
    readonly outcome: 'delivered' | 'completed' | 'error' | 'cancelled' | 'timeout'
    readonly excerpt?: string
  } | null
}

/** Payload of the `list` endpoint. */
export interface CronListWire {
  readonly jobs: readonly CronJobWire[]
  readonly generatedAt: number
}

/** Payload of the `remove` endpoint. */
export interface CronRemoveWire {
  readonly id: string
  readonly removed: boolean
}

/** Payload of the `update` endpoint. */
export interface CronUpdateWire {
  readonly id: string
  readonly paused: boolean
  readonly updated: boolean
}

/** Payload of the `fire` endpoint. */
export interface CronFireWire {
  readonly id: string
  readonly result: 'fired' | 'not_found' | 'no_target'
}
