/**
 * App-wide editable profile (name + avatar) + derived security info, mounted once
 * near the root. Before this, every `useProfile()` caller (the sidebar, the /you
 * screen) was a standalone hook with its own state and its own `profile` fetch, so
 * the doc was pulled several times per load and a save had to be fanned out to the
 * other live instances through a module-level listener set. With one shared copy a
 * save simply updates state and every consumer re-renders — no fan-out needed.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

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

interface ProfileContextValue {
  profile: ProfileView | null;
  loading: boolean;
  saving: boolean;
  draft: string;
  setDraft: (v: string) => void;
  dirty: boolean;
  save: () => Promise<void>;
  avatarDraft: string | null;
  pickAvatar: () => Promise<void>;
  removeAvatar: () => void;
  avatarError: string | null;
}

const Ctx = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [draft, setDraftState] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarDraft, setAvatarDraftState] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // True once the user has touched the field — guards the draft against being
  // clobbered by an async load mid-edit.
  const edited = useRef(false);
  const avatarEdited = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show loading while (re)reading the profile on session change
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
      // Share our own pseudo + avatar with the read-only `use-pseudos` cache so the
      // message stream / sidebar resolve self from this single load (no second fetch).
      primeProfile(session.userId, { pseudo: pseudo ?? undefined, avatar: loaded });
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
      }
      if (patch.avatar !== undefined) {
        setAvatar(patch.avatar);
        setAvatarDraftState(patch.avatar);
        avatarEdited.current = false;
      }
    } finally {
      setSaving(false);
    }
  }, [session, draft, name, avatarDraft, avatar]);

  const profile = useMemo<ProfileView | null>(
    () =>
      session
        ? {
            name,
            handle: `@${name}`,
            fingerprint: session.fingerprint,
            userId: session.userId,
            avatar: avatar ?? undefined,
          }
        : null,
    [session, name, avatar],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      loading,
      saving,
      draft,
      setDraft,
      dirty,
      save,
      avatarDraft,
      pickAvatar,
      removeAvatar,
      avatarError,
    }),
    [profile, loading, saving, draft, setDraft, dirty, save, avatarDraft, pickAvatar, removeAvatar, avatarError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The current identity's editable profile (name + avatar) + derived security info. */
export function useProfile(): ProfileContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProfile must be used within ProfileProvider');
  return v;
}
