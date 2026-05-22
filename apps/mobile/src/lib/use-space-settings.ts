import { useCallback, useEffect, useState } from 'react';

import { inviteToSpace } from './starfish/members';
import { removeMemberCap } from './starfish/member-caps';
import { createPublicInvite, isPublicSpaceId, publicSpaceAuth } from './starfish/pubspace';
import { removePubspaceAccess } from './starfish/pubspace-caps';
import { readRooms, readSpaces, writeSpaces } from './starfish/registry';
import { useSession } from './session-context';

/**
 * Space info + owner-gated settings for the space screen, branched by space type:
 *  - PRIVATE: ownership + roster are the authoritative `owner`/`members` in the space
 *    registry (registry.ts / space-role.ts); invites are encrypted (inviteToSpace).
 *  - PUBLIC: there is no roster — ownership is whether this identity holds the owner
 *    account cap (no stored invite); invites are space-wide invitation LINKS.
 */
export function useSpaceSettings(spaceId: string) {
  const { session } = useSession();
  const isPublic = isPublicSpaceId(spaceId);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    if (isPublic) {
      setOwnerId(publicSpaceAuth(session, spaceId).ownerId);
      setMembers([]); // public spaces have no roster (access is by cap, not membership)
      return;
    }
    const { owner, members: roster } = await readRooms(session.accountClient, spaceId);
    setOwnerId(owner);
    setMembers(roster);
  }, [session, spaceId, isPublic]);

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

  // Private: legacy space with no recorded owner is treated as the viewer's own.
  // Public: owner iff this identity holds the owner cap (publicSpaceAuth resolves it).
  const isOwner = !!session && (ownerId === null || ownerId === session.userId);
  const isMember = !!session && !isOwner;

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

  /** PRIVATE owner: invite an identity (their join request) into this space. */
  const invite = useCallback(
    async (requestJson: string): Promise<string> => {
      if (!session) throw new Error('Not signed in.');
      const bundle = await inviteToSpace(session, spaceId, requestJson);
      await refresh();
      return bundle;
    },
    [session, spaceId, refresh],
  );

  /** PUBLIC owner: mint a space-wide invitation link (read-only or read/write). */
  const createInvite = useCallback(
    async (write: boolean, spaceName: string, origin: string): Promise<string> => {
      if (!session) throw new Error('Not signed in.');
      const { link } = await createPublicInvite(session, spaceId, spaceName, write, origin);
      return link;
    },
    [session, spaceId],
  );

  /** Drop the space from your own list + forget its cap (member/joiner side). */
  const leave = useCallback(async () => {
    if (!session) return;
    const { spaces, hash } = await readSpaces(session.accountClient, session.userId);
    await writeSpaces(session.accountClient, session.userId, spaces.filter((s) => s.id !== spaceId), hash);
    if (isPublic) removePubspaceAccess(spaceId);
    else removeMemberCap(spaceId);
  }, [session, spaceId, isPublic]);

  return { ownerId, isOwner, isMember, members, loading, isPublic, rename, invite, createInvite, leave };
}
