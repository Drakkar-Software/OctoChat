import { useCallback, useMemo } from 'react';

import { splitMarkdownBlocks } from './markdown';
import { objDocPull, objDocPush, pubObjDocPull, pubObjDocPush } from './starfish/paths';
import type { ID } from './types';
import { useMergeDoc } from './use-merge-doc';
import { useRoomLiveSync } from './use-room-live-sync';
import { randomId } from './ids';

/** A block of doc body content. Union-merged on `id` keyed by `updatedAt`, so two
 *  devices editing different blocks of the same doc both survive a merge. First-
 *  version docs store `md` blocks (raw Markdown in `text`); the legacy typed
 *  variants still render so any seeded content survives. */
export interface DocBlock {
  id: ID;
  type: 'md' | 'h2' | 'p' | 'quote' | 'bullets';
  text?: string;
  items?: string[];
  order: number;
  updatedAt: number;
}

/** Project a block to the Markdown source the renderer + editor both consume.
 *  Legacy typed blocks lift to equivalent Markdown so editing migrates them to
 *  `md` transparently. Pure → kept out of the component. */
export function blockMarkdown(b: DocBlock): string {
  if (b.type === 'h2') return `## ${b.text ?? ''}`;
  if (b.type === 'quote') return `> ${b.text ?? ''}`;
  if (b.type === 'bullets') return (b.items ?? []).map((i) => `- ${i}`).join('\n');
  return b.text ?? '';
}

export interface DocHook {
  blocks: DocBlock[];
  opening: boolean;
  openError: string | null;
  offline: boolean;
  ready: boolean;
  reload: () => void;
  /** Append/replace a block; returns its id, or null when not writable yet. */
  upsertBlock: (block: Partial<DocBlock> & { id?: ID }) => ID | null;
  /** Append several Markdown blocks at once (one merge write) — used when a paste
   *  fans out into multiple blocks. */
  upsertBlocks: (texts: string[]) => void;
  /** Commit an edited block's raw Markdown: empty → delete; a body that splits
   *  into several blocks fans out; otherwise a single in-place update. Holds the
   *  whole commit decision so the editing component branches on nothing. */
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

  const upsertBlocks = useCallback(
    (texts: string[]) => {
      const now = Date.now();
      apply((d) => {
        const cur = (d.blocks as DocBlock[]) ?? [];
        const added: DocBlock[] = texts.map((text, i) => ({ id: `blk-${randomId()}`, type: 'md', text, order: cur.length + i, updatedAt: now }));
        return { ...d, blocks: [...cur, ...added] };
      });
    },
    [apply],
  );

  const editBlock = useCallback(
    (id: ID, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        removeBlock(id);
        return;
      }
      const parts = splitMarkdownBlocks(trimmed);
      if (parts.length <= 1) {
        upsertBlock({ id, type: 'md', text: trimmed });
        return;
      }
      // First part stays in this block (preserving its id/merge identity); the
      // rest land immediately after it. Fractional orders keep them adjacent
      // without renumbering siblings.
      const now = Date.now();
      apply((d) => {
        const cur = (d.blocks as DocBlock[]) ?? [];
        const existing = cur.find((b) => b.id === id);
        const base = existing?.order ?? cur.length;
        const first: DocBlock = { id, type: 'md', text: parts[0], order: base, updatedAt: now };
        const extra: DocBlock[] = parts.slice(1).map((t, i) => ({
          id: `blk-${randomId()}`,
          type: 'md',
          text: t,
          order: base + (i + 1) / (parts.length + 1),
          updatedAt: now,
        }));
        return { ...d, blocks: [...cur.filter((b) => b.id !== id), first, ...extra] };
      });
    },
    [apply, removeBlock, upsertBlock],
  );

  return { blocks, opening, openError, offline, ready, reload, upsertBlock, upsertBlocks, editBlock, removeBlock };
}
