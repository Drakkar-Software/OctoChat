/**
 * Single-room tick — pure function. Loads the secret params, calls the provider's
 * `fetch` or `onCommand`, and POSTs the resulting text into the room as the bot
 * via the stored credential. Caller is responsible for writing back `lastRunAt`
 * / `lastError` to the registry — this function only reports the outcome.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import type { Room } from '@/lib/types';
import type { Session } from '@/lib/starfish/identity';

import { appendAsBot, type BotRedeemer } from './append';
import { loadAutomationSecrets } from './secrets';
import type { AutomationProvider, RunResult } from './types';

export type TickKind = 'scheduled' | { kind: 'command'; cmd: string; args: string[] };

export type TickOutcome =
  | { kind: 'posted'; text: string }
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
}): Promise<TickOutcome> {
  const { session, room, provider, trigger, now } = opts;
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
        httpFetch: fetch,
      });
    } else {
      if (!provider.onCommand) return { kind: 'skipped' };
      result = await provider.onCommand(trigger.cmd, trigger.args, mergedParams, {
        lastRunAt: auto.lastRunAt,
        secretParams: secrets,
        httpFetch: fetch,
      });
    }
  } catch (e) {
    return { kind: 'failed', error: String((e as Error)?.message ?? e) };
  }

  if ('skip' in result) return { kind: 'skipped' };

  try {
    const redeemer = await newBotKeys();
    const author = botAuthorId(room.id);
    const element = {
      t: 'msg',
      e: { id: `${author}-${now}`, authorId: author, ts: now, text: result.text },
    };
    await appendAsBot({
      botToken: auto.credential.token,
      signPath: auto.credential.signPath,
      redeemer,
      element,
    });
    return { kind: 'posted', text: result.text };
  } catch (e) {
    return { kind: 'failed', error: String((e as Error)?.message ?? e) };
  }
}

/** True when an automated room is due for a scheduled tick on `deviceId` at `now`. */
export function isDueForScheduledTick(room: Room, deviceId: string, now: number): boolean {
  const a = room.automation;
  if (!a || !a.enabled) return false;
  if (a.runOnDeviceId !== deviceId) return false;
  if (a.intervalMin <= 0) return false;
  if (a.lastRunAt === null) return true;
  return now - a.lastRunAt >= a.intervalMin * 60_000;
}
