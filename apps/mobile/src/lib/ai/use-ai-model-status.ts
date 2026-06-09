/**
 * Device-global model availability + download state. Owned by AiSettingsCard —
 * NOT root-mounted. The id of the active downloaded model IS persisted (via
 * useAiSettings) so the model survives restarts and inference can lazily load it
 * on first use. We never load the model into memory here: that multi-GB spike,
 * done right after a fresh download, is what OOM-killed the app on iOS — see
 * ensure-model-loaded.ts. Web stub returns 'unsupported' immediately.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAiSettings } from '@/lib/ai-settings-context';

import {
  aiCancelDownload,
  aiDeleteModel,
  aiDownloadModel,
  aiGetBuiltInModels,
  aiGetDownloadableModels,
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
  /** Supported (runnable) models only, lightest → heaviest. The chooser list. */
  models: DownloadableModel[];
  /** The active/primary model: the one on disk, else the chosen/default one. */
  model: DownloadableModel | null;
  /** Safer default to highlight in the chooser — the lightest supported model
   *  (most memory headroom, least likely to OOM on a borderline device). */
  recommendedId: string | null;
  progress: number;
  download: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
}

const isOnDisk = (m: DownloadableModel) => m.status === 'ready' || m.status === 'downloaded';

export function useAiModelStatus(): ModelStatus {
  const { settings, update } = useAiSettings();
  const [kind, setKind] = useState<ModelStatusKind>('checking');
  const [allModels, setAllModels] = useState<DownloadableModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Keep the latest persisted id reachable from async callbacks without making
  // them depend on (and re-run for) settings changes.
  const activeModelIdRef = useRef(settings.activeModelId);
  activeModelIdRef.current = settings.activeModelId;

  useEffect(() => {
    let active = true;
    void (async () => {
      // Check for a platform built-in (Apple FM / ML Kit) — zero download needed.
      // No `aiIsAvailable()` gate here: a device WITHOUT a built-in (e.g. one that
      // can't run Apple Foundation Models) can still run a downloaded Gemma model,
      // so we fall through to the downloadable path rather than declaring it
      // unsupported up front. "Unsupported" is decided below by the runnable set.
      const builtIns = await aiGetBuiltInModels();
      if (!active) return;
      if (builtIns.some((m) => m.available)) {
        setKind('available-built-in');
        return;
      }

      // Fall back to downloadable Gemma models.
      const downloadable = await aiGetDownloadableModels();
      if (!active) return;
      setAllModels(downloadable);

      const onDisk = downloadable.find(isOnDisk);
      const runnable = downloadable.some((m) => m.meetsRequirements);
      if (onDisk) {
        setKind('ready');
        setSelectedId(onDisk.id);
        // Reconcile the durable pointer with the on-disk truth so inference loads
        // it lazily (also self-heals installs downloaded before this pointer
        // existed). The load itself is deferred to first inference.
        if (activeModelIdRef.current !== onDisk.id) update({ activeModelId: onDisk.id });
      } else if (runnable) {
        setKind('needs-download');
        // The recorded model is gone from disk — drop the stale pointer so we
        // don't try to load a missing file (and inference falls back cleanly).
        if (activeModelIdRef.current && downloadable.length > 0) update({ activeModelId: null });
      } else {
        // Nothing this device can run — the web stub (empty list) or a device
        // below every model's RAM floor. This is the old `aiIsAvailable()` gate's
        // job, now decided by the actual runnable set so a no-built-in device with
        // a runnable Gemma reaches `needs-download` above instead of stalling here.
        setKind('unsupported');
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
      setSelectedId(id);
      setKind('downloading');
      setProgress(0);
      try {
        await aiDownloadModel(id, (p) => setProgress(p));
        // The file is now on disk (status 'downloaded', survives restarts).
        // Persist the pointer and stop here: do NOT load the model into memory.
        // That load is the largest memory spike on device and, done right after a
        // fresh download, OOM-killed the app on iOS. Inference loads it lazily at
        // a calm moment instead (ensure-model-loaded.ts).
        update({ activeModelId: id });
        setAllModels(await aiGetDownloadableModels());
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
      setSelectedId(null);
      setAllModels(await aiGetDownloadableModels());
      setKind('needs-download');
      setProgress(0);
    },
    [update],
  );

  // Only the models this device can actually run, lightest first — too-big
  // models are never offered (the engine also hard-blocks them on download).
  const models = useMemo(
    () => allModels.filter((m) => m.meetsRequirements).sort((a, b) => a.sizeBytes - b.sizeBytes),
    [allModels],
  );
  // Safer default: the lightest supported model has the most memory headroom.
  const recommendedId = models[0]?.id ?? null;
  // Active/primary model: the one on disk, else the chosen/default one.
  const model = useMemo(() => {
    const onDisk = allModels.find(isOnDisk);
    if (onDisk) return onDisk;
    return allModels.find((m) => m.id === selectedId) ?? models.find((m) => m.id === recommendedId) ?? null;
  }, [allModels, models, selectedId, recommendedId]);

  return { kind, models, model, recommendedId, progress, download, cancelDownload: cancel, removeModel };
}
