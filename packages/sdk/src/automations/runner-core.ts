/**
 * Single-room tick — pure function. Loads the secret params, calls the provider's
 * `fetch` or `onCommand`, and POSTs the resulting text into the room as the bot
 * via the stored credential. Caller is responsible for writing back `lastRunAt`
 * / `lastError` to the registry — this function only reports the outcome.
 */
import { getSpaceClient, getNodeStreamClient } from '@drakkar.software/octospaces-sdk';

import type { Room } from '../domain/types';
import type { Session } from '../starfish/identity';

import { getLlm } from '../ai/engine-port';

import { dedupeFetch } from './hash';
import { streamInvRoomPush, streamPubRoomPush, streamRoomPush } from '../starfish/paths';
import { effectiveSchedule, nextScheduledRunAt } from './schedule';
import { loadAutomationSecrets } from './secrets';
import type { AutomationProvider, RunResult } from './types';

/** `fetch` bound to the global. Providers receive `httpFetch` and call it as
 *  `ctx.httpFetch(...)` — a method call whose receiver would be `ctx`. The native
 *  `fetch` brand-checks its receiver and rejects anything that isn't the global
 *  ("Failed to execute 'fetch' on 'Window': Illegal invocation") — and that
 *  includes `undefined`, so a bare `fetch(...args)` call (receiver `undefined`)
 *  fails too. Invoke it explicitly as a method of `globalThis` so the receiver is
 *  the global object. */
const boundFetch: typeof fetch = (...args) => globalThis.fetch(...args);

export type TickKind = 'scheduled' | { kind: 'command'; cmd: string; args: string[] };

export type TickOutcome =
  | { kind: 'posted'; text: string; hash?: string }
  | { kind: 'skipped' }
  | { kind: 'failed'; error: string };

/** Identify the bot author in chat. A short, stable label derived from the room id
 *  so all of this room's bot posts share an authorId in the chat view (which
 *  groups consecutive same-author messages). */
function botAuthorId(roomId: string): string {
  return `bot-${roomId}`;
}

/** Append a text message into an automated room as the bot author.
 *  Throws on network / auth failure so callers can react (the tick runner
 *  converts the throw into a failed outcome; the failure-log poster in the
 *  orchestrator swallows it). */
export async function appendBotMessage(
  session: Session,
  room: Room,
  text: string,
  ts: number,
): Promise<void> {
  // Invite streams (objinvlog) are cap-gated, not reachable by the space cap; present the
  // per-node stream cap via getNodeStreamClient. Public/space streams use the space client.
  const isInviteStream = room.access === 'invite' && !room.enc;
  const client = isInviteStream
    ? getNodeStreamClient(room.spaceId, room.id, session)
    : getSpaceClient(room.spaceId, session);
  const pushPath =
    room.access === 'public'
      ? streamPubRoomPush(room.id)
      : isInviteStream
        ? streamInvRoomPush(room.id)
        : streamRoomPush(room.id);
  const author = botAuthorId(room.id);
  await client.append(pushPath, {
    t: 'msg',
    e: { id: `${author}-${ts}`, authorId: author, ts, text },
  });
}

export async function tickRoom(opts: {
  session: Session;
  room: Room;
  provider: AutomationProvider;
  trigger: TickKind;
  now: number;
  /** Bypass the content-hash dedup (a manual "Run now" means "post now", even if
   *  the response is unchanged). The new hash is still recorded for later ticks. */
  force?: boolean;
}): Promise<TickOutcome> {
  const { session, room, provider, trigger, now, force } = opts;
  const auto = room.automation;
  if (!auto) return { kind: 'skipped' };

  const secrets = await loadAutomationSecrets(session.userId, room.id);
  const mergedParams = { ...auto.params, ...secrets } as Record<string, unknown>;

  // Per-tick context. `llm` is present only when the host wired an on-device
  // engine (native + a usable model); absent on web / unconfigured devices.
  const llm = getLlm();
  const runCtx = {
    lastRunAt: auto.lastRunAt,
    secretParams: secrets,
    httpFetch: boundFetch,
    ...(llm ? { llm } : {}),
  };

  let result: RunResult;
  try {
    if (trigger === 'scheduled') {
      if (!provider.fetch) return { kind: 'skipped' };
      result = await provider.fetch(mergedParams, runCtx);
    } else {
      if (!provider.onCommand) return { kind: 'skipped' };
      result = await provider.onCommand(trigger.cmd, trigger.args, mergedParams, runCtx);
    }
  } catch (e) {
    return { kind: 'failed', error: String((e as Error)?.message ?? e) };
  }

  if ('skip' in result) return { kind: 'skipped' };

  // Scheduled fetches dedup on content: skip the post when the text is identical
  // to the last one this room posted (a feed/endpoint that keeps returning the
  // same body shouldn't repost every interval). Command posts are user-driven —
  // they always post and never touch the fetch cursor.
  let postHash: string | undefined;
  if (trigger === 'scheduled') {
    const d = dedupeFetch(result.text, auto.lastFetchHash);
    if (!force && !d.post) return { kind: 'skipped' };
    postHash = d.hash;
  }

  try {
    await appendBotMessage(session, room, result.text, now);
    return { kind: 'posted', text: result.text, hash: postHash };
  } catch (e) {
    return { kind: 'failed', error: String((e as Error)?.message ?? e) };
  }
}

/**
 * True when an automated room is due for a scheduled tick on `deviceId` at `now`.
 *
 * This gate stays the cross-device source of truth over the synced `lastRunAt`: the
 * 0.2.0 scheduler engine dispatch-gates its OS wake on a per-device `nextRunAt`, but
 * only this gate knows whether ANOTHER device already ran the current occurrence. It
 * computes the cadence from {@link effectiveSchedule} (explicit `schedule`, else the
 * legacy `intervalMin`) — for interval/daily/weekly/cron alike — using the same UTC
 * math the engine uses, so the wake and the gate agree.
 */
export function isDueForScheduledTick(room: Room, deviceId: string, now: number): boolean {
  const a = room.automation;
  if (!a || !a.enabled) return false;
  if (a.runOnDeviceId !== deviceId) return false;
  if (a.onOpen) return true; // explicit always-on-open mode — no time gate
  const schedule = effectiveSchedule(a);
  if (!schedule) return false; // commands-only (no scheduled cadence)
  if (a.lastRunAt === null) return true; // never run → due now
  const next = nextScheduledRunAt(schedule, a.lastRunAt);
  return next !== null && now >= next;
}
