/**
 * Owner-side "Incoming requests" configuration for one space — reads + optimistically writes
 * the per-space {@link IntakeConfig} (manual / auto-accept / auto-reply). Backed by the SDK's
 * owner-gated objowner doc; only meaningful for a space the current user owns.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  readIntakeConfig,
  writeIntakeConfig,
  DEFAULT_INTAKE_CONFIG,
  type IntakeConfig,
} from '@drakkar.software/octochat-sdk';

import { useSession } from './session-context';

export interface IntakeConfigHook {
  config: IntakeConfig;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Optimistically apply a patch and persist it; reverts on failure. */
  save: (patch: Partial<IntakeConfig>) => Promise<void>;
}

export function useIntakeConfig(spaceId: string | null): IntakeConfigHook {
  const { session } = useSession();
  const [config, setConfig] = useState<IntakeConfig>(DEFAULT_INTAKE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!session || !spaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void readIntakeConfig(session, spaceId)
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, spaceId]);

  const save = useCallback(
    async (patch: Partial<IntakeConfig>) => {
      if (!session || !spaceId) return;
      const prev = config;
      const next = { ...config, ...patch };
      setConfig(next); // optimistic
      setSaving(true);
      setError(null);
      try {
        await writeIntakeConfig(session, spaceId, next);
      } catch (e) {
        setConfig(prev); // revert on failure
        setError(String((e as Error)?.message ?? e));
      } finally {
        setSaving(false);
      }
    },
    [session, spaceId, config],
  );

  return { config, loading, saving, error, save };
}
