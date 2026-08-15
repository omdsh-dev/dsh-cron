/**
 * Cold-session wake: inspect persistence, rebuild the recorded preset and
 * model, and resume the session so a due job can deliver into it.
 * @module dsh-cron/coldwake
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentSetup } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
// Type-only: merges the `agentDefaultModel` service type used through ctx.get.
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** The last model selection recorded on the session's request headers. */
export function lastRequestConfig(
  events: readonly SessionEvent[],
): { readonly provider: string; readonly model: string } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'request/header') continue
    const { config } = event.data.header
    if (config.provider && config.model) return { provider: config.provider, model: config.model }
  }
  return undefined
}

/**
 * Resume one cold persisted session to a live agent.
 * @param ctx - plugin context carrying the optional persistence and preset services.
 * @param sessionId - the job's recorded creating session.
 * @param warn - sink for recoverable wake failures.
 * @returns the resumed live agent, or null when the session cannot be woken.
 */
export async function wakeColdSession(
  ctx: Context,
  sessionId: string,
  warn: (message: string) => void,
): Promise<Agent | null> {
  const persistence = ctx.get('sessionPersistence') as SessionPersistence | undefined
  if (persistence === undefined) return null
  const id = SessionId(sessionId)
  let inspected: SessionInspection
  try {
    const meta = (await persistence.list()).find(candidate => candidate.id === id)
    if (meta === undefined || meta.cwd === undefined) return null
    inspected = await persistence.inspect(id)
    if (inspected.meta.cwd === undefined) return null
  } catch (error) {
    // A vanished or corrupt artifact cannot be woken; the job stays overdue.
    warn(`dsh-cron: cannot inspect session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  const events = [...inspected.events]
  const presets = ctx.get('agentPresets')
  const setup: AgentSetup | undefined = presets === undefined
    ? undefined
    : async (agentCtx) => {
        await presets.mount(agentCtx, resolveSessionPreset({ header: inspected.meta, events }))
      }
  const recorded = lastRequestConfig(events)
  const defaults = ctx.get('agentDefaultModel')?.currentSelection()
  const agentOptions = recorded === undefined
    ? (defaults === undefined ? undefined : { provider: defaults.provider, model: defaults.model })
    : { provider: recorded.provider, model: recorded.model }

  try {
    const handle = await ctx.agents.resume({
      resumeSessionId: id,
      ...agentOptions === undefined ? {} : { agentOptions },
      ...setup === undefined ? {} : { setup },
    })
    return handle.agent
  } catch (error) {
    // A resume failure (gone backend, busy identity) leaves the job overdue.
    warn(`dsh-cron: cannot resume session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
