import { useCallback, useEffect, useRef, useState } from 'react';

import { readPseudo, writePseudo } from './starfish/client';
import { useSession } from './session-context';

export interface ProfileView {
  name: string;
  handle: string;
  fingerprint: string;
  userId: string;
}

// Each useProfile() call keeps its own state, so a rename on the Profile screen
// would otherwise leave other live consumers (e.g. the desktop sidebar) showing
// the stale name until reload. This module-level fan-out lets every mounted
// instance adopt a freshly-saved name immediately.
const nameListeners = new Set<(name: string) => void>();
function broadcastName(name: string) {
  for (const fn of nameListeners) fn(name);
}

/** The current identity's editable profile + derived security info. */
export function useProfile() {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [draft, setDraftState] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // True once the user has typed — guards the draft against being clobbered by
  // an async name load or a fan-out from another instance mid-edit.
  const edited = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!session) {
      setLoading(false);
      return;
    }
    setName(session.name);
    (async () => {
      const pseudo = await readPseudo(session.userId);
      if (!cancelled && pseudo) setName(pseudo);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Adopt the loaded/saved name into the draft, unless the user is mid-edit.
  useEffect(() => {
    if (!edited.current) setDraftState(name);
  }, [name]);

  // Reflect a rename saved by any other mounted instance.
  useEffect(() => {
    const fn = (next: string) => {
      if (!edited.current) setName(next);
    };
    nameListeners.add(fn);
    return () => {
      nameListeners.delete(fn);
    };
  }, []);

  const setDraft = useCallback((v: string) => {
    edited.current = true;
    setDraftState(v);
  }, []);

  const trimmed = draft.trim();
  const dirty = trimmed.length > 0 && trimmed !== name;

  const save = useCallback(async () => {
    if (!session) return;
    const next = draft.trim();
    if (!next) return;
    setSaving(true);
    try {
      await writePseudo(session.accountClient, session.userId, next);
      setName(next);
      setDraftState(next);
      edited.current = false;
      broadcastName(next);
    } finally {
      setSaving(false);
    }
  }, [session, draft]);

  const profile: ProfileView | null = session
    ? { name, handle: `@${name}`, fingerprint: session.fingerprint, userId: session.userId }
    : null;

  return { profile, loading, saving, draft, setDraft, dirty, save };
}
