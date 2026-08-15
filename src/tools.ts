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
    description: 'Schedule a task for later or recurring delivery to an agent session. The prompt fires as a scheduled-task message: a follow-up turn when the target agent is idle, an injected notification when it is busy.',
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
        description: 'IANA time zone interpreting the cron expression, e.g. "Asia/Shanghai". Defaults to the plugin defaultTimeZone.',
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
        const job = scheduler.addJob({
          prompt: args.prompt,
          ...(args.cron !== undefined ? { cron: args.cron } : {}),
          ...(args.time_zone !== undefined ? { timeZone: args.time_zone } : {}),
          ...(args.at !== undefined ? { at: args.at } : {}),
          createdBy: exec.agent === undefined ? null : String(exec.agent.id),
        })
        return Promise.resolve(job as unknown as JsonValue)
      } catch (error) {
        throw new Error(`cron_add: ${(error as Error).message}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cron_list',
    description: 'List every scheduled job with its id, schedule, next fire time, and dispatch counters.',
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
