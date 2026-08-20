/**
 * Cron task center: a sidebar entry opening a modal for creating, inspecting,
 * and managing durable scheduled tasks through the loopback `/cron` channel.
 * @module
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CronPanel.module.css'
import {
  IconCheckOutline14,
  IconChevronDownOutline16,
  IconClockOutline16,
  IconCloseOutline16,
  IconPauseOutline16,
  IconPlusOutline16,
} from './icons.tsx'
import { callRpc } from './rpc.ts'
import type { CronAddWire, CronFireWire, CronJobWire, CronListWire, CronRemoveWire, CronUpdateWire } from './wire.ts'

const POLL_MS = 30_000

type Filter = 'all' | 'active' | 'paused' | 'done'
type ScheduleKind = 'cron' | 'at'

interface Draft {
  prompt: string
  kind: ScheduleKind
  cron: string
  timeZone: string
  at: string
}

export type CronPanelProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'sidebar.cron'> & {
  /** Injected connection face. */
  readonly connection: ConnectionHandle
}

function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

function initialDraft(): Draft {
  return { prompt: '', kind: 'cron', cron: '0 9 * * 1-5', timeZone: defaultTimeZone(), at: '' }
}

/** Format a wire timestamp in the browser's locale and time zone. */
export function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function outcomeLabel(outcome: NonNullable<CronJobWire['lastRun']>['outcome'], t: CronPanelProps['t']): string {
  return t(`outcome.${outcome}`)
}

function scheduleLabel(job: CronJobWire, t: CronPanelProps['t']): string {
  if (job.schedule.kind === 'at') return t('scheduleOnce')
  return t('scheduleRecurring', { timeZone: job.schedule.timeZone })
}

function visibleFor(job: CronJobWire, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'done') return job.state === 'done'
  if (filter === 'paused') return job.state === 'active' && job.paused
  return job.state === 'active' && !job.paused
}

function createPayload(draft: Draft, createdBy: string | undefined): {
  prompt: string
  cron?: string
  timeZone?: string
  at?: string
  createdBy?: string
} {
  const owner = createdBy === undefined ? {} : { createdBy }
  if (draft.kind === 'cron') {
    return { prompt: draft.prompt, cron: draft.cron, timeZone: draft.timeZone, ...owner }
  }
  return { prompt: draft.prompt, at: new Date(draft.at).toISOString(), ...owner }
}

function createErrorMessage(cause: unknown, t: CronPanelProps['t']): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (message.includes('invalid_prompt:')) return t('createErrorPrompt')
  if (message.includes('invalid_cron_expression:')) return t('createErrorCron')
  if (message.includes('invalid_time_zone:')) return t('createErrorTimeZone')
  if (message.includes('not_future:')) return t('createErrorFuture')
  if (message.includes('too_frequent:')) return t('createErrorFrequent')
  if (message.includes('too_many_jobs:')) return t('createErrorLimit')
  if (message.includes('schedule_unreachable:')) return t('createErrorUnreachable')
  if (message.includes('invalid_selector:')) return t('createErrorSchedule')
  return message
}

export function CronPanel({ connection, t, useSessions, wide }: CronPanelProps) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<CronListWire | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const triggerButton = useRef<HTMLButtonElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const currentSession = useSessions(state => state.current)

  const close = useCallback((): void => {
    setOpen(false)
    setCreating(false)
    setDraft(initialDraft())
    setExpanded(null)
    setConfirmRemove(null)
    setError(null)
    setNotice(null)
    triggerButton.current?.focus()
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const next = await callRpc<CronListWire>(connection, 'list', {}, signal)
    setList(next)
    setError(null)
  }, [connection])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError(t('errorLoad'))
    })
    const timer = setInterval(() => {
      void refresh(controller.signal).catch(() => {})
    }, POLL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [open, refresh, t])

  useEffect(() => {
    if (!open) return undefined
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [close, open])

  const jobs = list?.jobs ?? []
  const visibleJobs = useMemo(() => jobs.filter(job => visibleFor(job, filter)), [filter, jobs])
  const counts = useMemo(() => ({
    all: jobs.length,
    active: jobs.filter(job => job.state === 'active' && !job.paused).length,
    paused: jobs.filter(job => job.state === 'active' && job.paused).length,
    done: jobs.filter(job => job.state === 'done').length,
  }), [jobs])

  const runAction = async (kind: 'fire' | 'pause' | 'remove', job: CronJobWire): Promise<void> => {
    setBusy(`${kind}:${job.id}`)
    setError(null)
    setNotice(null)
    try {
      if (kind === 'fire') {
        const outcome = await callRpc<CronFireWire>(connection, 'fire', { id: job.id })
        if (outcome.result !== 'fired') {
          throw new Error(outcome.result === 'no_target' ? t('errorNoTarget', { id: job.id }) : t('errorMissing', { id: job.id }))
        }
        setNotice(t('noticeFired', { id: job.id }))
      } else if (kind === 'pause') {
        const outcome = await callRpc<CronUpdateWire>(connection, 'update', { id: job.id, paused: !job.paused })
        if (!outcome.updated) throw new Error(t('errorUpdate', { id: job.id }))
        setNotice(job.paused ? t('noticeResumed', { id: job.id }) : t('noticePaused', { id: job.id }))
      } else {
        const outcome = await callRpc<CronRemoveWire>(connection, 'remove', { id: job.id })
        if (!outcome.removed) throw new Error(t('errorMissing', { id: job.id }))
        setConfirmRemove(null)
        setExpanded(null)
        setNotice(t('noticeRemoved', { id: job.id }))
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const submitCreate = async (): Promise<void> => {
    if (draft.prompt.trim().length === 0) {
      setError(t('errorPrompt'))
      return
    }
    if (draft.kind === 'cron' && (draft.cron.trim().length === 0 || draft.timeZone.trim().length === 0)) {
      setError(t('errorSchedule'))
      return
    }
    if (draft.kind === 'at' && (draft.at.length === 0 || Number.isNaN(new Date(draft.at).getTime()))) {
      setError(t('errorSchedule'))
      return
    }
    setBusy('create')
    setError(null)
    setNotice(null)
    try {
      const outcome = await callRpc<CronAddWire>(connection, 'add', createPayload(draft, currentSession))
      setNotice(outcome.deduplicated ? t('noticeDeduplicated', { id: outcome.job.id }) : t('noticeCreated', { id: outcome.job.id }))
      setDraft(initialDraft())
      setCreating(false)
      setFilter('all')
      await refresh()
    } catch (cause) {
      setError(createErrorMessage(cause, t))
    } finally {
      setBusy(null)
    }
  }

  const cancelCreate = (): void => {
    setCreating(false)
    setDraft(initialDraft())
    setError(null)
    setNotice(null)
  }

  const selectFilter = (next: Filter): void => {
    setFilter(next)
    setCreating(false)
    setDraft(initialDraft())
    setExpanded(null)
    setConfirmRemove(null)
    setError(null)
    setNotice(null)
  }

  return (
    <>
      <button
        type="button"
        title={t('label')}
        aria-label={t('label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${css.trigger}${wide ? '' : ` ${css.rail}`}`}
        ref={triggerButton}
        onClick={() => { setError(null); setNotice(null); setOpen(true) }}
      >
        <IconClockOutline16 size={wide ? 16 : 18} />
        {wide && <span>{t('label')}</span>}
      </button>
      {open && (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={close} />
          <section className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy !== null}>
            <aside className={css.nav}>
              <div className={css.navTitle} id={titleId}>{t('label')}</div>
              <div className={css.navList}>
                {(['all', 'active', 'paused', 'done'] as const).map(id => (
                  <button
                    key={id}
                    type="button"
                    className={`${css.navCell}${filter === id ? ` ${css.navActive}` : ''}`}
                    aria-current={filter === id ? 'true' : undefined}
                    onClick={() => { selectFilter(id) }}
                  >
                    <span>{t(`filter.${id}`)}</span>
                    <span className={css.count}>{counts[id]}</span>
                  </button>
                ))}
              </div>
              <div className={css.navHint}>{t('navHint')}</div>
            </aside>
            <main className={css.content}>
              <header className={css.header}>
                <div>
                  <h2>{creating ? t('createTitle') : t(`filter.${filter}`)}</h2>
                  <p>{creating ? t('createSubtitle') : t('headerSummary', { count: visibleJobs.length })}</p>
                </div>
                <div className={css.headerActions}>
                  {!creating && (
                    <button type="button" className={css.primaryButton} onClick={() => { setCreating(true); setError(null); setNotice(null) }}>
                      <IconPlusOutline16 />
                      {t('newTask')}
                    </button>
                  )}
                  <button ref={closeButton} type="button" className={css.iconButton} aria-label={t('close')} onClick={close}>
                    <IconCloseOutline16 size={16} />
                  </button>
                </div>
              </header>
              {(error !== null || notice !== null) && (
                <div className={error !== null ? css.error : css.notice} role={error !== null ? 'alert' : 'status'}>
                  {error ?? notice}
                </div>
              )}
              <div className={css.body}>
                {creating ? (
                  <form className={css.form} onSubmit={(event) => { event.preventDefault(); void submitCreate() }}>
                    <label className={css.field}>
                      <span>{t('fieldPrompt')}</span>
                      <textarea
                        value={draft.prompt}
                        rows={4}
                        placeholder={t('promptPlaceholder')}
                        onChange={event => { setDraft(current => ({ ...current, prompt: event.target.value })); setError(null) }}
                      />
                    </label>
                    <fieldset className={css.fieldset}>
                      <legend>{t('fieldScheduleType')}</legend>
                      <div className={css.segmented}>
                        {(['cron', 'at'] as const).map(kind => (
                          <button
                            key={kind}
                            type="button"
                            className={draft.kind === kind ? css.segmentActive : undefined}
                            aria-pressed={draft.kind === kind}
                            onClick={() => { setDraft(current => ({ ...current, kind })); setError(null) }}
                          >
                            {t(`kind.${kind}`)}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    {draft.kind === 'cron' ? (
                      <div className={css.fieldGrid}>
                        <label className={css.field}>
                          <span>{t('fieldCron')}</span>
                          <input value={draft.cron} spellCheck={false} onChange={event => { setDraft(current => ({ ...current, cron: event.target.value })); setError(null) }} />
                          <small>{t('cronHint')}</small>
                        </label>
                        <label className={css.field}>
                          <span>{t('fieldTimeZone')}</span>
                          <input value={draft.timeZone} spellCheck={false} onChange={event => { setDraft(current => ({ ...current, timeZone: event.target.value })); setError(null) }} />
                          <small>{t('timeZoneHint')}</small>
                        </label>
                      </div>
                    ) : (
                      <label className={css.field}>
                        <span>{t('fieldAt')}</span>
                        <input type="datetime-local" value={draft.at} onChange={event => { setDraft(current => ({ ...current, at: event.target.value })); setError(null) }} />
                        <small>{t('atHint')}</small>
                      </label>
                    )}
                    <div className={css.formActions}>
                      <button type="button" className={css.secondaryButton} onClick={cancelCreate}>{t('cancel')}</button>
                      <button type="submit" className={css.primaryButton} disabled={busy === 'create'}>{busy === 'create' ? t('creating') : t('create')}</button>
                    </div>
                  </form>
                ) : list === null ? (
                  <div className={css.empty}>{t('loading')}</div>
                ) : visibleJobs.length === 0 ? (
                  <div className={css.empty}>
                    <span className={css.emptyIcon}><IconClockOutline16 size={24} /></span>
                    <h3>{t('emptyTitle')}</h3>
                    <p>{filter === 'all' ? t('emptyAll') : t('emptyFilter')}</p>
                    {filter === 'all' && <button type="button" className={css.primaryButton} onClick={() => { setCreating(true) }}>{t('newTask')}</button>}
                  </div>
                ) : (
                  <div className={css.jobList}>
                    {visibleJobs.map(job => {
                      const isExpanded = expanded === job.id
                      const status = job.state === 'done' ? 'done' : job.paused ? 'paused' : 'active'
                      return (
                        <article key={job.id} className={css.job}>
                          <button
                            type="button"
                            className={css.jobMain}
                            aria-expanded={isExpanded}
                            aria-controls={`cron-details-${job.id}`}
                            onClick={() => { setExpanded(isExpanded ? null : job.id); setConfirmRemove(null) }}
                          >
                            <span className={`${css.statusIcon} ${css[status]}`}>
                              {status === 'done' ? <IconCheckOutline14 size={14} /> : status === 'paused' ? <IconPauseOutline16 size={14} /> : <IconClockOutline16 size={14} />}
                            </span>
                            <span className={css.jobText}>
                              <strong>{job.prompt}</strong>
                              <span>{scheduleLabel(job, t)} · {job.schedule.kind === 'cron' ? job.schedule.expression : formatDateTime(job.schedule.at)}</span>
                            </span>
                            <span className={`${css.jobNext}${status === 'active' ? '' : ` ${css.statusPill}`}`}>
                              {status === 'active' ? t('nextShort', { at: formatDateTime(job.nextAt) }) : t(`state.${status}`)}
                            </span>
                            <span className={`${css.disclosure}${isExpanded ? ` ${css.disclosureOpen}` : ''}`} aria-hidden="true">
                              <IconChevronDownOutline16 size={16} />
                            </span>
                          </button>
                          {isExpanded && (
                            <div className={css.details} id={`cron-details-${job.id}`}>
                              <dl>
                                <div><dt>{t('detailId')}</dt><dd><code>{job.id}</code></dd></div>
                                <div><dt>{t('detailCreated')}</dt><dd>{formatDateTime(job.createdAt)}</dd></div>
                                <div><dt>{t('detailFires')}</dt><dd>{t('firedCount', { count: job.fireCount })}</dd></div>
                                {job.lastRun !== null && <div><dt>{t('detailLastRun')}</dt><dd>{outcomeLabel(job.lastRun.outcome, t)} · {formatDateTime(job.lastRun.firedAt)}</dd></div>}
                              </dl>
                              {job.lastRun?.excerpt !== undefined && <div className={css.excerpt}>{job.lastRun.excerpt}</div>}
                              <div className={css.jobActions}>
                                {job.state === 'active' && (
                                  <>
                                    <button type="button" className={css.secondaryButton} disabled={busy !== null} onClick={() => { void runAction('fire', job) }}>{t('runNow')}</button>
                                    <button type="button" className={css.secondaryButton} disabled={busy !== null} onClick={() => { void runAction('pause', job) }}>{job.paused ? t('resume') : t('pause')}</button>
                                  </>
                                )}
                                {confirmRemove === job.id ? (
                                  <span className={css.confirm}>
                                    <span>{t('confirmRemove')}</span>
                                    <button type="button" className={css.linkButton} onClick={() => { setConfirmRemove(null) }}>{t('cancel')}</button>
                                    <button type="button" className={css.dangerButton} disabled={busy !== null} onClick={() => { void runAction('remove', job) }}>{t('confirm')}</button>
                                  </span>
                                ) : (
                                  <button type="button" className={css.dangerLink} onClick={() => { setConfirmRemove(job.id) }}>{t('remove')}</button>
                                )}
                              </div>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>
            </main>
          </section>
        </div>
      )}
    </>
  )
}
