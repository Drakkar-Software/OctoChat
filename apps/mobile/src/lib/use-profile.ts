import { useCallback, useEffect, useState } from 'react';

import { readPseudo, writePseudo } from './starfish/client';
import { useSession } from './session-context';

export interface ProfileView {
  name: string;
  handle: string;
  fingerprint: string;
  userId: string;
}

/** The current identity's editable profile + derived security info. */
export function useProfile() {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const save = useCallback(
    async (newName: string) => {
      if (!session) return;
      setSaving(true);
      try {
        await writePseudo(session.accountClient, session.userId, newName.trim());
        setName(newName.trim());
      } finally {
        setSaving(false);
      }
    },
    [session],
  );

  const profile: ProfileView | null = session
    ? { name, handle: `@${name}`, fingerprint: session.fingerprint, userId: session.userId }
    : null;

  return { profile, loading, saving, save };
}
