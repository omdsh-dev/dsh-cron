/**
 * Serializable configuration, schema, and direct-call defaults.
 * @module dsh-cron/config
 */

import z from '@deepseek-ai/schemastery'

/** Plugin configuration supplied by the profile composition. */
export interface Config {
  /** Directory holding the durable job store; defaults to the `cron` directory inside the Harness home. */
  dataDir?: string
  /** IANA time zone for cron schedules that omit one; defaults to the host's local zone. */
  defaultTimeZone?: string
  /** Maximum number of jobs the store accepts. */
  maxJobs?: number
  /** Minimum minutes between two occurrences of one recurring job. */
  minIntervalMinutes?: number
  /** Default absolute workspace for UI/API jobs that do not supply a fresh Session target. */
  defaultCwd?: string
  /** Durable Automation event-feed reconciliation interval. */
  reconcilePollMs?: number
  /** Maximum retained occurrence records per job; active records are never trimmed. */
  maxRunHistory?: number
}

/** Configuration after defaults have been resolved. */
export interface ResolvedConfig {
  /** Directory holding the durable job store, or undefined for the Harness-home default. */
  dataDir?: string
  /** IANA time zone for cron schedules that omit one. */
  defaultTimeZone: string
  /** Maximum number of jobs the store accepts. */
  maxJobs: number
  /** Minimum minutes between two occurrences of one recurring job. */
  minIntervalMinutes: number
  defaultCwd?: string
  reconcilePollMs: number
  maxRunHistory: number
}

/** Loader-visible configuration schema and defaults. */
export const Config: z<Config> = z.object({
  dataDir: z.string(),
  defaultTimeZone: z.string(),
  maxJobs: z.number().default(64),
  minIntervalMinutes: z.number().default(1),
  defaultCwd: z.string(),
  reconcilePollMs: z.number().step(1).min(100).max(60_000).default(1_000),
  maxRunHistory: z.number().step(1).min(10).max(10_000).default(100),
})

/** The host's local IANA time zone. */
export function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}

/**
 * Resolve the same defaults for direct callers that bypass Cordis Loader.
 * @param config - Partial serialized configuration.
 * @returns Configuration with all defaults applied.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    ...(config.dataDir !== undefined ? { dataDir: config.dataDir } : {}),
    defaultTimeZone: config.defaultTimeZone ?? hostTimeZone(),
    maxJobs: config.maxJobs ?? 64,
    minIntervalMinutes: config.minIntervalMinutes ?? 1,
    ...(config.defaultCwd === undefined ? {} : { defaultCwd: config.defaultCwd }),
    reconcilePollMs: config.reconcilePollMs ?? 1_000,
    maxRunHistory: config.maxRunHistory ?? 100,
  }
}
