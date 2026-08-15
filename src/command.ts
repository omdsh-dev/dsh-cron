/**
 * Human-facing `/cron` slash command: list, add, add-at, remove.
 * @module dsh-cron/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { CronScheduler } from './scheduler.ts'
import type { CronJob } from './store.ts'

const USAGE = 'Usage: /cron list | /cron remove <id> | /cron add [tz=Zone] <minute> <hour> <dom> <month> <dow> <prompt...> | /cron add-at <rfc3339> <prompt...>'

const WHITESPACE = new RegExp('\\s+')

function formatJob(job: CronJob): string {
  const schedule = job.schedule.kind === 'cron'
    ? `cron "${job.schedule.expression}" (${job.schedule.timeZone})`
    : `at ${job.schedule.at}`
  return `${job.id}  ${schedule}  next ${job.nextAt}  fired ${job.fireCount}x  ${job.prompt}`
}

function formatList(scheduler: CronScheduler): CommandResult {
  const jobs = scheduler.listJobs()
  if (jobs.length === 0) return { kind: 'success', text: 'No scheduled jobs.' }
  return { kind: 'success', text: jobs.map(formatJob).join('\n') }
}

/**
 * Register the `/cron` command on the commands service.
 * @param ctx - context carrying the `commands` service.
 * @param scheduler - the running scheduler.
 * @returns the registration disposer.
 */
export function registerCronCommand(ctx: Context, scheduler: CronScheduler): () => void {
  return ctx.commands.register({
    name: 'cron',
    description: 'Manage scheduled tasks (dsh-cron)',
    input: { hint: 'list | remove <id> | add <m> <h> <dom> <mon> <dow> <prompt> | add-at <rfc3339> <prompt>' },
    handler: ({ rawInput, agent }): CommandResult => {
      const createdBy = String(agent.id)
      const input = rawInput.trim()
      if (input === '' || input === 'list') return formatList(scheduler)
      if (input.startsWith('remove ')) {
        const id = input.slice('remove '.length).trim()
        if (id.length === 0) return { kind: 'error', text: USAGE }
        return scheduler.removeJob(id)
          ? { kind: 'success', text: `Removed ${id}.` }
          : { kind: 'error', text: `No such job: ${id}` }
      }
      if (input.startsWith('add-at ')) {
        const rest = input.slice('add-at '.length).trim()
        const space = rest.indexOf(' ')
        if (space === -1) return { kind: 'error', text: USAGE }
        try {
          const job = scheduler.addJob({ at: rest.slice(0, space), prompt: rest.slice(space + 1), createdBy })
          return { kind: 'success', text: `Added ${formatJob(job)}` }
        } catch (error) {
          return { kind: 'error', text: `cron add-at: ${(error as Error).message}` }
        }
      }
      if (input.startsWith('add ')) {
        const tokens = input.slice('add '.length).trim().split(WHITESPACE)
        let timeZone: string | undefined
        if (tokens[0]?.startsWith('tz=')) timeZone = tokens.shift()?.slice(3)
        if (tokens.length < 6) return { kind: 'error', text: USAGE }
        const expression = tokens.slice(0, 5).join(' ')
        const prompt = tokens.slice(5).join(' ')
        try {
          const job = scheduler.addJob({
            cron: expression,
            prompt,
            createdBy,
            ...(timeZone === undefined ? {} : { timeZone }),
          })
          return { kind: 'success', text: `Added ${formatJob(job)}` }
        } catch (error) {
          return { kind: 'error', text: `cron add: ${(error as Error).message}` }
        }
      }
      return { kind: 'error', text: USAGE }
    },
  })
}
