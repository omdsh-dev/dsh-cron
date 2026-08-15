/**
 * Cross-session scheduled tasks (cron) for DeepSeek Harness.
 * @module dsh-cron
 */

/** Cordis plugin name; keep this stable after publishing. */
export const name = 'dsh-cron'

/** Services that must exist before the plugin is applied. */
export const inject = ['agents', 'tools']

export { Config } from './config.ts'
export type { ResolvedConfig } from './config.ts'
export { apply } from './runtime.ts'
export type { PluginRuntime } from './runtime.ts'
export type { CronService, CronTarget, AddJobInput } from './scheduler.ts'
export type { CronJob, JobSchedule } from './store.ts'
