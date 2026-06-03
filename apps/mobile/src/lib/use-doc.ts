import { useCallback, useMemo } from 'react';

import { planBlockEdit, type DocBlock } from './doc-block';
import { objDocPull, objDocPush, pubObjDocPull, pubObjDocPush } from './starfish/paths';
import type { ID } from './types';
import { useMergeDoc } from './use-merge-doc';
import { useRoomLiveSync } from './use-room-live-sync';
import { randomId } from './ids';

// Re-exported so existing call sites keep importing the block model + projection
// from `use-doc`; the definitions live in the pure `doc-block` module.
export { blockMarkdown, type DocBlock } from './doc-block';

export interface DocHook {
  blocks: DocBlock[];
  opening: boolean;
  openError: string | null;
  offline: boolean;
  ready: boolean;
  reload: () => void;
  /** Create or replace a block in place; returns its id, or null when not writable
   *  yet. Used for the autosave-while-typing path (one block holds the raw multiline
   *  Markdown — no split, so a debounce tick can't fan out duplicates). */
  upsertBlock: (block: Partial<DocBlock> & { id?: ID }) => ID | null;
  /** Resolve an edited block's raw Markdown on the FINAL flush (blur/unmount): empty
   *  → delete; a body spanning a blank line fans out into separate blocks; otherwise
   *  a single in-place update. Run once per edit (the autosave latch guarantees it),
   *  so the blank-line split happens on blur, never mid-typing. */
  editBlock: (id: ID, text: string) => void;
  removeBlock: (id: ID) => void;
}

/** Doc body content for one `doc` Object — a merge-doc (see {@link useMergeDoc}) holding
 *  the block list; the doc's title/emoji live on the index NODE ({@link useObjects}). The
 *  rich block editor is a later milestone; this gives the synced block model its render. */
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

  const upsertBlock = useCallback(
    (block: Partial<DocBlock> & { id?: ID }): ID | null => {
      const id = block.id ?? `blk-${randomId()}`;
      const now = Date.now();
      const ok = apply((d) => {
        const cur = (d.blocks as DocBlock[]) ?? [];
        const existing = cur.find((b) => b.id === id);
        const next: DocBlock = {
          id,
          type: block.type ?? existing?.type ?? 'md',
          ...(block.text !== undefined ? { text: block.text } : existing?.text !== undefined ? { text: existing.text } : {}),
          ...(block.items !== undefined ? { items: block.items } : existing?.items !== undefined ? { items: existing.items } : {}),
          order: block.order ?? existing?.order ?? cur.length,
          updatedAt: now,
        };
        // No-op when the content is unchanged (e.g. the final flush re-saving a block
        // opened but not edited): keep the same doc so updatedAt isn't bumped and no
        // push/merge churn fires. Compares everything but updatedAt.
        if (
          existing &&
          existing.type === next.type &&
          existing.text === next.text &&
          existing.order === next.order &&
          JSON.stringify(existing.items ?? null) === JSON.stringify(next.items ?? null)
        ) {
          return d;
        }
        return { ...d, blocks: existing ? cur.map((b) => (b.id === id ? next : b)) : [...cur, next] };
      });
      return ok ? id : null;
    },
    [apply],
  );

  const removeBlock = useCallback(
    (id: ID) => {
      apply((d) => ({ ...d, blocks: ((d.blocks as DocBlock[]) ?? []).filter((b) => b.id !== id) }));
    },
    [apply],
  );

  const editBlock = useCallback(
    (id: ID, text: string) => {
      if (!text.trim()) {
        removeBlock(id);
        return;
      }
      apply((d) => {
        const cur = (d.blocks as DocBlock[]) ?? [];
        const existing = cur.find((b) => b.id === id);
        const plan = planBlockEdit(existing, text);
        // No-op (block opened, not edited): leave it exactly as-is — never rewrite or
        // migrate a legacy h2/quote/bullets block on a mere tap-in/tap-out.
        if (plan.kind === 'noop' || plan.kind === 'remove') return d;
        const now = Date.now();
        if (plan.kind === 'replace') {
          const next: DocBlock = { id, type: 'md', text: plan.text, order: existing?.order ?? cur.length, updatedAt: now };
          return { ...d, blocks: existing ? cur.map((b) => (b.id === id ? next : b)) : [...cur, next] };
        }
        // Split: the first part keeps this block's id (its merge identity); the rest
        // land immediately after it. Fractional orders keep them adjacent without
        // renumbering siblings.
        const base = existing?.order ?? cur.length;
        const first: DocBlock = { id, type: 'md', text: plan.parts[0], order: base, updatedAt: now };
        const extra: DocBlock[] = plan.parts.slice(1).map((t, i) => ({
          id: `blk-${randomId()}`,
          type: 'md',
          text: t,
          order: base + (i + 1) / (plan.parts.length + 1),
          updatedAt: now,
        }));
        return { ...d, blocks: [...cur.filter((b) => b.id !== id), first, ...extra] };
      });
    },
    [apply, removeBlock],
  );

  return { blocks, opening, openError, offline, ready, reload, upsertBlock, editBlock, removeBlock };
}
