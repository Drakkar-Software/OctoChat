/**
 * Single-runner election ACROSS app instances of the same account, per automated room.
 *
 * The runner gate (`runOnDeviceId === edPub`) elects one DEVICE, but two web tabs (or a
 * tab + the Electron desktop) of the same account share the same `edPub`, so BOTH would
 * mount the foreground driver + command watcher for a room they both have open. Result:
 * scheduled ticks double-post on changed content, and slash commands are answered twice
 * (the in-memory `processedIds` dedup is per-instance). See the automation review, H2.
 *
 * Fix: hold an exclusive **Web Lock** named per room — only the lock holder is the
 * "leader" that ticks / replies; other instances are passive observers. The browser
 * releases the lock automatically when its tab closes or navigates away, so leadership
 * hands off to a waiting tab with no heartbeat. Keyed per ROOM (not per account) so two
 * tabs viewing DIFFERENT automated rooms each run their own — only same-room contention
 * is serialized.
 *
 * Platforms without the Web Locks API (React Native; older runtimes) have a single app
 * instance, so there is nothing to serialize — they are always the leader.
 */
import { useEffect, useState } from 'react';

interface LockApi {
  request: (name: string, options: { signal?: AbortSignal }, cb: () => Promise<void>) => Promise<void>;
}

/** The Web Locks API, or null on platforms that don't expose it (native / unsupported). */
function webLocks(): LockApi | null {
  const locks = (globalThis.navigator as unknown as { locks?: LockApi } | undefined)?.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

interface Entry {
  leader: boolean;
  refs: number;
  listeners: Set<(leader: boolean) => void>;
  /** Resolves the held-lock promise → releases the lock. Absent when always-leader. */
  release?: () => void;
}

const entries = new Map<string, Entry>();

function notify(e: Entry): void {
  for (const l of e.listeners) l(e.leader);
}

/** Acquire (or join) the per-room leader lock. Ref-counted so multiple consumers in one
 *  instance share a single lock + leader flag. The first consumer kicks off the request;
 *  leadership is granted asynchronously when the lock is free (immediately if no other
 *  instance holds it). */
function acquire(roomId: string): Entry {
  let e = entries.get(roomId);
  if (!e) {
    e = { leader: false, refs: 0, listeners: new Set() };
    entries.set(roomId, e);
    const locks = webLocks();
    if (!locks) {
      // Single-instance platform — no contention, always the leader.
      e.leader = true;
    } else {
      const entry = e;
      const held = new Promise<void>((resolve) => {
        entry.release = resolve;
      });
      void locks
        .request(`octochat.automation.leader.${roomId}`, {}, async () => {
          // Callback runs only once the lock is held — this instance is now leader.
          // It stays held until `held` resolves (the last consumer leaves / unmounts).
          entry.leader = true;
          notify(entry);
          await held;
        })
        .catch(() => {
          // Request rejected (e.g. aborted) — remain a passive observer.
        });
    }
  }
  e.refs++;
  return e;
}

function release(roomId: string): void {
  const e = entries.get(roomId);
  if (!e) return;
  e.refs--;
  if (e.refs <= 0) {
    e.release?.(); // release the Web Lock so a waiting instance can take over
    entries.delete(roomId);
  }
}

/**
 * True when THIS app instance is the elected leader for `roomId`'s automation — the one
 * that should run scheduled ticks and answer slash commands. `null` roomId (e.g. a
 * non-automated room) never acquires and returns `false`.
 */
export function useIsAutomationLeader(roomId: string | null): boolean {
  const [leader, setLeader] = useState(false);
  useEffect(() => {
    if (!roomId) {
      setLeader(false);
      return;
    }
    const e = acquire(roomId);
    setLeader(e.leader);
    const listener = (v: boolean) => setLeader(v);
    e.listeners.add(listener);
    return () => {
      e.listeners.delete(listener);
      release(roomId);
    };
  }, [roomId]);
  return leader;
}
