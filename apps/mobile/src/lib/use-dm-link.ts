/**
 * The account's "DM me" link for the profile screen. The link is the IDENTITY
 * made portable (userId + pseudo + published public keys — see the SDK's
 * `dm-link.ts`): permanent, the same on every device, nothing to generate or
 * revoke. This hook only derives it (root session: synchronously from the keys;
 * paired device: through the cached public profile) and exposes a loading state.
 */
import { useEffect, useState } from 'react';

import { myDmLink } from '@drakkar.software/octochat-sdk';

import { webOrigin } from './links';
import { useSession } from './session-context';

export interface UseDmLink {
  /** True until the link has been derived. */
  loading: boolean;
  /** The shareable URL, or `null` when the identity's keys aren't published yet
   *  (a brand-new account that hasn't synced). */
  link: string | null;
}

export function useDmLink(): UseDmLink {
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    void myDmLink(session, webOrigin())
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
  }, [session]);

  return { loading, link };
}
