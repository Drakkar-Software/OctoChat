/**
 * Single-room tick — pure function. Loads the secret params, calls the provider's
 * `fetch` or `onCommand`, and POSTs the resulting text into the room as the bot
 * via the stored credential. Caller is responsible for writing back `lastRunAt`
 * / `lastError` to the registry — this function only reports the outcome.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import { openStreamBotCredential } from '../starfish/stream-bots';
import type { Room } from '../domain/types';
import type { Session } from '../starfish/identity';

import { appendAsBot, type BotRedeemer } from './append';
import { dedupeFetch } from './hash';
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

/** Build a fresh bot redeemer keypair. The bot's identity is intentionally
 *  ephemeral — `createPublicLink` audience caps don't pin a single identity by
 *  default, so each tick can sign with its own pair without re-onboarding. */
async function newBotKeys(): Promise<BotRedeemer> {
  const k = await generateDeviceKeys();
  return { edPubHex: k.edPub, edPrivHex: k.edPriv };
}

/** Identify the bot author in chat. A short, stable label derived from the room id
 *  so all of this room's bot posts share an authorId in the chat view (which
 *  groups consecutive same-author messages). */
function botAuthorId(roomId: string): string {
  return `bot-${roomId}`;
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

  let result: RunResult;
  try {
    if (trigger === 'scheduled') {
      if (!provider.fetch) return { kind: 'skipped' };
      result = await provider.fetch(mergedParams, {
        lastRunAt: auto.lastRunAt,
        secretParams: secrets,
        httpFetch: boundFetch,
      });
    } else {
      if (!provider.onCommand) return { kind: 'skipped' };
      result = await provider.onCommand(trigger.cmd, trigger.args, mergedParams, {
        lastRunAt: auto.lastRunAt,
        secretParams: secrets,
        httpFetch: boundFetch,
      });
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
    // The credential is sealed to the minting account key in the synced doc — open it
    // with the seed (a reader can't). NOTE: a QR-paired runner device has a fresh key
    // and can't open it → this throws → 'failed'; manage/run automations from the
    // primary device (consistent with the DM-keyring paired-device limitation).
    const cred = await openStreamBotCredential(session, auto.credential);
    const redeemer = await newBotKeys();
    const author = botAuthorId(room.id);
    const element = {
      t: 'msg',
      e: { id: `${author}-${now}`, authorId: author, ts: now, text: result.text },
    };
    await appendAsBot({
      botToken: cred.token,
      signPath: cred.signPath,
      redeemer,
      element,
    });
    return { kind: 'posted', text: result.text, hash: postHash };
  } catch (e) {
    return { kind: 'failed', error: String((e as Error)?.message ?? e) };
  }
}

/** True when an automated room is due for a scheduled tick on `deviceId` at `now`. */
export function isDueForScheduledTick(room: Room, deviceId: string, now: number): boolean {
  const a = room.automation;
  if (!a || !a.enabled) return false;
  if (a.runOnDeviceId !== deviceId) return false;
  if (a.onOpen) return true; // explicit always-on-open mode — no time gate
  if (a.intervalMin <= 0) return false;
  if (a.lastRunAt === null) return true;
  return now - a.lastRunAt >= a.intervalMin * 60_000;
}
