/**
 * The optional "answer with an LLM" brain for the bot.
 *
 * Both providers we support speak the SAME wire protocol — OpenAI's chat-completions
 * API — so ONE client covers both; only the `baseURL` (and key/model) differ:
 *
 *   - OpenAI standard : https://api.openai.com/v1        (e.g. gpt-4o-mini)
 *   - NVIDIA NIM      : https://integrate.api.nvidia.com/v1   (hosted, e.g.
 *                       meta/llama-3.1-8b-instruct) — or a self-hosted NIM
 *                       container's OpenAI-compatible endpoint, http://host:8000/v1.
 *
 * `/events` carries no message content, so the bot can only answer in a room it can
 * READ — its own stream room, via the audience-token `pullOwnStream` (see bot.ts,
 * `skip-author` mode). `buildHistory` turns that pulled log into chat turns; the
 * bot's own posts become `assistant`, everyone else `user`.
 */
import OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Resolved LLM settings, or `null` (returned by `resolveLlmConfig`) when no API key
 *  is set — in which case the bot stays in its plain "echo an activity line" mode. */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  /** How many of the most-recent stream turns to feed as context (NIM models often
   *  have smaller context windows than gpt-4o, so keep this conservative). */
  historyTurns: number;
}

/** Per-provider defaults. `LLM_PROVIDER` only picks the baseURL + a sane default
 *  model; `LLM_BASE_URL` / `LLM_MODEL` override either independently (so a local NIM
 *  container or a non-default model is just two env vars). */
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'google/gemma-4-31b-it' },
};

const DEFAULT_SYSTEM_PROMPT =
  'You are OctoChat, a concise and friendly assistant living in a team-chat channel. ' +
  'Answer the latest message helpfully in a few sentences of plain text (no markdown headings). ' +
  'User turns may be prefixed with a short [id] author tag — do not echo that tag in your reply.';

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return v?.trim() && Number.isFinite(n) ? n : fallback;
};

/**
 * Read LLM settings from the environment. Returns `null` when `LLM_API_KEY` is unset
 * — the signal bot.ts uses to fall back to its plain activity-line ("echo") mode, so
 * the LLM is strictly opt-in.
 */
export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null; // not configured → echo mode

  const provider = env.LLM_PROVIDER?.trim().toLowerCase() || 'openai';
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openai;

  return {
    apiKey,
    baseUrl: env.LLM_BASE_URL?.trim() || defaults.baseUrl,
    model: env.LLM_MODEL?.trim() || defaults.model,
    systemPrompt: env.LLM_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT,
    temperature: num(env.LLM_TEMPERATURE, 0.7),
    maxTokens: num(env.LLM_MAX_TOKENS, 512),
    historyTurns: Math.max(1, Math.trunc(num(env.LLM_HISTORY, 16))),
  };
}

/** One element of the pulled stream log — just the bit `buildHistory` needs. */
interface StreamItemish {
  data: Record<string, unknown>;
}

/**
 * Turn the pulled stream log into LLM chat turns. The bot's own posts (authorId ===
 * `botAuthorId`) map to `assistant`; everyone else to `user`, prefixed with a short
 * `[id]` stub so the model can tell multiple humans apart (all humans would otherwise
 * collapse into one "user" speaker). Keeps chronological order, caps to the last
 * `maxTurns`, and prepends the system prompt.
 */
export function buildHistory(
  items: StreamItemish[],
  botAuthorId: string,
  opts: { systemPrompt: string; maxTurns: number },
): ChatMessage[] {
  const turns: ChatMessage[] = [];
  for (const it of items) {
    const env = it.data as { t?: string; e?: { authorId?: string; text?: string } };
    if (env?.t !== 'msg' || !env.e?.text) continue;
    const isBot = env.e.authorId === botAuthorId;
    const content = isBot ? env.e.text : `[${(env.e.authorId ?? '????').slice(0, 4)}] ${env.e.text}`;
    turns.push({ role: isBot ? 'assistant' : 'user', content });
  }
  return [{ role: 'system', content: opts.systemPrompt }, ...turns.slice(-opts.maxTurns)];
}

/**
 * Build the LLM caller. Returns a function that takes a chat history and resolves to
 * the assistant's reply text, or `null` on ANY failure (network, rate limit, 4xx,
 * empty completion) — the bot then simply doesn't append, so a transient LLM error
 * never crashes it nor (since no append happens) trips the append circuit breaker.
 */
export function createLlmReplier(cfg: LlmConfig): (history: ChatMessage[]) => Promise<string | null> {
  const client = new OpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
  return async (history) => {
    try {
      const completion = await client.chat.completions.create({
        model: cfg.model,
        messages: history as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
      });
      return completion.choices[0]?.message?.content?.trim() || null;
    } catch (e) {
      console.error('[bot] LLM error:', (e as Error).message);
      return null;
    }
  };
}
