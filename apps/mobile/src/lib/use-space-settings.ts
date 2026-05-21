import { useCallback, useEffect, useState } from 'react';

import { inviteToSpace } from './starfish/members';
import { removeMemberCap } from './starfish/member-caps';
import { readRooms, readSpaces, writeSpaces } from './starfish/registry';
import { useSession } from './session-context';

/**
 * Space info + owner-gated settings/invites for the space screen. Ownership +
 * roster are the authoritative `owner`/`members` recorded in the space registry
 * (registry.ts / space-role.ts); a legacy space with no recorded owner is treated
 * as the viewer's own (it lives in their identity-bound `_spaces`).
 */
export function useSpaceSettings(spaceId: string) {
  const { session } = useSession();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const { owner, members: roster } = await readRooms(session.accountClient, spaceId);
    setOwnerId(owner);
    setMembers(roster);
  }, [session, spaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!session) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        await refresh();
      } catch {
        /* leave defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, refresh]);

  const isOwner = !!session && (ownerId === null || ownerId === session.userId);
  const isMember = !!session && !isOwner; // a non-owner viewing a space they joined

  const rename = useCallback(
    async (name: string) => {
      if (!session) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const { spaces, hash } = await readSpaces(session.accountClient, session.userId);
      const next = spaces.map((s) =>
        s.id === spaceId ? { ...s, name: trimmed, short: trimmed.slice(0, 2).toUpperCase() } : s,
      );
      await writeSpaces(session.accountClient, session.userId, next, hash);
    },
    [session, spaceId],
  );

  /** Owner: invite an identity (their join request) into this space. */
  const invite = useCallback(
    async (requestJson: string): Promise<string> => {
      if (!session) throw new Error('Not signed in.');
      const bundle = await inviteToSpace(session, spaceId, requestJson);
      await refresh();
      return bundle;
    },
    [session, spaceId, refresh],
  );

  /** Member: drop the space from your own list + forget its cap. (Owner-side
   *  roster removal stays with the owner — a member can't write the roster.) */
  const leave = useCallback(async () => {
    if (!session) return;
    const { spaces, hash } = await readSpaces(session.accountClient, session.userId);
    await writeSpaces(session.accountClient, session.userId, spaces.filter((s) => s.id !== spaceId), hash);
    removeMemberCap(spaceId);
  }, [session, spaceId]);

  return { ownerId, isOwner, isMember, members, loading, rename, invite, leave };
}
