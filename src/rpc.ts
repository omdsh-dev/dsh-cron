/**
 * `/cron` RPC channel (loopback): the browser task center's create, list,
 * update, remove, and fire-now actions over the shared scheduler.
 * @module dsh-cron/rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { CronService } from './scheduler.ts'

export const CRON_RPC_CHANNEL = '/cron'

type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function transportError<T>(error: unknown): RpcResult<T> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

function payloadId(payload: unknown): string {
  const id = (payload as { id?: unknown } | undefined)?.id
  if (typeof id !== 'string' || id.trim().length === 0) throw new Error('dsh-cron RPC: payload.id must be a non-blank string')
  return id.trim()
}

function payloadText(payload: unknown, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | undefined)?.[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`dsh-cron RPC: payload.${key} must be a string`)
  return value
}

function payloadOptionalId(payload: unknown, key: string): string | undefined {
  const value = payloadText(payload, key)
  if (value === undefined) return undefined
  if (value.trim().length === 0) throw new Error(`dsh-cron RPC: payload.${key} must be a non-blank string`)
  return value.trim()
}

/**
 * Register the `/cron` channel handlers.
 * @param ctx - context carrying the `connection` service.
 * @param service - the scheduler's service view.
 * @returns the channel disposer.
 */
export function registerCronRpc(ctx: Context, service: CronService): () => void {
  // rc.2 required an authority option; alpha.1 authenticates every channel and
  // removed that parameter. JavaScript safely ignores the retained option.
  const register = ctx.connection.rpc.handle as unknown as (
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>,
    options?: { authority: 'loopback' },
  ) => () => Promise<void>
  const handle = register(CRON_RPC_CHANNEL, async (endpoint, payload, _signal) => {
    try {
      switch (endpoint) {
        case 'list': return ok({ jobs: service.list(), generatedAt: Date.now() })
        case 'add': {
          const cron = payloadText(payload, 'cron')
          const timeZone = payloadText(payload, 'timeZone')
          const at = payloadText(payload, 'at')
          const createdBy = payloadOptionalId(payload, 'createdBy')
          return ok(service.add({
            prompt: payloadText(payload, 'prompt') ?? '',
            ...(cron === undefined ? {} : { cron }),
            ...(timeZone === undefined ? {} : { timeZone }),
            ...(at === undefined ? {} : { at }),
            ...(createdBy === undefined ? {} : { createdBy }),
          }))
        }
        case 'remove': return ok({ id: payloadId(payload), removed: service.remove(payloadId(payload)) })
        case 'update': {
          const paused = (payload as { paused?: unknown } | undefined)?.paused
          if (typeof paused !== 'boolean') throw new Error('dsh-cron RPC: payload.paused must be a boolean')
          const id = payloadId(payload)
          return ok({ id, paused, updated: service.setPaused(id, paused) })
        }
        case 'fire': {
          const id = payloadId(payload)
          return ok({ id, result: await service.fireNow(id) })
        }
        default: return transportError<unknown>(new Error(`dsh-cron RPC unknown endpoint: ${endpoint}`))
      }
    } catch (error) {
      return transportError<unknown>(error)
    }
  }, { authority: 'loopback' })
  return () => { void handle() }
}
