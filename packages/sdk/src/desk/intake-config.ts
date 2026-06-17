/**
 * Per-space "incoming requests" intake configuration (SPACE OWNER only).
 *
 * Controls how inbound sealed ticket requests (filed by non-members via the owner's public
 * identity link) are handled for ONE space:
 *   - `manual`      — don't auto-accept; the owner reviews pending requests and accepts/declines.
 *   - `auto-accept` — turn every request into a ticket automatically.
 *   - `auto-reply`  — auto-accept AND post a first reply (AI-written, or a fixed message).
 *
 * Stored as an owner-written doc in the `objowner` collection (`spaces/{spaceId}/objects/owner/_intake`),
 * gated `space:owner` — the same home + gating as the webhook registry (see `starfish/webhooks.ts`).
 * Written with the owner's `accountClient` and optimistic-concurrency on the pulled hash.
 */
import { StarfishHttpError } from '@drakkar.software/starfish-client';

import type { Session } from '../starfish/identity';
import { spaceIntakePull, spaceIntakePush } from '../starfish/paths';

export type IntakeMode = 'manual' | 'auto-accept' | 'auto-reply';
export type IntakeReplyKind = 'ai' | 'fixed';

export interface IntakeConfig {
  mode: IntakeMode;
  /** Only meaningful when `mode === 'auto-reply'`. */
  replyKind: IntakeReplyKind;
  /** The fixed first reply (used for `replyKind: 'fixed'`, or as the AI fallback). */
  replyText: string;
}

/** Default: review every request by hand (the safe, no-surprises default). */
export const DEFAULT_INTAKE_CONFIG: IntakeConfig = { mode: 'manual', replyKind: 'fixed', replyText: '' };

/** Max length of the fixed reply message (keeps the owner doc small). */
export const INTAKE_REPLY_MAX = 2000;

interface IntakeDoc {
  v: 1;
  intake: IntakeConfig;
}

const MODES: ReadonlySet<string> = new Set(['manual', 'auto-accept', 'auto-reply']);
const REPLY_KINDS: ReadonlySet<string> = new Set(['ai', 'fixed']);

/** Coerce an untrusted (stored or user-supplied) value into a valid IntakeConfig. */
export function coerceIntakeConfig(raw: unknown): IntakeConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_INTAKE_CONFIG };
  const r = raw as Partial<Record<keyof IntakeConfig, unknown>>;
  return {
    mode: typeof r.mode === 'string' && MODES.has(r.mode) ? (r.mode as IntakeMode) : DEFAULT_INTAKE_CONFIG.mode,
    replyKind:
      typeof r.replyKind === 'string' && REPLY_KINDS.has(r.replyKind)
        ? (r.replyKind as IntakeReplyKind)
        : DEFAULT_INTAKE_CONFIG.replyKind,
    replyText: typeof r.replyText === 'string' ? r.replyText.slice(0, INTAKE_REPLY_MAX) : DEFAULT_INTAKE_CONFIG.replyText,
  };
}

/** Pull the intake doc (404 → defaults), returning the config + the doc hash for a follow-up write. */
async function pullIntake(session: Session, spaceId: string): Promise<{ cfg: IntakeConfig; hash: string | null }> {
  const res = await session.accountClient.pull(spaceIntakePull(spaceId)).catch((err: unknown) => {
    if (err instanceof StarfishHttpError && err.status === 404) return null; // no doc yet → defaults
    throw err; // offline / other → propagate (must not look like "manual")
  });
  const intake = (res?.data as Partial<IntakeDoc> | undefined)?.intake;
  return { cfg: coerceIntakeConfig(intake), hash: res?.hash ?? null };
}

/** Read a space's intake config (defaults to `manual` when unset/unreadable-as-404). */
export async function readIntakeConfig(session: Session, spaceId: string): Promise<IntakeConfig> {
  return (await pullIntake(session, spaceId)).cfg;
}

/** Write a space's intake config (owner only; optimistic-concurrency on the pulled hash). */
export async function writeIntakeConfig(session: Session, spaceId: string, cfg: IntakeConfig): Promise<void> {
  const { hash } = await pullIntake(session, spaceId);
  const doc: IntakeDoc = { v: 1, intake: coerceIntakeConfig(cfg) };
  await session.accountClient.push(spaceIntakePush(spaceId), doc as unknown as Record<string, unknown>, hash);
}
