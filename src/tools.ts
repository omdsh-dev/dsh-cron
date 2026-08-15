/**
 * Model-facing tools: cron_add, cron_list, cron_remove.
 * @module dsh-cron/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CronScheduler } from './scheduler.ts'

/**
 * Register the three management tools on the global tool registry.
 * @param ctx - plugin context carrying the `tools` service.
 * @param scheduler - the running scheduler.
 */
export function registerCronTools(ctx: Context, scheduler: CronScheduler): void {
  ctx.tools.register(defineTool({
    name: 'cron_add',
    description: 'Schedule a durable, cross-session task: it survives restarts and fires even when this conversation is closed (prefer this over session-local reminders for anything beyond the current chat). The prompt fires as a scheduled-task follow-up turn that the agent executes.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Task prompt delivered when the schedule fires.',
      },
      cron: {
        type: 'string',
        description: 'Five-field cron expression: minute hour day-of-month month day-of-week (numeric; 0 or 7 = Sunday). Exactly one of cron or at is required.',
      },
      time_zone: {
        type: 'string',
        description: 'IANA time zone interpreting the cron expression, e.g. "Asia/Shanghai". Defaults to the host local zone (or the plugin defaultTimeZone).',
      },
      at: {
        type: 'string',
        description: 'One-shot absolute time as RFC 3339 with an explicit offset or Z, e.g. "2026-08-20T09:00:00+08:00". Exactly one of cron or at is required.',
      },
    },
    output: {
      schema: { type: 'json' } as const,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: (args, exec) => {
      try {
        const result = scheduler.addJob({
          prompt: args.prompt,
          ...(args.cron !== undefined ? { cron: args.cron } : {}),
          ...(args.time_zone !== undefined ? { timeZone: args.time_zone } : {}),
          ...(args.at !== undefined ? { at: args.at } : {}),
          createdBy: exec.agent === undefined ? null : String(exec.agent.id),
        })
        return Promise.resolve({ ...result.job, deduplicated: result.deduplicated, nextOccurrences: result.nextOccurrences } as unknown as JsonValue)
      } catch (error) {
        throw new Error(`cron_add: ${(error as Error).message}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cron_update',
    description: 'Pause or resume a scheduled job. Paused jobs keep their schedule and statistics but do not fire; resuming a recurring job moves its next fire past now.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Job id as returned by cron_add or cron_list, e.g. "cron-3".',
      },
      paused: {
        type: 'boolean',
        required: true,
        description: 'true to pause, false to resume.',
      },
    },
    output: {
      schema: { type: 'json' } as const,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: (args) => {
      const id = args.id.trim()
      if (id.length === 0) throw new Error('cron_update: id must be non-blank')
      const updated = scheduler.setPaused(id, args.paused)
      return Promise.resolve({ id, paused: args.paused, updated } as JsonValue)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cron_list',
    description: 'List every scheduled job (including paused and finished one-shots) with its id, schedule, state, next fire time, and last run outcome.',
    parameters: {},
    output: {
      schema: { type: 'json' } as const,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: () => Promise.resolve(scheduler.listJobs() as unknown as JsonValue),
  }))

  ctx.tools.register(defineTool({
    name: 'cron_remove',
    description: 'Remove a scheduled job by id.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Job id as returned by cron_add or cron_list, e.g. "cron-3".',
      },
    },
    output: {
      schema: { type: 'json' } as const,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: (args) => {
      const id = args.id.trim()
      if (id.length === 0) throw new Error('cron_remove: id must be non-blank')
      return Promise.resolve({ id, removed: scheduler.removeJob(id) })
    },
  }))
}
