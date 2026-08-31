/** Cordis activation for the cron Trigger adapter. */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CronAutomationAdapter } from './adapter.ts'
import { requireAutomation, type AutomationTarget } from './automation.ts'
import { registerCronCommand } from './command.ts'
import { resolveConfig, type Config } from './config.ts'
import { acquireSchedulerLock } from './lock.ts'
import { registerCronRpc } from './rpc.ts'
import { CronScheduler } from './scheduler.ts'
import { CronStore, type CronRunRecord } from './store.ts'
import { registerCronTools } from './tools.ts'

export interface PluginRuntime {
  now(): number
  warn(message: string): void
  info(message: string): void
}

export function createPluginRuntime(ctx: Context): PluginRuntime {
  return {
    now: () => Date.now(),
    warn: message => { ctx.logger.warn(message) },
    info: message => { ctx.logger.info(message) },
  }
}

interface OutboundCallbacks {
  emit(event: {
    readonly source: 'cron'
    readonly subject: string
    readonly outcome?: string
    readonly excerpt?: string
    readonly jobId?: string
    readonly firedAt?: string
    readonly completedAt?: string
  }): void
}

export interface CronSettledEvent {
  readonly jobId: string
  readonly run: CronRunRecord
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'cron/settled'(event: CronSettledEvent): void
  }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const runtime = createPluginRuntime(ctx)
  const automation = requireAutomation(ctx.get('automation'))
  const dataDir = resolved.dataDir ?? join(resolveDshHome(), 'cron')
  const defaultTarget: AutomationTarget | undefined = resolved.defaultCwd === undefined
    ? undefined
    : { kind: 'fresh', cwd: resolved.defaultCwd }
  const store = new CronStore(
    join(dataDir, 'jobs.json'), message => runtime.warn(message), defaultTarget, resolved.maxRunHistory,
  )
  store.load()
  const adapter = new CronAutomationAdapter(
    store,
    automation,
    () => runtime.now(),
    message => runtime.warn(message),
    (job, run) => { ctx.emit('cron/settled', { jobId: job.id, run }) },
  )
  const scheduler = new CronScheduler({
    store,
    adapter,
    now: () => runtime.now(),
    armTimer: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      return () => { clearTimeout(timer) }
    },
    warn: message => runtime.warn(message),
    ...(defaultTarget === undefined ? {} : { defaultTarget }),
    defaultTimeZone: resolved.defaultTimeZone,
    maxJobs: resolved.maxJobs,
    minIntervalMinutes: resolved.minIntervalMinutes,
  })

  ctx.provide('cron', scheduler.service())
  registerCronTools(ctx, scheduler)
  ctx.effect(() => store.watch(jobs => {
    runtime.info(`dsh-cron: job store reloaded (${jobs} job(s))`)
    scheduler.storeChanged()
  }), 'dsh-cron: store watch')
  ctx.inject(['commands'], commandCtx => {
    commandCtx.effect(() => registerCronCommand(commandCtx, scheduler), 'dsh-cron: command')
  })
  ctx.inject(['connection'], connectionCtx => {
    connectionCtx.effect(() => registerCronRpc(connectionCtx, scheduler.service()), 'dsh-cron: rpc')
  })
  mountCallbacks(ctx)
  ctx.effect(() => {
    let lock = acquireSchedulerLock(dataDir, message => runtime.warn(message))
    let takeover: ReturnType<typeof setInterval> | null = null
    let reconcile: ReturnType<typeof setInterval> | null = null
    const start = (): void => {
      store.load()
      scheduler.start()
      reconcile = setInterval(() => {
        void scheduler.reconcile().catch(error => { runtime.warn(`dsh-cron: reconciliation failed: ${message(error)}`) })
      }, resolved.reconcilePollMs)
      runtime.info(`dsh-cron: scheduling ${store.list().length} job(s) through Automation`)
    }
    if (lock.acquired) start()
    else {
      takeover = setInterval(() => {
        lock = acquireSchedulerLock(dataDir, message => runtime.warn(message))
        if (!lock.acquired) return
        if (takeover !== null) clearInterval(takeover)
        takeover = null
        start()
      }, 60_000)
    }
    return () => {
      if (takeover !== null) clearInterval(takeover)
      if (reconcile !== null) clearInterval(reconcile)
      scheduler.stop()
      lock.release()
    }
  }, 'dsh-cron: scheduler')
}

function mountCallbacks(ctx: Context): void {
  ctx.inject(['callbacks'], callbacksCtx => {
    callbacksCtx.effect(() => callbacksCtx.on('cron/settled', event => {
      const callbacks = callbacksCtx.get('callbacks') as OutboundCallbacks | undefined
      if (callbacks === undefined) return
      callbacks.emit({
        source: 'cron', subject: `${event.jobId} · ${event.run.state}`,
        ...(event.run.outcome === undefined ? {} : { outcome: event.run.outcome }),
        ...(event.run.excerpt === undefined ? {} : { excerpt: event.run.excerpt }),
        jobId: event.jobId, firedAt: event.run.firedAt,
        ...(event.run.completedAt === undefined ? {} : { completedAt: event.run.completedAt }),
      })
    }), 'dsh-cron: callbacks')
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
