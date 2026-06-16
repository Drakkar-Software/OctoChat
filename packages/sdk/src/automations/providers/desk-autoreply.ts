/**
 * Desk auto-reply provider — posts an acknowledgment when a ticket room receives
 * a new message (via `onCommand`) or on the first scheduled run after creation.
 * Intended as the default automation for new ticket rooms.
 */
import type { AutomationProvider, RunResult } from '../types';

interface DeskAutoreplyParams {
  greeting: string;
}

export const deskAutoreplyProvider: AutomationProvider<DeskAutoreplyParams> = {
  id: 'desk-autoreply',
  name: 'Desk Auto-reply',
  iconName: 'ticket',
  description: 'Posts an acknowledgment message when a ticket is created or a command is used.',
  defaults: {
    greeting: 'Thank you for reaching out! A team member will get back to you shortly.',
  },
  paramFields: [
    {
      key: 'greeting',
      label: 'Greeting message',
      kind: 'textarea',
      placeholder: 'Thank you for reaching out!…',
      required: true,
    },
  ],
  commands: [
    {
      name: 'status',
      usage: '/status',
      description: 'Show the current ticket status.',
    },
  ],
  async fetch(params, ctx): Promise<RunResult> {
    // Greet only on the first run after ticket creation (lastRunAt === null).
    if (ctx.lastRunAt !== null) return { skip: true };
    return { text: params.greeting };
  },
  async onCommand(cmd, _args, _params, _ctx): Promise<RunResult> {
    if (cmd === 'status') {
      return { text: 'This ticket is currently **open**. Use `/assign` to assign it.' };
    }
    // Unknown commands are silently skipped — don't re-post the greeting for /assign etc.
    return { skip: true };
  },
};
