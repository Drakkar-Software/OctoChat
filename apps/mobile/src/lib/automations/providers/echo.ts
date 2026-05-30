import type { AutomationProvider } from '../types';

/** Dev-friendly provider — no network, no scheduled fetch. Proves the slash-command
 *  plumbing end-to-end: `/echo hello` posts `hello` back as the bot. */
export const echoProvider: AutomationProvider<Record<string, never>> = {
  id: 'echo',
  name: 'Echo',
  iconName: 'refresh',
  description: 'A no-network test bot. Reply with /echo <text>.',
  defaults: {},
  paramFields: [],
  commands: [
    { name: 'echo', usage: '/echo <text>', description: 'Posts the text back as the bot.' },
  ],
  onCommand: async (cmd, args) => {
    if (cmd !== 'echo') return { skip: true };
    const text = args.join(' ').trim();
    if (!text) return { text: 'Usage: /echo <text>' };
    return { text };
  },
};
