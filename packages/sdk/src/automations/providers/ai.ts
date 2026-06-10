/**
 * AI agent provider. Runs an on-device LLM (injected via `ctx.llm`, see
 * `ai/engine-port.ts`) in a bounded ReAct loop: the model reads a standing
 * instruction (scheduled `fetch`) or an ad-hoc `/ai <prompt>` (command), calls a
 * small allow-listed tool set to gather live data, then emits a FINAL message the
 * runner posts to the room.
 *
 * Tools are HTTP (reusing `ctx.httpFetch`) + FINAL. The model speaks a strict
 * one-directive-per-turn grammar, parsed tolerantly the same way the reply
 * suggestion parser is (`ai/prompt.ts`) — small on-device models are unreliable,
 * so unrecognized output degrades to "post it as the answer".
 *
 * AI is OPT-IN and on-device by design: room content never leaves the device. When
 * no model is wired (web / a device without one), a tick posts a short notice
 * instead of failing silently.
 */
import type { LLMMessage } from '../../ai/llm';
import type { AutomationProvider, RunCtx, RunResult } from '../types';

interface AiParams {
  /** The standing task the scheduled run carries out each tick. */
  instruction?: string;
  /** Tool-loop budget — how many tool calls the agent may make before it must
   *  produce a FINAL answer. Clamped to a safe range. */
  maxSteps?: number;
}

/** Default / hard ceiling for tool-loop iterations. A small on-device model that
 *  loops needs a tight cap so a tick stays cheap and bounded. */
const DEFAULT_MAX_STEPS = 3;
const MAX_STEPS_CEILING = 6;

/** Cap a tool observation fed back into the model — small context windows. */
const OBSERVATION_CAP = 1000;
/** Cap the final posted message so a chat post stays readable. */
const POST_CAP = 2000;

function cap(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Coerce the `maxSteps` param into `[1, MAX_STEPS_CEILING]`, defaulting on junk. */
export function clampSteps(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_STEPS;
  return Math.min(Math.floor(n), MAX_STEPS_CEILING);
}

/** One parsed step the model emitted. `none` = no recognizable directive. */
export type AgentStep =
  | { kind: 'get'; url: string }
  | { kind: 'post'; url: string; body: string }
  | { kind: 'final'; text: string }
  | { kind: 'none' };

/**
 * Parse the model's turn into a single {@link AgentStep}. Scans for the first line
 * that starts with a tool keyword (small models often prepend reasoning); if none
 * is found the whole output is treated as the FINAL answer — the same tolerant
 * fallback the reply-suggestion parser uses.
 */
export function parseAgentStep(raw: string): AgentStep {
  const text = raw.trim();
  if (!text) return { kind: 'none' };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(GET|POST|FINAL)\b[:\s]*(.*)$/i.exec(lines[i].trim());
    if (!m) continue;
    const kw = m[1].toUpperCase();
    if (kw === 'FINAL') {
      // Everything from here on is the message (FINAL may span lines).
      const rest = [m[2], ...lines.slice(i + 1)].join('\n').trim();
      return { kind: 'final', text: rest };
    }
    if (kw === 'GET') {
      const url = m[2].trim().split(/\s+/)[0] ?? '';
      return url ? { kind: 'get', url } : { kind: 'none' };
    }
    // POST <url> <json>
    const rest = m[2].trim();
    const sp = rest.indexOf(' ');
    const url = sp === -1 ? rest : rest.slice(0, sp);
    const body = sp === -1 ? '' : rest.slice(sp + 1).trim();
    return url ? { kind: 'post', url, body } : { kind: 'none' };
  }

  // No directive anywhere → the model just answered; post it.
  return { kind: 'final', text };
}

/** System prompt describing the tools + the one-directive grammar. */
export const AI_SYSTEM_PROMPT =
  'You are an automation agent in a team chat. You carry out the user\'s task and produce a short message to post in the room.\n' +
  'Each turn, choose ONE action and output it as a keyword followed by its arguments:\n' +
  '- GET <url> — fetch a URL and read its response.\n' +
  '- POST <url> <json> — POST a JSON body to a URL and read its response.\n' +
  '- FINAL <message> — you are done; everything after FINAL is posted to the room.\n' +
  'Rules: use a tool only when you need live data, otherwise answer directly with FINAL. ' +
  'After each tool you receive an OBSERVATION — use it, then call another tool or finish with FINAL. ' +
  'Keep the FINAL message concise and useful for a chat room, in the same language as the task. ' +
  'Output only the directive — for GET/POST a single line; the FINAL message may span lines.';

/** Final-synthesis prompt used when the tool budget runs out: no tools, just answer. */
const AI_FINALIZE_PROMPT =
  'Using the conversation and observations above, write the final message to post in the room. ' +
  'Be concise, in the same language as the task. Output the message text only — no keyword, no preamble.';

/** Execute a tool step against the room's HTTP capability, returning the text
 *  observation fed back to the model. */
async function runTool(step: Extract<AgentStep, { kind: 'get' | 'post' }>, ctx: RunCtx): Promise<string> {
  if (step.kind === 'get') {
    const res = await ctx.httpFetch(step.url);
    return `GET ${step.url} → ${res.status}\n${await res.text()}`;
  }
  const res = await ctx.httpFetch(step.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: step.body,
  });
  return `POST ${step.url} → ${res.status}\n${await res.text()}`;
}

/** Drive the bounded ReAct loop for a single task. Returns the post text, or a
 *  skip when the model declines to say anything. */
async function runAgent(task: string, params: AiParams, ctx: RunCtx): Promise<RunResult> {
  if (!ctx.llm) {
    return {
      text: 'AI is not available on this device. Enable on-device AI (Settings → AI) on the device that runs this automation.',
    };
  }
  if (!task.trim()) return { skip: true };

  const maxSteps = clampSteps(params.maxSteps);
  const convo: LLMMessage[] = [{ role: 'user', content: task.trim() }];

  for (let step = 0; step < maxSteps; step++) {
    const out = await ctx.llm(convo, { systemPrompt: AI_SYSTEM_PROMPT });
    const parsed = parseAgentStep(out);

    if (parsed.kind === 'final' || parsed.kind === 'none') {
      const answer = parsed.kind === 'final' ? parsed.text.trim() : out.trim();
      return answer ? { text: cap(answer, POST_CAP) } : { skip: true };
    }

    let observation: string;
    try {
      observation = await runTool(parsed, ctx);
    } catch (e) {
      observation = `error: ${String((e as Error)?.message ?? e)}`;
    }
    convo.push({ role: 'assistant', content: out.trim() });
    convo.push({
      role: 'user',
      content: `OBSERVATION:\n${cap(observation, OBSERVATION_CAP)}\n\nContinue: use another tool or reply with FINAL <message>.`,
    });
  }

  // Budget exhausted — force one tool-free synthesis turn so we still post.
  const final = await ctx.llm(convo, { systemPrompt: AI_FINALIZE_PROMPT });
  const answer = final.trim();
  return answer ? { text: cap(answer, POST_CAP) } : { skip: true };
}

/** Drive on-device AI from a room: a standing instruction on a schedule, or
 *  `/ai <prompt>` on demand. The agent can call HTTPS endpoints (GET/POST) to
 *  gather live data before it posts. Runs on-device — room content stays local. */
export const aiProvider: AutomationProvider<AiParams> = {
  id: 'ai',
  name: 'AI agent',
  iconName: 'sparkles',
  description: 'Run an on-device AI agent on a schedule or with /ai — it can call HTTPS endpoints to gather data, then posts a message.',
  defaults: { maxSteps: DEFAULT_MAX_STEPS },
  paramFields: [
    {
      key: 'instruction',
      label: 'Standing instruction (what to do each scheduled run)',
      kind: 'textarea',
      placeholder: 'Summarize the latest status from https://api.example.com/health and flag anything not OK.',
      required: true,
    },
    { key: 'maxSteps', label: 'Max tool steps (1–6)', kind: 'number', placeholder: String(DEFAULT_MAX_STEPS) },
  ],
  commands: [{ name: 'ai', usage: '/ai <prompt>', description: 'Ask the on-device AI agent to do something and post the result.' }],
  fetch: async (params, ctx) => {
    const instruction = String(params.instruction ?? '').trim();
    if (!instruction) return { skip: true };
    return runAgent(instruction, params, ctx);
  },
  onCommand: async (cmd, args, params, ctx) => {
    if (cmd !== 'ai') return { skip: true };
    const prompt = args.join(' ').trim();
    if (!prompt) return { text: 'Usage: /ai <prompt>' };
    return runAgent(prompt, params, ctx);
  },
};
