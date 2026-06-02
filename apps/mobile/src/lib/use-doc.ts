import { useCallback, useMemo } from 'react';

import { objDocPull, objDocPush, pubObjDocPull, pubObjDocPush } from './starfish/paths';
import type { ID } from './types';
import { useMergeDoc } from './use-merge-doc';
import { randomId } from './ids';

/** A block of doc body content. Union-merged on `id` keyed by `updatedAt`, so two
 *  devices editing different blocks of the same doc both survive a merge. */
export interface DocBlock {
  id: ID;
  type: 'h2' | 'p' | 'quote' | 'bullets';
  text?: string;
  items?: string[];
  order: number;
  updatedAt: number;
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
  removeBlock: (id: ID) => void;
}

/** Doc body content for one `doc` Object — a merge-doc (see {@link useMergeDoc}) holding
 *  the block list; the doc's title/emoji live on the index NODE ({@link useObjects}). The
 *  rich block editor is a later milestone; this gives the synced block model its render. */
export function useDoc(spaceId: string, objectId: string, opts: { enabled?: boolean } = {}): DocHook {
  const enabled = (opts.enabled ?? true) && !!spaceId && !!objectId;

  const { doc, ready, opening, openError, offline, reload, apply } = useMergeDoc({
    spaceId,
    openId: objectId,
    enabled,
    storeKey: `objdoc:${objectId}`,
    privatePaths: () => ({ pull: objDocPull(spaceId, objectId), push: objDocPush(spaceId, objectId) }),
    publicPaths: (ownerId) => ({ pull: pubObjDocPull(ownerId, spaceId, objectId), push: pubObjDocPush(ownerId, spaceId, objectId) }),
  });

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
          type: block.type ?? existing?.type ?? 'p',
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

  return { blocks, opening, openError, offline, ready, reload, upsertBlock, removeBlock };
}
