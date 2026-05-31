/**
 * Automation provider plugin shape. A built-in integration that an `automated`
 * room can be configured with. Two halves:
 *   - `fetch(params, ctx)` — scheduled poll: returns text the bot posts to the
 *     room, or `{ skip: true }` when nothing's new.
 *   - `onCommand(cmd, args, params, ctx)` — slash-command reply: a user typed
 *     `/<cmd> args` in the room, the runner dispatches here, the bot posts the
 *     `{ text }` reply (or `{ skip: true }` for silent commands).
 * Both are optional — `rss` is fetch-only, `http` is command-only.
 */
import type { IconName } from '@/components/ui/Icon';

/** A single declarative form field for a provider's params. */
export interface ParamField {
  key: string;
  label: string;
  /** Plain text / numeric / multi-line / URL. Drives the TextField props. */
  kind: 'text' | 'url' | 'number' | 'textarea';
  placeholder?: string;
  /** When true the field is collected into device-local kv (see secrets.ts) and
   *  NEVER written into the synced `_rooms` registry. */
  secret?: boolean;
  required?: boolean;
}

/** A single slash command the provider exposes inside its room. */
export interface SlashCommandDef {
  /** The bare command (no leading slash). Match is case-sensitive on the cmd. */
  name: string;
  /** Short usage string shown in the in-room hint chip and the settings sheet. */
  usage: string;
  description: string;
}

/** Context handed to a provider's `fetch` / `onCommand`. Carries the previous
 *  tick's timestamp + secret params + an `httpFetch` indirection for tests. */
export interface RunCtx {
  lastRunAt: number | null;
  /** Merged view of (non-secret) `params` + secret params loaded from kv. The
   *  provider does not need to know which were stored where. */
  secretParams: Record<string, unknown>;
  /** Plain `fetch` indirection so unit tests can stub network calls without
   *  monkey-patching the global. */
  httpFetch: typeof fetch;
}

/** What a provider's `fetch` / `onCommand` returns. Posting the text is the
 *  runner's job, not the provider's. */
export type RunResult = { text: string } | { skip: true };

export interface AutomationProvider<P extends object = Record<string, unknown>> {
  /** Stable id used as FK from a Room.automation.providerId — never rename. */
  id: string;
  name: string;
  iconName: IconName;
  description: string;
  /** Initial values for `params` shown in the create form. */
  defaults: P;
  paramFields: ParamField[];
  /** Optional declared commands — drives the in-room hint chip + dispatcher. */
  commands?: SlashCommandDef[];
  /** Scheduled fetch — runs on every tick that's due. */
  fetch?(params: P, ctx: RunCtx): Promise<RunResult>;
  /** Slash command handler — `args` is the message text after the cmd, split on
   *  whitespace once (`['Paris']` from `/weather Paris`). */
  onCommand?(cmd: string, args: string[], params: P, ctx: RunCtx): Promise<RunResult>;
}
