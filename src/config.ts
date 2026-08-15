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
  /**
   * Resume a due job's cold creating session so the task can fire without any
   * live session. Off by default: a woken session runs unattended model turns.
   */
  coldWake?: boolean
  /**
   * Delivery when the target agent is busy. `followup` queues the task as the
   * next turn (it always executes); `inject` rides the running turn as
   * context and may not be acted on.
   */
  busyDelivery?: 'followup' | 'inject'
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
  /** Resume a due job's cold creating session. */
  coldWake: boolean
  /** Delivery mode for busy targets. */
  busyDelivery: 'followup' | 'inject'
}

/** Loader-visible configuration schema and defaults. */
export const Config: z<Config> = z.object({
  dataDir: z.string(),
  defaultTimeZone: z.string(),
  maxJobs: z.number().default(64),
  minIntervalMinutes: z.number().default(1),
  coldWake: z.boolean().default(false),
  busyDelivery: z.union([z.const('followup'), z.const('inject')]).default('followup'),
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
    coldWake: config.coldWake ?? false,
    busyDelivery: config.busyDelivery ?? 'followup',
  }
}
