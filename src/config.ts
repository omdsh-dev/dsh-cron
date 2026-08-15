/**
 * Serializable configuration, schema, and direct-call defaults.
 * @module dsh-cron/config
 */

import z from '@deepseek-ai/schemastery'

/** Plugin configuration supplied by the profile composition. */
export interface Config {
  /** Directory holding the durable job store; defaults to the `cron` directory inside the Harness home. */
  dataDir?: string
  /** IANA time zone for cron schedules that omit one. */
  defaultTimeZone?: string
  /** Maximum number of jobs the store accepts. */
  maxJobs?: number
  /** Minimum minutes between two occurrences of one recurring job. */
  minIntervalMinutes?: number
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
}

/** Loader-visible configuration schema and defaults. */
export const Config: z<Config> = z.object({
  dataDir: z.string(),
  defaultTimeZone: z.string().default('UTC'),
  maxJobs: z.number().default(64),
  minIntervalMinutes: z.number().default(1),
})

/**
 * Resolve the same defaults for direct callers that bypass Cordis Loader.
 * @param config - Partial serialized configuration.
 * @returns Configuration with all defaults applied.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    ...(config.dataDir !== undefined ? { dataDir: config.dataDir } : {}),
    defaultTimeZone: config.defaultTimeZone ?? 'UTC',
    maxJobs: config.maxJobs ?? 64,
    minIntervalMinutes: config.minIntervalMinutes ?? 1,
  }
}
