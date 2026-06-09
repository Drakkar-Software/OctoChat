/**
 * Device-global model availability + download state. Owned by AiSettingsCard —
 * NOT persisted and NOT root-mounted. Web stub returns 'unsupported' immediately.
 *
 * The id of the active downloaded model IS persisted (via useAiSettings) so the
 * model survives restarts and inference can lazily load it on first use. We never
 * load the model into memory here: that multi-GB spike, done right after a fresh
 * download, is what OOM-killed the app on iOS — see ensure-model-loaded.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAiSettings } from '@/lib/ai-settings-context';

import {
  aiCancelDownload,
  aiDeleteModel,
  aiDownloadModel,
  aiGetBuiltInModels,
  aiGetDownloadableModels,
  aiGetRecommendedModel,
  aiIsAvailable,
  aiUnloadModel,
} from './ai-engine';
import type { DownloadableModel } from './ai-engine';

export type ModelStatusKind =
  | 'checking'
  | 'unsupported'
  | 'available-built-in'
  | 'needs-download'
  | 'downloading'
  | 'ready';

export interface ModelStatus {
  kind: ModelStatusKind;
  model: DownloadableModel | null;
  progress: number;
  download: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
}

export function useAiModelStatus(): ModelStatus {
  const { settings, update } = useAiSettings();
  const [kind, setKind] = useState<ModelStatusKind>('checking');
  const [model, setModel] = useState<DownloadableModel | null>(null);
  const [progress, setProgress] = useState(0);
  const modelIdRef = useRef<string | null>(null);

  // Keep the latest persisted id reachable from async callbacks without making
  // them depend on (and re-run for) settings changes.
  const activeModelIdRef = useRef(settings.activeModelId);
  activeModelIdRef.current = settings.activeModelId;

  useEffect(() => {
    let active = true;
    void (async () => {
      const available = await aiIsAvailable();
      if (!active) return;

      if (!available) {
        setKind('unsupported');
        return;
      }

      // Check for a platform built-in (Apple FM / ML Kit) — zero download needed.
      const builtIns = await aiGetBuiltInModels();
      if (!active) return;
      if (builtIns.some((m) => m.available)) {
        setKind('available-built-in');
        return;
      }

      // Fall back to downloadable Gemma models.
      const downloadable = await aiGetDownloadableModels();
      if (!active) return;
      const recommended = await aiGetRecommendedModel();
      if (!active) return;

      const candidate = recommended ?? downloadable.find((m) => m.meetsRequirements) ?? null;
      setModel(candidate);

      const onDisk = candidate?.status === 'ready' || candidate?.status === 'downloaded';
      if (onDisk) {
        setKind('ready');
        modelIdRef.current = candidate.id;
        // Reconcile the durable pointer with the on-disk truth: record the model
        // so inference loads it lazily (also self-heals installs downloaded before
        // this pointer existed). The load itself is deferred to first inference.
        if (activeModelIdRef.current !== candidate.id) update({ activeModelId: candidate.id });
      } else {
        setKind('needs-download');
        // The recorded model is gone from disk — drop the stale pointer so we
        // don't try to load a missing file (and so inference falls back cleanly).
        if (activeModelIdRef.current && activeModelIdRef.current === candidate?.id) {
          update({ activeModelId: null });
        }
      }
    })();
    return () => {
      active = false;
    };
    // Runs once on mount; update/settings are read via refs to avoid re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = useCallback(
    async (id: string) => {
      setKind('downloading');
      setProgress(0);
      modelIdRef.current = id;
      try {
        await aiDownloadModel(id, (p) => setProgress(p));
        // The file is now on disk (status 'downloaded', survives restarts).
        // Persist the pointer and stop here: do NOT load the model into memory.
        // That load is the largest memory spike on device and, done right after a
        // fresh download, OOM-killed the app on iOS. Inference loads it lazily at
        // a calm moment instead (ensure-model-loaded.ts).
        update({ activeModelId: id });
        setKind('ready');
        setProgress(1);
      } catch {
        setKind('needs-download');
        setProgress(0);
      }
    },
    [update],
  );

  const cancel = useCallback(async (id: string) => {
    await aiCancelDownload(id);
    setKind('needs-download');
    setProgress(0);
  }, []);

  const removeModel = useCallback(
    async (id: string) => {
      // Free memory first if this model happens to be loaded, then delete the
      // file and drop the durable pointer so inference reverts to the built-in.
      await aiUnloadModel();
      await aiDeleteModel(id);
      update({ activeModelId: null });
      setKind('needs-download');
      setProgress(0);
      modelIdRef.current = null;
    },
    [update],
  );

  return { kind, model, progress, download, cancelDownload: cancel, removeModel };
}
