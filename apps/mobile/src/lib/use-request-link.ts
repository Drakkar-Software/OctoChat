/**
 * Hook that decodes and verifies a request-link identity token from the URL fragment,
 * derives the owner's display info, and reconstructs the full request link for submit.
 *
 * Extracted from `app/request.tsx` per CLAUDE.md rule 3 — all decode/verify/platform logic
 * lives here so the route page stays a thin UI composer.
 */
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import {
  decodeIdentityLink,
  verifyLinkBinding,
  type IdentityLink,
} from '@drakkar.software/octochat-sdk';
import { useInviteFragment } from '@/lib/use-invite-link';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';

export interface RequestLinkInfo {
  token: IdentityLink | null;
  decodeError: string | null;
  /** null = still verifying, false = invalid, true = valid */
  verified: boolean | null;
  /** True once verified === false */
  invalid: boolean;
  ownerId: string;
  ownerName: string;
  avatar: string | null | undefined;
  /** The full request URL to pass to submitRoomRequest / submitTicketRequest.
   *  null until both spaceId and fragment are present. */
  requestLink: string | null;
}

export function useRequestLink(spaceId: string | undefined): RequestLinkInfo {
  const inviteFrag = useInviteFragment();

  const { token, decodeError } = useMemo((): { token: IdentityLink | null; decodeError: string | null } => {
    if (!inviteFrag || inviteFrag === '#') return { token: null, decodeError: null };
    try {
      return { token: decodeIdentityLink(inviteFrag.replace(/^#/, '')), decodeError: null };
    } catch (e) {
      return { token: null, decodeError: String((e as Error)?.message ?? e) };
    }
  }, [inviteFrag]);

  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setVerified(null);
    void verifyLinkBinding(token).then((ok) => {
      if (!cancelled) setVerified(ok);
    });
    return () => { cancelled = true; };
  }, [token]);

  const ownerId = token?.ownerId ?? '';
  // Only fetch live pseudo/avatar once the token is verified.
  const livePseudo = usePseudos(verified ? [ownerId] : [])(ownerId)?.trim();
  const avatar = useAvatars(verified ? [ownerId] : [])(ownerId);
  const ownerName = livePseudo || token?.pseudo?.trim() || (ownerId ? ownerId.slice(0, 8) : 'someone');

  const requestLink = useMemo(() => {
    if (!spaceId || !inviteFrag || inviteFrag === '#') return null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.href;
    // Native: reconstruct from fragment + spaceId (no full URL available from deep-link).
    return `https://placeholder/request?s=${encodeURIComponent(spaceId)}${inviteFrag}`;
  }, [spaceId, inviteFrag]);

  return {
    token,
    decodeError,
    verified,
    invalid: !!token && verified === false,
    ownerId,
    ownerName,
    avatar,
    requestLink,
  };
}
