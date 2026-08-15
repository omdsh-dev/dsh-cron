/**
 * CronPanel: the sidebar footer action and its toggleable job list. The panel
 * polls the host `/cron` channel while open and refreshes after every action.
 * @module
 */

import { useEffect, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { callRpc } from './rpc.ts'
import type { CronFireWire, CronJobWire, CronListWire } from './wire.ts'

const POLL_MS = 30_000

export interface CronPanelProps {
  /** Owner prop of the `sidebar.footer.action` slot. */
  readonly wide: boolean
  /** Injected connection face. */
  readonly connection: ConnectionHandle
}

function describeSchedule(job: CronJobWire): string {
  if (job.schedule.kind === 'at') return `once at ${job.schedule.at}`
  return `${job.schedule.expression} (${job.schedule.timeZone})`
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

const styles = {
  wrap: { position: 'relative', display: 'inline-flex' } as const,
  button: {
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, inherit)',
    fontSize: 12,
    padding: '2px 6px',
  } as const,
  panel: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: 6,
    minWidth: 300,
    maxWidth: 380,
    maxHeight: 320,
    overflowY: 'auto',
    background: 'var(--dsw-alias-bg-layer-1, #1e1e1e)',
    color: 'var(--dsw-alias-label-primary, inherit)',
    border: '1px solid var(--dsw-alias-border-lowcontrast, #444)',
    borderRadius: 8,
    padding: 8,
    fontSize: 12,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
    zIndex: 10,
  } as const,
  job: {
    padding: '6px 4px',
    borderTop: '1px solid var(--dsw-alias-border-lowcontrast, #444)',
  } as const,
  dim: { color: 'var(--dsw-alias-label-dimmed, #888)' } as const,
  action: {
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-brand-primary, #4c8dff)',
    fontSize: 12,
    padding: '0 4px',
  } as const,
}

export function CronPanel(props: CronPanelProps) {
  const { connection, wide } = props
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<CronListWire | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return undefined
    let disposed = false
    const controller = new AbortController()
    const refresh = async (): Promise<void> => {
      try {
        const next = await callRpc<CronListWire>(connection, 'list', {}, controller.signal)
        if (!disposed) {
          setList(next)
          setError(null)
        }
      } catch {
        // A failed poll keeps the last good snapshot; the next tick retries.
      }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => {
      disposed = true
      controller.abort()
      clearInterval(timer)
    }
  }, [connection, open])

  const act = async (endpoint: 'remove' | 'fire', id: string): Promise<void> => {
    try {
      if (endpoint === 'fire') {
        const outcome = await callRpc<CronFireWire>(connection, 'fire', { id })
        if (outcome.result !== 'fired') {
          setError(outcome.result === 'no_target'
            ? `${id}: no live session to run the task (held until one appears)`
            : `${id}: job not found`)
        }
      } else {
        await callRpc(connection, endpoint, { id })
      }
      const next = await callRpc<CronListWire>(connection, 'list')
      setList(next)
      if (endpoint !== 'fire') setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const jobs = list?.jobs ?? []
  return (
    <span style={styles.wrap}>
      <button type="button" title="Scheduled tasks" style={styles.button} onClick={() => { setOpen(value => !value) }}>
        {wide ? '⏰ Cron' : '⏰'}
      </button>
      {open && (
        <div style={styles.panel}>
          <div style={{ ...styles.dim, paddingBottom: 4 }}>Scheduled tasks ({jobs.length})</div>
          {error !== null && <div style={{ color: 'var(--dsw-alias-label-danger, #e5534b)' }}>{error}</div>}
          {list !== null && jobs.length === 0 && <div style={styles.dim}>No scheduled jobs.</div>}
          {jobs.map(job => (
            <div key={job.id} style={styles.job}>
              <div>{truncate(job.prompt, 80)}</div>
              <div style={styles.dim}>
                {job.id} · {describeSchedule(job)} · next {job.nextAt} · fired {job.fireCount}x
              </div>
              <div>
                <button type="button" style={styles.action} onClick={() => { void act('fire', job.id) }}>Run now</button>
                <button type="button" style={styles.action} onClick={() => { void act('remove', job.id) }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
