/**
 * Workspace **view mode** — a Notion-style switch at the head of the room
 * sidebar that swaps what the sidebar lists without leaving the open room:
 *
 *  - `chat`   — rooms, threads & pins (the original, only sidebar before this).
 *  - `agents` — the space's automations (the `kind: 'automated'` rooms).
 *  - `work`   — docs / projects / knowledge (placeholder surface for now).
 *
 * The choice is a single global UI preference (not per-space): it persists
 * through the cross-platform `kv` layer (localStorage on web, AsyncStorage on
 * native) so the workspace reopens in the mode you left it. Content stays
 * space-contextual — Agents always lists the *active* space's automations.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { IconName } from '@/components/ui/Icon';

import { kvGet, kvSet } from './starfish/kv';

export type ViewMode = 'chat' | 'agents' | 'work';

/** Switcher metadata, in display order. The first is the default. */
export const VIEW_MODES: { key: ViewMode; label: string; iconName: IconName }[] = [
  { key: 'chat', label: 'Chat', iconName: 'chat' },
  { key: 'agents', label: 'Agents', iconName: 'agents' },
  { key: 'work', label: 'Work', iconName: 'work' },
];

const STORAGE_KEY = 'octochat.view-mode.v1';
const isViewMode = (v: unknown): v is ViewMode => v === 'chat' || v === 'agents' || v === 'work';
// 'docs' / 'projects' were briefly split out of 'work'; fold old saves back to 'work'.
const normalize = (v: unknown): ViewMode | null =>
  v === 'docs' || v === 'projects' ? 'work' : isViewMode(v) ? v : null;

interface ViewModeContextValue {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ViewMode>('chat');
  // Gate the persist effect until the stored value is loaded, so the default
  // 'chat' never clobbers a saved mode on first mount (mirrors useCategoryCollapse).
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void kvGet(STORAGE_KEY).then((stored) => {
      if (cancelled) return;
      hydrated.current = true;
      const restored = normalize(stored);
      if (restored) setModeState(restored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ViewMode) => {
    setModeState(next);
    hydrated.current = true;
    void kvSet(STORAGE_KEY, next);
  }, []);

  return <ViewModeContext.Provider value={{ mode, setMode }}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error('useViewMode must be used within a ViewModeProvider');
  return ctx;
}
