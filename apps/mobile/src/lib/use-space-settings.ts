import { useCallback, useEffect, useRef, useState } from 'react';

import { pickAndProcessAvatar } from './avatar-image';
import { inviteToSpace } from '@drakkar.software/octochat-sdk';
import { broadcastSpaceMeta, readSpaces, removeJoinedSpace, writeSpaces } from '@drakkar.software/octochat-sdk';
import { readSpaceAccess, writeSpaceAccess } from '@drakkar.software/octochat-sdk';
import { getSpaceClient } from '@drakkar.software/octochat-sdk';
import { createSpaceInviteLink, removeSpaceAccessEntry } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';

/**
 * Space info + owner-gated settings for the space screen. In the per-node model
 * every space is the same type — the access distinction (`public`/`space`/`invite`)
 * lives on individual rooms (nodes), not on the space itself. The access record at
 * `spaces/{spaceId}/_access` holds the owner + member roster + shared name/image.
 */
export function useSpaceSettings(spaceId: string) {
  const { session } = useSession();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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
    const spaceClient = getSpaceClient(spaceId, session);
    const { owner, members: roster, name: sharedName, image: sharedImage } = await readSpaceAccess(spaceClient, spaceId);
    const { spaces } = await readSpaces(session.spacesRegistryClient, session.userId);
    const local = spaces.find((s) => s.id === spaceId);
    setOwnerId(owner);
    setMembers(roster);
    setName(sharedName ?? local?.name ?? '');
    setImage(sharedImage ?? local?.image ?? null);
  }, [session, spaceId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show loading while (re)reading space settings on change
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

  useEffect(() => {
    if (!nameEdited.current) setNameDraftState(name);
  }, [name]);
  useEffect(() => {
    if (!imageEdited.current) setImageDraftState(image);
  }, [image]);

  const isOwner = !!session && !loading && ownerId !== null && ownerId === session.userId;
  const isMember = !!session && !loading && !isOwner && members.includes(session.userId);

  const setNameDraft = useCallback((v: string) => {
    nameEdited.current = true;
    setNameDraftState(v);
  }, []);

  const pickImage = useCallback(async () => {
    setImageError(null);
    try {
      const uri = await pickAndProcessAvatar();
      if (uri == null) return;
      imageEdited.current = true;
      setImageDraftState(uri);
    } catch (e) {
      setImageError(e instanceof Error ? e.message : 'Could not use that image.');
    }
  }, []);

  const removeImage = useCallback(() => {
    setImageError(null);
    imageEdited.current = true;
    setImageDraftState(null);
  }, []);

  const trimmedName = nameDraft.trim();
  const nameDirty = trimmedName.length > 0 && trimmedName !== name;
  const imageDirty = imageDraft !== image;
  const dirty = nameDirty || imageDirty;

  const save = useCallback(async () => {
    if (!session || saving || !dirty) return;
    const nextName = nameDirty ? trimmedName : name;
    const nextImage = imageDraft;
    setSaving(true);
    try {
      const spaceClient = getSpaceClient(spaceId, session);
      const { owner, members: roster, hash } = await readSpaceAccess(spaceClient, spaceId);
      await writeSpaceAccess(spaceClient, spaceId, owner ?? session.userId, roster, hash, {
        name: nextName,
        image: nextImage,
      });
      const short = nextName.slice(0, 2).toUpperCase();
      const { spaces, hash: spacesHash } = await readSpaces(session.spacesRegistryClient, session.userId);
      const next = spaces.map((s) =>
        s.id === spaceId ? { ...s, name: nextName, short, image: nextImage ?? undefined } : s,
      );
      await writeSpaces(session.spacesRegistryClient, session.userId, next, spacesHash);
      broadcastSpaceMeta(spaceId, { name: nextName, short, image: nextImage ?? undefined });
      setName(nextName);
      setImage(nextImage);
      nameEdited.current = false;
      imageEdited.current = false;
    } finally {
      setSaving(false);
    }
  }, [session, saving, dirty, nameDirty, trimmedName, name, imageDraft, spaceId]);

  /** Invite a specific member into this space (E2EE bundle invite). */
  const invite = useCallback(
    async (requestJson: string): Promise<string> => {
      if (!session) throw new Error('Not signed in.');
      const bundle = await inviteToSpace(session, spaceId, requestJson);
      await refresh();
      return bundle;
    },
    [session, spaceId, refresh],
  );

  /** Mint a space-wide invitation link (read-only or read/write). */
  const createInvite = useCallback(
    async (write: boolean, spaceName: string, origin: string): Promise<string> => {
      if (!session) throw new Error('Not signed in.');
      const { link } = await createSpaceInviteLink(session, spaceId, spaceName, write, origin);
      return link;
    },
    [session, spaceId],
  );

  /** Drop the space from your own list + forget its durable credential. */
  const leave = useCallback(async () => {
    if (!session) return;
    await removeJoinedSpace(session.spacesRegistryClient, session.userId, spaceId);
    removeSpaceAccessEntry(spaceId);
  }, [session, spaceId]);

  /** Owner: remove a member from the space roster (server-enforced eviction). */
  const removeMember = useCallback(
    async (memberUserId: string) => {
      if (!session) return;
      const spaceClient = getSpaceClient(spaceId, session);
      const { owner, members: roster, name: n, image: img, hash } = await readSpaceAccess(spaceClient, spaceId);
      if (!roster.includes(memberUserId)) return; // idempotent
      await writeSpaceAccess(
        spaceClient, spaceId, owner ?? session.userId,
        roster.filter((m) => m !== memberUserId), hash,
        { name: n, image: img },
      );
      await refresh();
    },
    [session, spaceId, refresh],
  );

  return {
    ownerId,
    isOwner,
    isMember,
    members,
    loading,
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
    removeMember,
  };
}
