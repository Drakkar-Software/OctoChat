/**
 * The account's portable identity link (the v:2 `IdentityLink`): permanent, the same on every
 * device, nothing to generate or revoke. ONE producer shared by both link surfaces — the profile
 * "DM me" share (`path: 'dm'`) and a space's request link base (`path: 'request'`, then wrapped
 * with the target space by `encodeRequestLink`). Derives via `myIdentityLink` (root device: from
 * the session keys; paired device: from the published profile) and exposes a loading state.
 */
import { useEffect, useState } from 'react';

import { myIdentityLink } from '@drakkar.software/octochat-sdk';

import { webOrigin } from './links';
import { useSession } from './session-context';

export interface UseIdentityLink {
  /** True until the link has been derived. */
  loading: boolean;
  /** The shareable URL, or `null` when the identity's keys aren't published yet
   *  (a brand-new account that hasn't synced). */
  link: string | null;
}

export function useIdentityLink(path = 'dm'): UseIdentityLink {
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    void myIdentityLink(session, webOrigin(), path)
      .then((l) => {
        if (!cancelled) setLink(l);
      })
      .catch(() => {
        if (!cancelled) setLink(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, path]);

  return { loading, link };
}
