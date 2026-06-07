import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppendLogCursor } from '@drakkar.software/starfish-client';
import type { AppendElement } from '@drakkar.software/starfish-client';

import { kvGet, kvSet } from './starfish/kv';
import { reportReachability } from './connectivity';
import { isPublicSpaceId, publicSpaceAuth } from '@drakkar.software/octochat-sdk';
import { objLogPull, objLogPush, pubObjLogPull, pubObjLogPush } from '@drakkar.software/octochat-sdk';
import { foldProject, type Board, type ProjectEvent, type ProjectLogItem } from '@drakkar.software/octochat-sdk';
import type { ID } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';
import { useRoomOpen } from './use-room-open-flow';
import { useRoomLiveSync } from './use-room-live-sync';
import { randomId } from '@drakkar.software/octochat-sdk';

export interface ProjectHook {
  board: Board;
  opening: boolean;
  openError: string | null;
  offline: boolean;
  ready: boolean;
  reload: () => void;
  /** Append a raw event (status change = new event, task create/update = event). */
  appendEvent: (event: ProjectEvent) => Promise<void>;
  addColumn: (title: string) => void;
  /** Append a `task.create`; returns the new task's id (so the caller can open it). */
  addTask: (columnId: ID, title: string) => ID;
  moveTask: (taskId: ID, columnId: ID, order: number) => void;
  changeStatus: (taskId: ID, to: string, from?: string) => void;
  renameTask: (taskId: ID, title: string) => void;
  setTaskContent: (taskId: ID, content: string) => void;
  deleteTask: (taskId: ID) => void;
  renameColumn: (columnId: ID, title: string) => void;
}

const projectLogKey = (objectId: string) => `octochat.projectlog.v1.${objectId}`;

async function loadLog(objectId: string): Promise<AppendElement[]> {
  const raw = await kvGet(projectLogKey(objectId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppendElement[]) : [];
  } catch {
    return [];
  }
}

/** Turn the cursor's decrypted append elements into the fold's input items. Each
 *  element's `data` is the {@link ProjectEvent} envelope `{ eventId, event }`; the
 *  server-stamped `ts` is the authoritative order key. */
function toItems(elements: AppendElement[]): ProjectLogItem[] {
  const items: ProjectLogItem[] = [];
  for (const el of elements) {
    const env = el.data as unknown as { eventId?: ID; event?: ProjectEvent };
    if (!env?.event) continue;
    items.push({ ts: el.ts, eventId: env.eventId ?? `${el.ts}`, event: env.event });
  }
  return items;
}

/** A `project` Object: an append-only event log folded into a {@link Board}. Mirrors
 *  {@link useStreamRoom}'s {@link AppendLogCursor} machinery (warm-start KV, incremental
 *  pull, skip policy) but folds project events instead of fanning chat envelopes. Status
 *  changes + task edits are appended; the board is never stored. */
export function useProject(spaceId: string, objectId: string, opts: { enabled?: boolean } = {}): ProjectHook {
  const enabled = (opts.enabled ?? true) && !!spaceId && !!objectId;
  const { session } = useSession();
  const isPublic = isPublicSpaceId(spaceId);

  const { encryptor, client, opening, openError, offline, reload } = useRoomOpen({
    roomId: objectId,
    spaceId,
    isPublic,
    enabled,
    initializeRoom: false,
  });

  const [items, setItems] = useState<ProjectLogItem[]>([]);
  const cursorRef = useRef<{ id: string; cursor: AppendLogCursor } | null>(null);

  const route = useMemo(() => {
    if (!session) return null;
    if (isPublic) {
      const auth = publicSpaceAuth(session, spaceId);
      return { pull: pubObjLogPull(auth.ownerId, spaceId, objectId), push: pubObjLogPush(auth.ownerId, spaceId, objectId), canWrite: auth.write };
    }
    return { pull: objLogPull(spaceId, objectId), push: objLogPush(spaceId, objectId), canWrite: true };
  }, [session, isPublic, spaceId, objectId]);

  const pull = useCallback(async () => {
    const cur = cursorRef.current;
    if (!cur || cur.id !== objectId) return;
    try {
      const batch = await cur.cursor.pull();
      if (batch.length) {
        setItems((prev) => [...prev, ...toItems(batch)]);
        void kvSet(projectLogKey(objectId), JSON.stringify(cur.cursor.getItems()));
      }
      reportReachability(true);
    } catch {
      reportReachability(false);
    }
  }, [objectId]);

  useEffect(() => {
    if (!enabled || !client || !route) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset folded items on object/client change
    setItems([]);
    (async () => {
      const initialItems = await loadLog(objectId);
      if (cancelled) return;
      const cursor = new AppendLogCursor({
        client,
        pullPath: route.pull,
        appendField: 'items',
        ...(encryptor ? { encryptor } : {}),
        onElementError: 'skip',
        initialItems,
      });
      cursorRef.current = { id: objectId, cursor };
      if (initialItems.length) {
        const history = await cursor.getDecryptedItems();
        if (cancelled) return;
        setItems(toItems(history));
      }
      if (cancelled) return;
      void pull();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, client, encryptor, route, objectId, pull]);

  const appendEvent = useCallback(
    async (event: ProjectEvent) => {
      if (!client || !route) return;
      const env = { eventId: `evt-${randomId()}`, event };
      const body = encryptor
        ? ((await (encryptor as unknown as { encrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>> }).encrypt(
            env as unknown as Record<string, unknown>,
          )) as Record<string, unknown>)
        : (env as unknown as Record<string, unknown>);
      await client.append(route.push, body);
      void pull();
    },
    [client, route, encryptor, pull],
  );

  useRoomLiveSync({
    roomId: objectId,
    ready: !!client,
    pull: () => void pull(),
  });

  const board = useMemo(() => foldProject(items), [items]);

  const addColumn = useCallback(
    (title: string) => void appendEvent({ t: 'column.create', e: { columnId: `col-${randomId()}`, title, order: board.columns.length } }),
    [appendEvent, board.columns.length],
  );
  const addTask = useCallback(
    (columnId: ID, title: string): ID => {
      const taskId = `tsk-${randomId()}`;
      void appendEvent({ t: 'task.create', e: { taskId, columnId, title, order: board.tasksByColumn[columnId]?.length ?? 0 } });
      return taskId;
    },
    [appendEvent, board.tasksByColumn],
  );
  const moveTask = useCallback((taskId: ID, columnId: ID, order: number) => void appendEvent({ t: 'task.move', e: { taskId, columnId, order } }), [appendEvent]);
  const changeStatus = useCallback((taskId: ID, to: string, from?: string) => void appendEvent({ t: 'status.change', e: { taskId, to, ...(from ? { from } : {}) } }), [appendEvent]);
  const renameTask = useCallback((taskId: ID, title: string) => void appendEvent({ t: 'task.update', e: { taskId, title } }), [appendEvent]);
  const setTaskContent = useCallback((taskId: ID, content: string) => void appendEvent({ t: 'task.update', e: { taskId, content } }), [appendEvent]);
  const deleteTask = useCallback((taskId: ID) => void appendEvent({ t: 'task.delete', e: { taskId } }), [appendEvent]);
  const renameColumn = useCallback((columnId: ID, title: string) => void appendEvent({ t: 'column.update', e: { columnId, title } }), [appendEvent]);

  return {
    board,
    opening: enabled ? opening : false,
    openError,
    offline,
    ready: !!client && !!route,
    reload,
    appendEvent,
    addColumn,
    addTask,
    moveTask,
    changeStatus,
    renameTask,
    setTaskContent,
    deleteTask,
    renameColumn,
  };
}
