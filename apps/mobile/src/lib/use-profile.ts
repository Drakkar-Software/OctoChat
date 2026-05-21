import { useCallback, useEffect, useRef, useState } from 'react';

import { pickAndProcessAvatar } from './avatar-image';
import { readProfile, writeProfile } from './starfish/client';
import { useSession } from './session-context';
import { primeProfile } from './use-pseudos';

export interface ProfileView {
  name: string;
  handle: string;
  fingerprint: string;
  userId: string;
  /** The persisted avatar (data URI) — drives the sidebar; `/you` previews the draft. */
  avatar?: string;
}

// Each useProfile() call keeps its own state, so an edit on the Profile screen
// would otherwise leave other live consumers (e.g. the desktop sidebar) showing
// the stale name/avatar until reload. These module-level fan-outs let every
// mounted instance adopt a freshly-saved value immediately.
const nameListeners = new Set<(name: string) => void>();
const avatarListeners = new Set<(avatar: string | null) => void>();
function broadcastName(name: string) {
  for (const fn of nameListeners) fn(name);
}
function broadcastAvatar(avatar: string | null) {
  for (const fn of avatarListeners) fn(avatar);
}

/** The current identity's editable profile (name + avatar) + derived security info. */
export function useProfile() {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [draft, setDraftState] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarDraft, setAvatarDraftState] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // True once the user has touched the field — guards the draft against being
  // clobbered by an async load or a fan-out from another instance mid-edit.
  const edited = useRef(false);
  const avatarEdited = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!session) {
      setLoading(false);
      return;
    }
    setName(session.name);
    (async () => {
      const { pseudo, avatar: loaded } = await readProfile(session.userId);
      if (cancelled) return;
      if (pseudo) setName(pseudo);
      setAvatar(loaded);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Adopt the loaded/saved value into the draft, unless the user is mid-edit.
  useEffect(() => {
    if (!edited.current) setDraftState(name);
  }, [name]);
  useEffect(() => {
    if (!avatarEdited.current) setAvatarDraftState(avatar);
  }, [avatar]);

  // Reflect a save made by any other mounted instance.
  useEffect(() => {
    const fn = (next: string) => {
      if (!edited.current) setName(next);
    };
    nameListeners.add(fn);
    return () => {
      nameListeners.delete(fn);
    };
  }, []);
  useEffect(() => {
    const fn = (next: string | null) => {
      if (!avatarEdited.current) setAvatar(next);
    };
    avatarListeners.add(fn);
    return () => {
      avatarListeners.delete(fn);
    };
  }, []);

  const setDraft = useCallback((v: string) => {
    edited.current = true;
    setDraftState(v);
  }, []);

  /** Open the OS picker, downscale the chosen image, and stage it as the draft. */
  const pickAvatar = useCallback(async () => {
    setAvatarError(null);
    try {
      const uri = await pickAndProcessAvatar();
      if (uri == null) return; // cancelled
      avatarEdited.current = true;
      setAvatarDraftState(uri);
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : 'Could not use that image.');
    }
  }, []);

  /** Stage removal of the avatar (committed on Save). */
  const removeAvatar = useCallback(() => {
    setAvatarError(null);
    avatarEdited.current = true;
    setAvatarDraftState(null);
  }, []);

  const trimmed = draft.trim();
  const nameDirty = trimmed.length > 0 && trimmed !== name;
  const avatarDirty = avatarDraft !== avatar;
  const dirty = nameDirty || avatarDirty;

  const save = useCallback(async () => {
    if (!session) return;
    const nextName = draft.trim();
    const patch: { pseudo?: string; avatar?: string | null } = {};
    if (nextName && nextName !== name) patch.pseudo = nextName;
    if (avatarDraft !== avatar) patch.avatar = avatarDraft; // string ⇒ set, null ⇒ remove
    if (patch.pseudo === undefined && patch.avatar === undefined) return;
    setSaving(true);
    try {
      await writeProfile(session.accountClient, session.userId, patch);
      primeProfile(session.userId, patch);
      if (patch.pseudo !== undefined) {
        setName(patch.pseudo);
        setDraftState(patch.pseudo);
        edited.current = false;
        broadcastName(patch.pseudo);
      }
      if (patch.avatar !== undefined) {
        setAvatar(patch.avatar);
        setAvatarDraftState(patch.avatar);
        avatarEdited.current = false;
        broadcastAvatar(patch.avatar);
      }
    } finally {
      setSaving(false);
    }
  }, [session, draft, name, avatarDraft, avatar]);

  const profile: ProfileView | null = session
    ? {
        name,
        handle: `@${name}`,
        fingerprint: session.fingerprint,
        userId: session.userId,
        avatar: avatar ?? undefined,
      }
    : null;

  return {
    profile,
    loading,
    saving,
    draft,
    setDraft,
    dirty,
    save,
    // Avatar: preview the draft on /you; pick/remove stage a change for Save.
    avatarDraft,
    pickAvatar,
    removeAvatar,
    avatarError,
  };
}
