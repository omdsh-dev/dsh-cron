/**
 * CronPanel: the sidebar footer action and its toggleable job list. The panel
 * polls the host `/cron` channel while open and refreshes after every action.
 * @module
 */

import { useEffect, useRef, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CronPanel.module.css'
import { IconCheckOutline14, IconClockOutline16, IconPauseOutline16 } from './icons.tsx'
import { callRpc } from './rpc.ts'
import type { CronFireWire, CronJobWire, CronListWire, CronUpdateWire } from './wire.ts'

const POLL_MS = 30_000

export interface CronPanelProps extends PropsLocale<'sidebar.cron'> {
  /** Owner prop of the `sidebar.footer.action` slot. */
  readonly wide: boolean
  /** Injected connection face. */
  readonly connection: ConnectionHandle
}

function describeSchedule(job: CronJobWire, t: CronPanelProps['t']): string {
  if (job.schedule.kind === 'at') return t('scheduleAt', { at: job.schedule.at })
  return t('scheduleExpr', { expression: job.schedule.expression, timeZone: job.schedule.timeZone })
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function CronPanel(props: CronPanelProps) {
  const { connection, t, wide } = props
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<CronListWire | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wrap = useRef<HTMLSpanElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  // Fixed-panel coordinates, measured from the trigger rect at open time.
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)

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

  // Light dismiss: the panel is a non-modal overlay, so a pointer outside the
  // trigger row or an Escape closes it (the trigger toggle covers clicks on
  // the trigger itself, which sits inside the same wrap).
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const act = async (endpoint: 'remove' | 'fire', id: string): Promise<void> => {
    try {
      if (endpoint === 'fire') {
        const outcome = await callRpc<CronFireWire>(connection, 'fire', { id })
        if (outcome.result !== 'fired') {
          setError(outcome.result === 'no_target'
            ? t('errorNoTarget', { id })
            : t('errorMissing', { id }))
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

  const togglePause = async (job: CronJobWire): Promise<void> => {
    try {
      const outcome = await callRpc<CronUpdateWire>(connection, 'update', { id: job.id, paused: !job.paused })
      if (!outcome.updated) setError(t('errorUpdate', { id: job.id }))
      const next = await callRpc<CronListWire>(connection, 'list')
      setList(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const jobs = list?.jobs ?? []
  const openPanel = (): void => {
    const rect = trigger.current?.getBoundingClientRect()
    // The panel floats 5px above the trigger, mirroring the absolute variant.
    setAnchor(rect === undefined
      ? null
      : { left: rect.left, bottom: window.innerHeight - rect.top + 5 })
    setOpen(value => !value)
  }
  return (
    <span ref={wrap} className={wide ? css.wrap : `${css.wrap} ${css.rail}`}>
      <button
        type="button"
        title={t('label')}
        aria-label={t('label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={css.trigger}
        ref={trigger}
        onClick={openPanel}
      >
        <IconClockOutline16 size={wide ? 16 : 18} />
        {wide && <span>{t('label')}</span>}
      </button>
      {open && (
        <div className={css.panel} role="dialog" aria-label={t('label')} style={anchor ?? undefined}>
          <div className={css.header}>{t('headerCount', { count: jobs.length })}</div>
          {error !== null && <div className={css.error}>{error}</div>}
          {list !== null && jobs.length === 0 && <div className={css.empty}>{t('empty')}</div>}
          {jobs.map(job => (
            <div key={job.id} className={`${css.job}${job.state === 'done' ? ` ${css.done}` : ''}`}>
              <div className={css.title}>
                {job.paused && (
                  <span className={css.stateIcon}>
                    <IconPauseOutline16 size={12} />
                  </span>
                )}
                {job.state === 'done' && (
                  <span className={css.stateIcon}>
                    <IconCheckOutline14 size={12} />
                  </span>
                )}
                {truncate(job.prompt, 80)}
              </div>
              <div className={css.meta}>
                {job.id} · <span className={css.schedule}>{describeSchedule(job, t)}</span>
              </div>
              <div className={css.meta}>
                {job.state === 'done'
                  ? t('stateDone')
                  : job.paused
                    ? t('statePaused')
                    : t('nextAt', { at: job.nextAt })}
                {' · '}
                {t('firedCount', { count: job.fireCount })}
                {job.lastRun !== null && ` · ${
                  job.lastRun.excerpt !== undefined
                    ? t('lastRunWithExcerpt', {
                      outcome: job.lastRun.outcome,
                      excerpt: truncate(job.lastRun.excerpt, 40),
                    })
                    : t('lastRun', { outcome: job.lastRun.outcome })
                }`}
              </div>
              <div className={css.actions}>
                {job.state === 'active' && (
                  <>
                    <button type="button" className={css.action} onClick={() => { void act('fire', job.id) }}>{t('runNow')}</button>
                    <button type="button" className={css.action} onClick={() => { void togglePause(job) }}>{job.paused ? t('resume') : t('pause')}</button>
                  </>
                )}
                <button type="button" className={`${css.action} ${css.actionDanger}`} onClick={() => { void act('remove', job.id) }}>{t('remove')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
