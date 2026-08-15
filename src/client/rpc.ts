/**
 * Client RPC helpers for the `/cron` channel.
 * @module
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

export const CRON_RPC_CHANNEL = '/cron'

/** Call one `/cron` endpoint; non-ok results throw with the error message. */
export async function callRpc<T = unknown>(
  connection: ConnectionHandle, endpoint: string, payload?: unknown, signal?: AbortSignal,
): Promise<T> {
  // The mux transport rejects requests without a message body, so always
  // send at least an empty object.
  const result = await connection.rpc.call(CRON_RPC_CHANNEL, endpoint, payload ?? {}, signal)
  if (!result.ok) throw new Error(`dsh-cron RPC ${endpoint} failed: ${result.error.message}`)
  return result.value as T
}
