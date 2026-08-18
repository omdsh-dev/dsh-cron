/**
 * Locale bundles for the cron sidebar panel, following the dsh web shell
 * bilingual convention: one flat key union, complete en and zh dictionaries.
 * Template placeholders use the `{name}` form; missing text stays visible as
 * its key (fail loud in the UI rather than blank).
 * @module
 */

export type CronKey =
  /** Trigger row and panel title label. */
  | 'label'
  /** Panel header with the job count. */
  | 'headerCount'
  /** Empty job list. */
  | 'empty'
  /** Fire a job immediately. */
  | 'runNow'
  /** Pause a recurring job. */
  | 'pause'
  /** Resume a paused job. */
  | 'resume'
  /** Remove a job. */
  | 'remove'
  /** A finished job. */
  | 'stateDone'
  /** A paused job. */
  | 'statePaused'
  /** Next fire time of an active job. */
  | 'nextAt'
  /** Total fires so far. */
  | 'firedCount'
  /** Last run outcome. */
  | 'lastRun'
  /** Last run outcome with a result excerpt. */
  | 'lastRunWithExcerpt'
  /** One-shot schedule. */
  | 'scheduleAt'
  /** Recurring schedule with its time zone. */
  | 'scheduleExpr'
  /** Firing found no target session. */
  | 'errorNoTarget'
  /** Firing a missing job. */
  | 'errorMissing'
  /** Updating a finished or unknown job. */
  | 'errorUpdate'

export const en: Record<CronKey, string> = {
  label: 'Scheduled tasks',
  headerCount: 'Scheduled tasks ({count})',
  empty: 'No scheduled tasks.',
  runNow: 'Run now',
  pause: 'Pause',
  resume: 'Resume',
  remove: 'Delete',
  stateDone: 'Done',
  statePaused: 'Paused',
  nextAt: 'Next {at}',
  firedCount: 'Fired {count} times',
  lastRun: 'Last {outcome}',
  lastRunWithExcerpt: 'Last {outcome}: {excerpt}',
  scheduleAt: 'Once · {at}',
  scheduleExpr: '{expression} ({timeZone})',
  errorNoTarget: '{id}: no session available to run this task (it will run when one appears)',
  errorMissing: '{id}: task not found',
  errorUpdate: '{id}: cannot update a finished or unknown task',
}

export const zh: Record<CronKey, string> = {
  label: '定时任务',
  headerCount: '定时任务（{count}）',
  empty: '暂无定时任务。',
  runNow: '立即运行',
  pause: '暂停',
  resume: '恢复',
  remove: '删除',
  stateDone: '已完成',
  statePaused: '已暂停',
  nextAt: '下次 {at}',
  firedCount: '已触发 {count} 次',
  lastRun: '上次 {outcome}',
  lastRunWithExcerpt: '上次 {outcome}：{excerpt}',
  scheduleAt: '一次性 · {at}',
  scheduleExpr: '{expression}（{timeZone}）',
  errorNoTarget: '{id}：没有可用会话运行该任务（将保留至会话出现）',
  errorMissing: '{id}：任务不存在',
  errorUpdate: '{id}：无法更新已结束或未知任务',
}
