/**
 * The "scan a DM code" flow, behind one hook so the DMs-tab affordance stays a
 * thin component. A DM QR encodes someone's `…/dm#<token>` link (their portable
 * identity — see the SDK's `dm-link.ts`); scanning it mirrors the `/dm` landing
 * screen (`app/dm.tsx`) but driven by a camera payload instead of a deep-link
 * fragment:
 *
 *   open → scanning → (decode + verify) → confirm → start → /room/[id]
 *
 * The confirm step is deliberate: even a scan must show WHOSE code it is and
 * wait for an explicit tap before creating a conversation, and the offline
 * identity binding (ownerId == sha256(edPub)) is verified before anything about
 * the owner is shown — a tampered code never renders a misleading identity.
 */
import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';

import { createDmViaLink, decodeIdentityLink, verifyIdentityLinkBinding, type IdentityLink } from '@drakkar.software/octochat-sdk';

import { useSession } from './session-context';

export type DmScanPhase = 'idle' | 'scanning' | 'confirm' | 'starting';

export interface DmScan {
  /** Where we are in the flow (drives what the UI renders). */
  phase: DmScanPhase;
  /** The decoded code, once scanned. `null` while scanning or on a decode error. */
  token: IdentityLink | null;
  /** Display name for the scanned identity (the live profile resolves after start). */
  name: string;
  /** Mono handle for the scanned identity. */
  handle: string;
  /** Offline identity-binding check: `null` checking, `false` forged, `true` ok. */
  verified: boolean | null;
  /** The scanned code is your own link — can't DM yourself. */
  isSelf: boolean;
  error: string | null;
  /** Open the camera scanner. */
  open: () => void;
  /** Close and reset everything back to idle. */
  cancel: () => void;
  /** Feed a scanned payload — a `…/dm#…` URL (or a bare fragment). */
  scan: (data: string) => void;
  /** Create/open the DM for the confirmed code and navigate to the room. */
  start: () => Promise<void>;
}

export function useDmScan(): DmScan {
  const { session } = useSession();
  const [phase, setPhase] = useState<DmScanPhase>('idle');
  const [token, setToken] = useState<IdentityLink | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(() => {
    setError(null);
    setToken(null);
    setVerified(null);
    setPhase('scanning');
  }, []);

  const cancel = useCallback(() => {
    setPhase('idle');
    setToken(null);
    setVerified(null);
    setError(null);
  }, []);

  const scan = useCallback((data: string) => {
    // The QR encodes an identity link (`…/dm#<token>` or `…/request?s=…#<token>`); the identity
    // rides in the fragment, so take everything after the first `#` (dropping any `?s=` query)
    // and decode it (a malformed code then errors out).
    const i = data.indexOf('#');
    const frag = i === -1 ? data : data.slice(i + 1);
    let decoded: IdentityLink;
    try {
      decoded = decodeIdentityLink(frag);
    } catch (e) {
      setToken(null);
      setVerified(null);
      setError(String((e as Error)?.message ?? e));
      setPhase('confirm');
      return;
    }
    setError(null);
    setToken(decoded);
    setVerified(null);
    setPhase('confirm');
    if (session) void verifyIdentityLinkBinding(decoded, session).then(setVerified);
  }, [session]);

  // The link's embedded pseudo is only a display hint until the live profile
  // loads (the DM's crypto binds to the KEYS, not this string); fall back to the
  // id prefix so there's always something to name the person.
  const name = useMemo(() => token?.pseudo?.trim() || (token ? token.ownerId.slice(0, 8) : ''), [token]);
  const handle = useMemo(
    () => (token ? (token.pseudo?.trim() ? `@${token.pseudo.trim()}` : `@${token.ownerId.slice(0, 6)}`) : ''),
    [token],
  );
  const isSelf = !!session && !!token && token.ownerId === session.userId;

  const start = useCallback(async () => {
    if (!session || !token || isSelf) return;
    setPhase('starting');
    setError(null);
    try {
      const { roomId } = await createDmViaLink(session, token, name);
      cancel();
      router.push({ pathname: '/room/[id]', params: { id: roomId, name, kind: 'dm' } });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setPhase('confirm');
    }
  }, [session, token, isSelf, name, cancel]);

  return { phase, token, name, handle, verified, isSelf, error, open, cancel, scan, start };
}
