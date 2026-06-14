import { useCallback, useEffect, useMemo, useState } from 'react';
import { createUnionMerge } from '@drakkar.software/starfish-client';
import { useSyncInit } from '@drakkar.software/starfish-client/zustand';

import { SYNC_BASE, SYNC_NAMESPACE } from './octochat-config';
import { capProviderFor } from '@drakkar.software/octochat-sdk';
import { fetchWithTimeout } from '@drakkar.software/octochat-sdk';
import { getSpaceAccessEntry } from '@drakkar.software/octospaces-sdk';
import { pullCache, PULL_CACHE_MAX_AGE_MS } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';
import { useRoomOpen } from './use-room-open-flow';
import { resolveMemberAuth } from './space-cap';

/** A pull/push path pair for a Starfish merge-doc. */
export interface DocPaths {
  pull: string;
  push: string;
}

export interface MergeDocOptions {
  /** The space the doc lives in (drives the per-node encryptor). */
  spaceId: string;
  /** The id passed to {@link useRoomOpen} (the space id for a space-wide doc like the
   *  object index, or the object id for a per-object doc). Only keys the open/effect. */
  openId: string;
  enabled: boolean;
  /** Unique suffix for the SDK store name (e.g. `objindex:<spaceId>`). */
  storeKey: string;
  /** Build the doc paths. */
  paths: () => DocPaths;
  /** True when the doc is E2EE (sealed with the space-wide keyring). Defaults false. */
  enc?: boolean;
  /** @deprecated Pass `paths` instead; `privatePaths` is accepted as an alias for
   *  back-compat with callers that haven't migrated yet. */
  privatePaths?: () => DocPaths;
  /** @deprecated No-op — there are no longer separate public/private path sets.
   *  Remove from call sites. */
  publicPaths?: (ownerId: string) => DocPaths;
}

export interface MergeDocResult {
  /** The current doc data (the merged document), or null before the first read. */
  doc: Record<string, unknown> | null;
  /** True once the store is open and safe to mutate (offline-first; see {@link apply}). */
  ready: boolean;
  /** True once data has actually painted (cache or first pull) — distinguishes a
   *  genuinely-empty doc from one still loading. `ready` flips on store-open, which is
   *  too eager to drive an empty-state vs. spinner decision; gate that on `loaded`. */
  loaded: boolean;
  opening: boolean;
  openError: string | null;
  offline: boolean;
  reload: () => void;
  /** Apply an update to the live doc (no-op + false when not ready). */
  apply: (update: (doc: Record<string, unknown>) => Record<string, unknown>) => boolean;
  /** Trigger a fresh server pull of the doc (for live-sync on an SSE change). No-op
   *  before the store exists. */
  pull: () => void;
}

/**
 * Generic union-merged Starfish doc hook — the shared core of {@link useObjects} (the
 * object index) and {@link useDoc} (a doc's block content), factored out of the
 * near-identical bodies they used to duplicate. Handles the space-wide encryptor open
 * (when `enc` is true), `useSyncInit` with a union-merge resolver, offline-first cache
 * paint, and the liveReady/subscribe gate that defers mutations until a fresh pull
 * confirms the store is writable. Callers layer their domain shape on top.
 *
 * In the 0.4.3 model all spaces use the same path family (no public/private split):
 * the object index is always plaintext (`enc` omitted / false); per-object docs are
 * E2EE when `enc: true` and the node carries the space keyring.
 */
export function useMergeDoc(opts: MergeDocOptions): MergeDocResult {
  const { spaceId, openId, enabled, storeKey } = opts;
  // `paths` is the new name; `privatePaths` is accepted as a back-compat alias.
  const getPaths = opts.paths ?? opts.privatePaths;
  const enc = opts.enc ?? false;
  const { session } = useSession();

  const { encryptor, client, opening, openError, offline, reload } = useRoomOpen({
    roomId: openId,
    spaceId,
    enc,
    enabled,
  });

  const config = useMemo(() => {
    if (!enabled || !session || !client) return null;
    // For E2EE docs the encryptor must be ready; plaintext docs proceed without it.
    if (enc && !encryptor) return null;
    if (!getPaths) return null;
    const base = {
      serverUrl: SYNC_BASE,
      namespace: SYNC_NAMESPACE,
      onConflict: createUnionMerge({ idKey: 'id', timestampKey: 'updatedAt' }),
      storage: false as const,
      fetch: fetchWithTimeout(),
      cache: pullCache(),
      cacheMaxAgeMs: PULL_CACHE_MAX_AGE_MS,
    };
    // Use the access entry cap + its signing key. For link-joined spaces the cap
    // is bound to an ephemeral bearer key (entry.key), NOT the account ed key.
    // resolveMemberAuth picks the right key automatically.
    const entry = getSpaceAccessEntry(spaceId);
    const { cap, signKey } = resolveMemberAuth(entry, session.chatCap, session.keys.edPriv);
    const docPaths = getPaths();
    return {
      ...base,
      capProvider: capProviderFor(cap, signKey),
      pullPath: docPaths.pull,
      pushPath: docPaths.push,
      ...(encryptor ? { encryptor } : {}),
      storeName: `md-${session.userId}-${storeKey}`,
    };
    // getPaths/privatePaths are stable per render from the caller's closure; the path
    // values they return are captured by spaceId/openId which ARE deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session, client, encryptor, spaceId, enc, storeKey]);

  const store = useSyncInit(config);

  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset data when the store identity changes (space/object switch or reopen)
    setDoc(null);
    if (!store) return;
    const read = () => {
      const s = store.getState() as { data?: Record<string, unknown> };
      setDoc(s.data ?? null);
    };
    read();
    return store.subscribe(() => read());
  }, [store]);

  const apply = useCallback(
    (update: (doc: Record<string, unknown>) => Record<string, unknown>) => {
      if (!store) return false;
      store.getState().set((d: Record<string, unknown>) => update(d));
      return true;
    },
    [store],
  );
  const pull = useCallback(() => {
    if (store) void (store.getState() as { pull?: () => Promise<unknown> }).pull?.();
  }, [store]);

  return { doc, ready: !!store, loaded: doc !== null, opening: enabled ? opening : false, openError, offline, reload, apply, pull };
}
