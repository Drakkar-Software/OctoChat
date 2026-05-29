import { resolveEdit, type StoredMsg } from './message-view';
import type { MessageEditEvent } from './types';

/** A thread summarised for the sidebar + the Threads tab: its anchor message,
 *  participants and recent activity. */
export interface ThreadSummary {
  /** Id of the top-level message that anchors the thread (the reply target). */
  parentId: string;
  /** The thread starter — the parent message's author. */
  authorId: string;
  /** Short label for the row — the parent's (edit-folded) text, else its
   *  attachment name, else a generic fallback. */
  label: string;
  /** How many replies hang off the parent. */
  replyCount: number;
  /** Distinct people in the thread (starter + repliers), most-recently-active
   *  first — drives the Threads tab's avatar stack. */
  participantIds: string[];
  /** Replies newer than the viewer's last room read — the row's unread badge. */
  unread: number;
  /** Newest activity in the thread (ms): max of the parent and all replies — the
   *  sort key for "latest updated". */
  lastActivityTs: number;
}

/** How many recent threads the sidebar shows under a room by default. */
export const DEFAULT_THREAD_LIMIT = 3;

/** A thread's row label, folding the parent's latest edit/delete: replacement text
 *  for an edit, a tombstone for a delete, else the stored text, attachment name, or
 *  a generic fallback. */
function threadLabel(parent: StoredMsg, edits: MessageEditEvent[]): string {
  const edit = resolveEdit(edits, parent.id, parent.authorId);
  if (edit?.kind === 'delete') return 'Deleted message';
  const text = (edit?.kind === 'edit' ? edit.text : parent.text)?.trim();
  if (text) return text;
  if (parent.attachment) return parent.attachment.name || 'Attachment';
  return 'Thread';
}

/**
 * Recent threads of a room, derived from its synced message log. A "thread" is a
 * top-level message that has at least one reply (a message carrying its
 * `parentId`); replies without a loaded parent are skipped. Sorted by most recent
 * activity and capped at `limit`. `readBefore` is the viewer's last-read timestamp
 * for the room — replies newer than it count toward the thread's unread badge.
 */
export function buildThreadDigest(
  messages: StoredMsg[],
  edits: MessageEditEvent[],
  readBefore: number,
  limit: number = DEFAULT_THREAD_LIMIT,
): ThreadSummary[] {
  const repliesByParent = new Map<string, StoredMsg[]>();
  for (const m of messages) {
    if (!m.parentId) continue;
    const arr = repliesByParent.get(m.parentId);
    if (arr) arr.push(m);
    else repliesByParent.set(m.parentId, [m]);
  }

  const byId = new Map(messages.map((m) => [m.id, m]));
  const out: ThreadSummary[] = [];
  for (const [parentId, replies] of repliesByParent) {
    const parent = byId.get(parentId);
    if (!parent) continue; // orphaned reply — its parent isn't in the loaded log
    const lastReplyTs = replies.reduce((mx, r) => Math.max(mx, r.ts), 0);
    // Distinct participants, newest activity first: the latest replier leads the
    // avatar stack, the thread starter trails (deduped, preserving that order).
    const participantIds: string[] = [];
    for (const m of [parent, ...replies].sort((a, b) => b.ts - a.ts)) {
      if (!participantIds.includes(m.authorId)) participantIds.push(m.authorId);
    }
    out.push({
      parentId,
      authorId: parent.authorId,
      label: threadLabel(parent, edits),
      replyCount: replies.length,
      participantIds,
      unread: replies.reduce((n, r) => n + (r.ts > readBefore ? 1 : 0), 0),
      lastActivityTs: Math.max(parent.ts, lastReplyTs),
    });
  }

  return out.sort((a, b) => b.lastActivityTs - a.lastActivityTs).slice(0, limit);
}
