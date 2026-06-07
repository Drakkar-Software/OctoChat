/**
 * Foreground slash-command watcher. Subscribes to the room's `ConversationStore`
 * (the synthetic store useStreamRoom builds) and, on every new message authored
 * by anyone *other than the bot* whose text starts with `/`, dispatches to the
 * provider's `onCommand`. The bot's reply is POSTed through the same orchestrator
 * tick path so lastRunAt / lastError stay accurate.
 *
 * Dispatch is bounded: only commands authored AFTER mount fire, and a per-room
 * `processedIds` set guards re-fires when the cursor re-paints history (e.g.
 * after a focus + SSE double-pull). Only the elected runner device handles
 * commands — other devices show the message but don't reply.
 */
import { useEffect, useRef } from 'react';

import type { ConversationStore } from '../use-conversation-data';
import type { Session } from '@drakkar.software/octochat-sdk';
import type { Room } from '@drakkar.software/octochat-sdk';
import type { StoredMsg } from '@drakkar.software/octochat-sdk';

import { runAutomationTick } from '@drakkar.software/octochat-sdk';
import { getProvider } from '@drakkar.software/octochat-sdk';

interface StreamData {
  messages: StoredMsg[];
}

function parseSlash(text: string | undefined): { cmd: string; args: string[] } | null {
  if (!text || !text.startsWith('/')) return null;
  const trimmed = text.slice(1).trim();
  if (!trimmed) return null;
  const [cmd, ...args] = trimmed.split(/\s+/);
  return { cmd: cmd!, args };
}

export function useAutomationCommands(opts: {
  session: Session | null;
  room: Room | null;
  store: ConversationStore | null;
  active?: boolean;
}) {
  const { session, room, store, active = true } = opts;
  const processedRef = useRef<Set<string>>(new Set());
  const baselineRef = useRef<number>(0);

  // Reset the baseline on room switch so we don't dispatch the whole back-history.
  useEffect(() => {
    processedRef.current = new Set();
    baselineRef.current = Date.now();
  }, [room?.id]);

  useEffect(() => {
    if (!active) return; // not the elected leader instance (see leader.ts) — don't reply twice
    if (!session || !room || !room.automation || !store) return;
    if (room.automation.runOnDeviceId !== session.keys.edPub) return; // only the elected runner replies
    if (!room.automation.enabled) return;
    const provider = getProvider(room.automation.providerId);
    if (!provider || !provider.onCommand) return;

    const dispatch = (msgs: StoredMsg[]) => {
      for (const m of msgs) {
        if (processedRef.current.has(m.id)) continue;
        if ((m.ts ?? 0) < baselineRef.current) continue; // ignore pre-mount history
        if (m.authorId === `bot-${room.id}`) continue; // never reply to ourselves
        const parsed = parseSlash(m.text);
        if (!parsed) continue;
        processedRef.current.add(m.id);
        void runAutomationTick({
          session,
          room,
          trigger: { kind: 'command', cmd: parsed.cmd, args: parsed.args },
          now: Date.now(),
        });
      }
    };

    // Prime with whatever's already in the store, then subscribe for the deltas.
    const initial = (store.getState() as unknown as { data?: StreamData }).data?.messages ?? [];
    dispatch(initial);
    return store.subscribe((state) => {
      const data = (state as unknown as { data?: StreamData }).data;
      if (data?.messages) dispatch(data.messages);
    });
  }, [active, session, room, store]);
}
