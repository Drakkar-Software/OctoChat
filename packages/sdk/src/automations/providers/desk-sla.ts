/**
 * Desk SLA escalation provider — posts a reminder when a ticket's `slaDueAt`
 * deadline has passed. Designed to run on a daily/cron schedule.
 */
import type { AutomationProvider, RunResult } from '../types';

interface DeskSlaParams {
  /** Message posted when SLA is breached. Supports {title} placeholder. */
  escalationMessage: string;
}

export const deskSlaProvider: AutomationProvider<DeskSlaParams> = {
  id: 'desk-sla',
  name: 'Desk SLA Monitor',
  iconName: 'pulse',
  description: 'Posts an escalation reminder when a ticket\'s SLA deadline has passed.',
  defaults: {
    escalationMessage: '⚠️ SLA breach: this ticket has exceeded its response deadline.',
  },
  paramFields: [
    {
      key: 'escalationMessage',
      label: 'Escalation message',
      kind: 'textarea',
      placeholder: '⚠️ SLA breach…',
      required: true,
    },
  ],
  async fetch(params, ctx): Promise<RunResult> {
    // `slaDueAt` (epoch-ms) is stored in device-local kv under `secretParams` — the
    // desk setup flow writes it there when the SLA is configured. It mirrors the value
    // in `ObjectNode.meta.ticket.slaDueAt`, but RunCtx does not carry node meta
    // directly (the runner is type-agnostic). The setup flow is responsible for keeping
    // the two in sync when the SLA is updated via `patchTicketMeta`.
    const slaDueAt = ctx.secretParams['slaDueAt'] as number | undefined;
    if (!slaDueAt) return { skip: true };
    if (Date.now() < slaDueAt) return { skip: true };
    return { text: params.escalationMessage };
  },
};
