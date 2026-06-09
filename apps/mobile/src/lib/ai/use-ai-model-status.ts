/**
 * Device-global model availability + download state. Owned by AiSettingsCard —
 * NOT persisted and NOT root-mounted. Web stub returns 'unsupported' immediately.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  aiCancelDownload,
  aiDeleteModel,
  aiDownloadModel,
  aiGetBuiltInModels,
  aiGetDownloadableModels,
  aiGetRecommendedModel,
  aiIsAvailable,
  aiSetModel,
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
  const [kind, setKind] = useState<ModelStatusKind>('checking');
  const [model, setModel] = useState<DownloadableModel | null>(null);
  const [progress, setProgress] = useState(0);
  const modelIdRef = useRef<string | null>(null);

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

      if (candidate?.status === 'ready' || candidate?.status === 'downloaded') {
        setKind('ready');
        modelIdRef.current = candidate.id;
      } else {
        setKind('needs-download');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const download = useCallback(async (id: string) => {
    setKind('downloading');
    setProgress(0);
    modelIdRef.current = id;
    try {
      await aiDownloadModel(id, (p) => setProgress(p));
      // Lazily load the model so the first inference is ready.
      await aiSetModel(id);
      setKind('ready');
      setProgress(1);
    } catch {
      setKind('needs-download');
      setProgress(0);
    }
  }, []);

  const cancel = useCallback(async (id: string) => {
    await aiCancelDownload(id);
    setKind('needs-download');
    setProgress(0);
  }, []);

  const removeModel = useCallback(async (id: string) => {
    await aiDeleteModel(id);
    setKind('needs-download');
    setProgress(0);
    modelIdRef.current = null;
  }, []);

  return { kind, model, progress, download, cancelDownload: cancel, removeModel };
}
