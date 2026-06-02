/**
 * Project board — pure, order-independent fold of a project's append-only event log.
 *
 * A `project` Object is an append-only log (`objects/logs/{id}`); a status change is a
 * new event, a task create/update is a new event. The board (columns + tasks) is
 * NEVER stored — it is FOLDED from the log here. Because the log is `by_timestamp`,
 * concurrent events interleave, so the fold MUST be order-independent: events are
 * sorted by `(ts, eventId)` and reduced last-write-wins per field. Tasks are virtual
 * children of the project (an `ObjectType` at the presentation layer) — they live ONLY
 * in this fold, never in the shared object index (no dual source of truth).
 *
 * Pure (no React, no I/O) — the twin of `starfish/objects.ts`. `use-project.ts` feeds
 * it the decrypted `AppendElement`s an `AppendLogCursor` yields.
 */
import type { ID } from './types';

export type ProjectEvent =
  | { t: 'column.create'; e: { columnId: ID; title: string; order: number } }
  | { t: 'column.update'; e: { columnId: ID; title?: string; order?: number } }
  | { t: 'task.create'; e: { taskId: ID; columnId: ID; title: string; order: number } }
  | { t: 'task.update'; e: { taskId: ID; title?: string; assignees?: string[]; tag?: string; order?: number } }
  | { t: 'task.move'; e: { taskId: ID; columnId: ID; order: number } }
  | { t: 'status.change'; e: { taskId: ID; from?: string; to: string } }
  | { t: 'task.delete'; e: { taskId: ID } };

/** One appended log element as the cursor yields it: a server-stamped `ts`, a stable
 *  `eventId` (the secondary sort key for determinism) and the {@link ProjectEvent}. */
export interface ProjectLogItem {
  ts: number;
  eventId: ID;
  event: ProjectEvent;
}

export interface BoardColumn {
  id: ID;
  title: string;
  order: number;
}

export interface BoardTask {
  id: ID;
  columnId: ID;
  title: string;
  order: number;
  status?: string;
  assignees?: string[];
  tag?: string;
}

export interface Board {
  columns: BoardColumn[];
  /** Tasks grouped by column, each sorted by `(order, id)`. */
  tasksByColumn: Record<ID, BoardTask[]>;
  done: number;
  total: number;
}

/** Deterministic event order: by `ts`, ties broken by `eventId`. */
function compareItems(a: ProjectLogItem, b: ProjectLogItem): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

const STATUS_DONE = 'done';

/**
 * Fold log items into a {@link Board}. Order-independent: items are sorted by
 * `(ts, eventId)` before reduction, so two devices that pulled the log in different
 * interleavings materialize the identical board. Last-write-wins per field; a deleted
 * task is dropped; a task in a missing column is kept under its (possibly stale)
 * columnId so it's never silently lost.
 */
export function foldProject(items: ProjectLogItem[]): Board {
  const sorted = items.slice().sort(compareItems);
  const columns = new Map<ID, BoardColumn>();
  const tasks = new Map<ID, BoardTask>();

  for (const { event } of sorted) {
    switch (event.t) {
      case 'column.create': {
        // First create wins identity; a later column.update can still relabel/reorder.
        if (!columns.has(event.e.columnId)) {
          columns.set(event.e.columnId, { id: event.e.columnId, title: event.e.title, order: event.e.order });
        }
        break;
      }
      case 'column.update': {
        const cur = columns.get(event.e.columnId) ?? { id: event.e.columnId, title: '', order: 0 };
        columns.set(event.e.columnId, {
          id: cur.id,
          title: event.e.title ?? cur.title,
          order: event.e.order ?? cur.order,
        });
        break;
      }
      case 'task.create': {
        if (!tasks.has(event.e.taskId)) {
          tasks.set(event.e.taskId, { id: event.e.taskId, columnId: event.e.columnId, title: event.e.title, order: event.e.order });
        }
        break;
      }
      case 'task.update': {
        const cur = tasks.get(event.e.taskId);
        if (!cur) break;
        tasks.set(event.e.taskId, {
          ...cur,
          title: event.e.title ?? cur.title,
          assignees: event.e.assignees ?? cur.assignees,
          tag: event.e.tag ?? cur.tag,
          order: event.e.order ?? cur.order,
        });
        break;
      }
      case 'task.move': {
        const cur = tasks.get(event.e.taskId);
        if (!cur) break;
        tasks.set(event.e.taskId, { ...cur, columnId: event.e.columnId, order: event.e.order });
        break;
      }
      case 'status.change': {
        const cur = tasks.get(event.e.taskId);
        if (!cur) break;
        tasks.set(event.e.taskId, { ...cur, status: event.e.to });
        break;
      }
      case 'task.delete': {
        tasks.delete(event.e.taskId);
        break;
      }
    }
  }

  const cols = [...columns.values()].sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));
  const tasksByColumn: Record<ID, BoardTask[]> = {};
  for (const col of cols) tasksByColumn[col.id] = [];
  let done = 0;
  for (const task of tasks.values()) {
    (tasksByColumn[task.columnId] ??= []).push(task);
    if (task.status === STATUS_DONE) done++;
  }
  for (const id of Object.keys(tasksByColumn)) {
    tasksByColumn[id]!.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));
  }
  return { columns: cols, tasksByColumn, done, total: tasks.size };
}
