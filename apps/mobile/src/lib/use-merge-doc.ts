import { useCallback, useEffect, useMemo, useState } from 'react';
import { createUnionMerge } from '@drakkar.software/starfish-client';
import { useSyncInit } from '@drakkar.software/starfish-client/zustand';

import { SYNC_BASE, SYNC_NAMESPACE } from './starfish/config';
import { capProviderFor } from './starfish/client';
import { fetchWithTimeout } from './starfish/fetch-timeout';
import { getMemberCap } from './starfish/member-caps';
import { pullCache, PULL_CACHE_MAX_AGE_MS } from './starfish/pull-cache';
import { isPublicSpaceId, publicSpaceAuth } from './starfish/pubspace';
import { useSession } from './session-context';
import { useRoomOpen } from './use-room-open-flow';

/** A pull/push path pair for a Starfish merge-doc. */
export interface DocPaths {
  pull: string;
  push: string;
}

export interface MergeDocOptions {
  /** The space the doc lives in (drives the private/public branch + encryptor). */
  spaceId: string;
  /** The id passed to {@link useRoomOpen} (the space id for a space-wide doc like the
   *  object index, or the object id for a per-object doc). Only keys the open/effect. */
  openId: string;
  enabled: boolean;
  /** Unique suffix for the SDK store name (e.g. `objindex:<spaceId>`). */
  storeKey: string;
  /** Build the private (E2EE) paths. */
  privatePaths: () => DocPaths;
  /** Build the public (plaintext) paths from the resolved owner id. */
  publicPaths: (ownerId: string) => DocPaths;
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
 * near-identical bodies they used to duplicate (and the same shape {@link useRoom} uses
 * inline for chat). Handles the private/public auth branch, the space-wide encryptor
 * open, `useSyncInit` with a union-merge resolver, offline-first cache paint, and the
 * liveReady/subscribe gate that defers mutations until a fresh pull confirms the store
 * is writable. Callers layer their domain shape (which array, which mutations) on top.
 */
export function useMergeDoc(opts: MergeDocOptions): MergeDocResult {
  const { spaceId, openId, enabled, storeKey, privatePaths, publicPaths } = opts;
  const { session } = useSession();
  const isPublic = isPublicSpaceId(spaceId);

  const { encryptor, client, opening, openError, offline, reload } = useRoomOpen({
    roomId: openId,
    spaceId,
    isPublic,
    enabled,
    initializeRoom: false,
  });

  const config = useMemo(() => {
    if (!enabled || !session || !client) return null;
    const base = {
      serverUrl: SYNC_BASE,
      namespace: SYNC_NAMESPACE,
      onConflict: createUnionMerge({ idKey: 'id', timestampKey: 'updatedAt' }),
      storage: false as const,
      fetch: fetchWithTimeout(),
      cache: pullCache(),
      cacheMaxAgeMs: PULL_CACHE_MAX_AGE_MS,
    };
    if (isPublic) {
      const auth = publicSpaceAuth(session, spaceId);
      const paths = publicPaths(auth.ownerId);
      return {
        ...base,
        capProvider: capProviderFor(auth.cap, auth.signingKey),
        pullPath: paths.pull,
        pushPath: paths.push,
        storeName: `md-pub-${session.userId}-${storeKey}`,
      };
    }
    if (!encryptor) return null;
    const memberCap = getMemberCap(spaceId);
    const cap = memberCap ? JSON.parse(memberCap) : session.chatCap;
    const paths = privatePaths();
    return {
      ...base,
      capProvider: capProviderFor(cap, session.keys.edPriv),
      pullPath: paths.pull,
      pushPath: paths.push,
      encryptor,
      storeName: `md-${session.userId}-${storeKey}`,
    };
    // privatePaths/publicPaths are stable per render from the caller's closure; the path
    // values they return are captured by spaceId/openId which ARE deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session, client, encryptor, spaceId, isPublic, storeKey]);

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

  // Writable as soon as the store is open (client + encryptor resolved) — we do
  // NOT wait for a fresh pull to settle. These docs are union-merged (by `id` +
  // `updatedAt`), so a node/block created offline-first merges cleanly with server
  // state on the next pull; gating writes on a settled sync instead left creation
  // permanently dead whenever the first pull never settles (offline / unreachable
  // server / a brand-new empty doc) — e.g. the Work tab on mobile.
  // `update` runs SYNCHRONOUSLY inside `set` (the zustand store invokes the updater
  // immediately to compute the next state). Callers rely on this to read a value computed
  // inside the updater right after `apply` returns (e.g. useDoc's `mergeText` captures the
  // advanced merge base) — keep it synchronous if this is ever reworked.
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
