/**
 * dsh-cron browser half: the cron job panel on the sidebar footer action
 * slot. The panel polls the host `/cron` channel — no model involvement.
 * @module
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the 'sidebar.footer.action' SlotMap merge declared by the
// sidebar owner package into this compilation unit.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { CronPanel } from './CronPanel.tsx'
import { en, zh, type CronKey } from './locales.ts'

/** Namespace owning the cron panel copy; merged into LocaleNamespaceMap. */
export const CRON_LOCALE_NS = 'sidebar.cron'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cron sidebar panel copy. */
    'sidebar.cron': CronKey
  }
}

export const inject = ['slots', 'connection', 'locale']

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as unknown as ConnectionHandle

  // Registration is an effect: the disposer releases on fiber end.
  ctx.effect(() => ctx.locale.register(CRON_LOCALE_NS, { zh, en }), 'dsh-cron: panel dictionaries')

  // Mount inside the owner's declaration lifetime: the panel registers only
  // while the footer action slot exists, and unloads with this plugin.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'cron',
    order: 20,
    locale: CRON_LOCALE_NS,
    inject: () => ({ connection }),
  }, CronPanel))
}
