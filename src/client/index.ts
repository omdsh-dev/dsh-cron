/**
 * dsh-cron browser half: the cron job panel on the sidebar footer action
 * slot. The panel polls the host `/cron` channel — no model involvement.
 * @module
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the 'sidebar.footer.action' SlotMap merge declared by the
// sidebar owner package into this compilation unit.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { CronPanel } from './CronPanel.tsx'

export const inject = ['slots', 'connection']

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as unknown as ConnectionHandle

  // Mount inside the owner's declaration lifetime: the panel registers only
  // while the footer action slot exists, and unloads with this plugin.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'cron',
    order: 20,
    inject: () => ({ connection }),
  }, CronPanel))
}
