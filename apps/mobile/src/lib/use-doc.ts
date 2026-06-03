import { useCallback, useMemo } from 'react';

import { joinBlocks, mergeDocEdit, type DocBlock } from './doc-block';
import { objDocPull, objDocPush, pubObjDocPull, pubObjDocPush } from './starfish/paths';
import { useMergeDoc } from './use-merge-doc';
import { useRoomLiveSync } from './use-room-live-sync';
import { randomId } from './ids';

// Re-exported so call sites import the block model + projection from `use-doc`; the
// definitions live in the pure `doc-block` module.
export { blockMarkdown, joinBlocks, type DocBlock } from './doc-block';

export interface DocHook {
  blocks: DocBlock[];
  /** The whole doc as one Markdown string — what the seamless editor seeds with and the
   *  reader renders. Joined from {@link blocks}; the inverse of {@link setText}'s split. */
  text: string;
  opening: boolean;
  openError: string | null;
  offline: boolean;
  ready: boolean;
  reload: () => void;
  /** Save the whole doc from one Markdown string via a 3-way merge (see
   *  {@link mergeDocEdit}). `base` is the block list captured when the editor OPENED
   *  ({@link blocks} at that moment); `next` is the edited text. Only the paragraphs the
   *  user actually changed are written onto the live blocks, so a concurrent edit to
   *  another paragraph survives the merge and an unchanged save is a pure no-op — safe to
   *  call on every autosave tick (no Save button, no split-on-blur latch). Returns the
   *  user's advanced merge base ({@link mergeDocEdit}'s `nextBase`), which the editor must
   *  feed back as `base` on the next commit so a multi-tick insert isn't duplicated. */
  mergeText: (base: DocBlock[], next: string) => DocBlock[];
}

/** Doc body content for one `doc` Object — a merge-doc (see {@link useMergeDoc}) holding
 *  the block list; the doc's title/emoji live on the index NODE ({@link useObjects}). The
 *  user edits the doc as ONE continuous Markdown surface — blocks exist only as the merge
 *  granularity under the hood (see {@link reconcileDoc}), never as visible chrome. */
export function useDoc(spaceId: string, objectId: string, opts: { enabled?: boolean } = {}): DocHook {
  const enabled = (opts.enabled ?? true) && !!spaceId && !!objectId;

  const { doc, ready, opening, openError, offline, reload, apply, pull } = useMergeDoc({
    spaceId,
    openId: objectId,
    enabled,
    storeKey: `objdoc:${objectId}`,
    privatePaths: () => ({ pull: objDocPull(spaceId, objectId), push: objDocPush(spaceId, objectId) }),
    publicPaths: (ownerId) => ({ pull: pubObjDocPull(ownerId, spaceId, objectId), push: pubObjDocPush(ownerId, spaceId, objectId) }),
  });

  // Live cross-device updates: an `objdoc` change event (routed by objectId — see
  // events.shared.ts) pulls the latest blocks. Focus-pull + SSE, poll only when SSE is
  // down (useRoomLiveSync). The doc screen mounts this hook, so the focus gate is valid.
  useRoomLiveSync({ roomId: objectId, ready, pull, skipFirstFocus: true, firstFocusKey: objectId });

  const blocks = useMemo<DocBlock[]>(
    () =>
      (Array.isArray(doc?.blocks) ? (doc!.blocks as DocBlock[]) : [])
        .slice()
        .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1)),
    [doc],
  );

  const text = useMemo(() => joinBlocks(blocks), [blocks]);

  const mergeText = useCallback(
    (base: DocBlock[], next: string): DocBlock[] => {
      // `apply` runs the updater synchronously (see useMergeDoc), so the advanced base is
      // captured here and returned for the editor to feed back on the next commit.
      let nextBase = base;
      apply((d) => {
        const cur = Array.isArray(d.blocks) ? (d.blocks as DocBlock[]) : [];
        const merged = mergeDocEdit(cur, base, next, { now: Date.now(), newId: () => `blk-${randomId()}` });
        nextBase = merged.nextBase;
        // No-op (unchanged text, or a tick re-saving the same content): return the SAME
        // doc so updatedAt isn't bumped and no push/merge churn fires.
        return merged.changed ? { ...d, blocks: merged.blocks } : d;
      });
      return nextBase;
    },
    [apply],
  );

  return { blocks, text, opening, openError, offline, ready, reload, mergeText };
}
