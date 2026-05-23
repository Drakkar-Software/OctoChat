import { useCallback, useEffect, useRef, useState } from 'react';

import { pickAndProcessAvatar } from './avatar-image';
import { inviteToSpace } from './starfish/members';
import { removeMemberCap } from './starfish/member-caps';
import {
  createPublicInvite,
  isPublicSpaceId,
  publicSpaceAuth,
  publicSpaceClient,
  readPublicRoomsDoc,
  updatePublicSpaceMeta,
} from './starfish/pubspace';
import { removePubspaceAccess } from './starfish/pubspace-caps';
import { broadcastSpaceMeta, readRooms, readSpaces, writeRooms, writeSpaces } from './starfish/registry';
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

  // Current (shared-preferred) identity + edit drafts. Mirrors useProfile: an
  // `edited` ref guards each draft from being clobbered by an async (re)load.
  const [name, setName] = useState('');
  const [nameDraft, setNameDraftState] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [imageDraft, setImageDraftState] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameEdited = useRef(false);
  const imageEdited = useRef(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    // The local `_spaces` entry is the display fallback for a registry that predates
    // this feature (no shared name/image yet); the shared value wins when present.
    const { spaces } = await readSpaces(session.accountClient, session.userId);
    const local = spaces.find((s) => s.id === spaceId);
    if (isPublic) {
      const auth = publicSpaceAuth(session, spaceId);
      setOwnerId(auth.ownerId);
      setMembers([]); // public spaces have no roster (access is by cap, not membership)
      const doc = await readPublicRoomsDoc(publicSpaceClient(session, spaceId), auth.ownerId, spaceId);
      setName(doc.name ?? local?.name ?? '');
      setImage(doc.image ?? local?.image ?? null);
      return;
    }
    const { owner, members: roster, name: sharedName, image: sharedImage } = await readRooms(
      session.accountClient,
      spaceId,
    );
    setOwnerId(owner);
    setMembers(roster);
    setName(sharedName ?? local?.name ?? '');
    setImage(sharedImage ?? local?.image ?? null);
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

  // Adopt the loaded/saved value into the draft, unless the user is mid-edit.
  useEffect(() => {
    if (!nameEdited.current) setNameDraftState(name);
  }, [name]);
  useEffect(() => {
    if (!imageEdited.current) setImageDraftState(image);
  }, [image]);

  // Private: legacy space with no recorded owner is treated as the viewer's own.
  // Public: owner iff this identity holds the owner cap (publicSpaceAuth resolves it).
  const isOwner = !!session && (ownerId === null || ownerId === session.userId);
  const isMember = !!session && !isOwner;

  const setNameDraft = useCallback((v: string) => {
    nameEdited.current = true;
    setNameDraftState(v);
  }, []);

  /** Open the OS picker, downscale the chosen image, and stage it as the draft. */
  const pickImage = useCallback(async () => {
    setImageError(null);
    try {
      const uri = await pickAndProcessAvatar();
      if (uri == null) return; // cancelled
      imageEdited.current = true;
      setImageDraftState(uri);
    } catch (e) {
      setImageError(e instanceof Error ? e.message : 'Could not use that image.');
    }
  }, []);

  /** Stage removal of the image (committed on Save). */
  const removeImage = useCallback(() => {
    setImageError(null);
    imageEdited.current = true;
    setImageDraftState(null);
  }, []);

  const trimmedName = nameDraft.trim();
  const nameDirty = trimmedName.length > 0 && trimmedName !== name;
  const imageDirty = imageDraft !== image;
  const dirty = nameDirty || imageDirty;

  /**
   * Owner: persist name + image to the SHARED registry (private or public `_rooms`),
   * then fold the change into this identity's own `_spaces` cache and fan it out so
   * live rails/headers update. Other members pick it up on their next space open.
   */
  const save = useCallback(async () => {
    if (!session || saving || !dirty) return;
    const nextName = nameDirty ? trimmedName : name;
    const nextImage = imageDraft; // string ⇒ set, null ⇒ remove
    setSaving(true);
    try {
      if (isPublic) {
        await updatePublicSpaceMeta(session, spaceId, { name: nextName, image: nextImage });
      } else {
        const { rooms, owner, members: roster, hash } = await readRooms(session.accountClient, spaceId);
        await writeRooms(session.accountClient, spaceId, rooms, owner ?? session.userId, roster, hash, {
          name: nextName,
          image: nextImage,
        });
      }
      const short = nextName.slice(0, 2).toUpperCase();
      const { spaces, hash } = await readSpaces(session.accountClient, session.userId);
      const next = spaces.map((s) =>
        s.id === spaceId ? { ...s, name: nextName, short, image: nextImage ?? undefined } : s,
      );
      await writeSpaces(session.accountClient, session.userId, next, hash);
      broadcastSpaceMeta(spaceId, { name: nextName, short, image: nextImage ?? undefined });
      setName(nextName);
      setImage(nextImage);
      nameEdited.current = false;
      imageEdited.current = false;
    } finally {
      setSaving(false);
    }
  }, [session, saving, dirty, nameDirty, trimmedName, name, imageDraft, isPublic, spaceId]);

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

  return {
    ownerId,
    isOwner,
    isMember,
    members,
    loading,
    isPublic,
    name,
    image,
    nameDraft,
    setNameDraft,
    imageDraft,
    pickImage,
    removeImage,
    imageError,
    dirty,
    saving,
    save,
    invite,
    createInvite,
    leave,
  };
}
