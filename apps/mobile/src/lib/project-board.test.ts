import { describe, expect, it } from 'vitest';

import { foldProject, orderForInsert, type BoardTask, type ProjectEvent, type ProjectLogItem } from './project-board';

/** Build a log item; `ts`/`eventId` default to a deterministic sequence so tests
 *  read as an ordered story unless they deliberately set them. */
let seq = 0;
function item(event: ProjectEvent, ts = ++seq, eventId = `e${seq}`): ProjectLogItem {
  return { ts, eventId, event };
}
const col = (columnId: string, title: string, order: number): ProjectEvent => ({ t: 'column.create', e: { columnId, title, order } });
const task = (taskId: string, columnId: string, title: string, order: number): ProjectEvent => ({
  t: 'task.create',
  e: { taskId, columnId, title, order },
});

describe('foldProject', () => {
  it('empty log → empty board', () => {
    expect(foldProject([])).toEqual({ columns: [], tasksByColumn: {}, done: 0, total: 0 });
  });

  it('folds columns + tasks into a board', () => {
    const board = foldProject([item(col('c1', 'Todo', 0)), item(task('t1', 'c1', 'Write tests', 0))]);
    expect(board.columns).toEqual([{ id: 'c1', title: 'Todo', order: 0 }]);
    expect(board.tasksByColumn.c1).toEqual([{ id: 't1', columnId: 'c1', title: 'Write tests', order: 0 }]);
    expect(board.total).toBe(1);
    expect(board.done).toBe(0);
  });

  it('is order-independent — any interleaving yields the identical board', () => {
    const events = [
      item(col('c1', 'Todo', 0), 10, 'a'),
      item(col('c2', 'Done', 1), 11, 'b'),
      item(task('t1', 'c1', 'A', 0), 12, 'c'),
      item(task('t2', 'c1', 'B', 1), 13, 'd'),
      item({ t: 'task.move', e: { taskId: 't1', columnId: 'c2', order: 0 } }, 14, 'e'),
      item({ t: 'status.change', e: { taskId: 't1', to: 'done' } }, 15, 'f'),
    ];
    const forward = foldProject(events);
    const shuffled = foldProject([events[3], events[0], events[5], events[1], events[4], events[2]]);
    expect(shuffled).toEqual(forward);
  });

  it('last-write-wins per field by (ts, eventId)', () => {
    const board = foldProject([
      item(col('c1', 'Old', 0), 1, 'a'),
      item({ t: 'column.update', e: { columnId: 'c1', title: 'New' } }, 3, 'c'),
      item({ t: 'column.update', e: { columnId: 'c1', title: 'Middle' } }, 2, 'b'),
    ]);
    expect(board.columns[0]!.title).toBe('New');
  });

  it('breaks equal-ts ties deterministically by eventId', () => {
    const a = foldProject([
      item({ t: 'column.update', e: { columnId: 'c1', title: 'zzz' } }, 5, 'z'),
      item({ t: 'column.update', e: { columnId: 'c1', title: 'aaa' } }, 5, 'a'),
    ]);
    // 'z' > 'a' so the 'z' event sorts last and wins
    expect(a.columns[0]!.title).toBe('zzz');
  });

  it('first column.create wins identity; a later update relabels/reorders', () => {
    const board = foldProject([
      item(col('c1', 'First', 0), 1, 'a'),
      item(col('c1', 'Duplicate', 9), 2, 'b'),
      item({ t: 'column.update', e: { columnId: 'c1', order: 5 } }, 3, 'c'),
    ]);
    expect(board.columns).toEqual([{ id: 'c1', title: 'First', order: 5 }]);
  });

  it('column.update on a missing column creates a placeholder', () => {
    const board = foldProject([item({ t: 'column.update', e: { columnId: 'ghost', title: 'Recovered' } })]);
    expect(board.columns).toEqual([{ id: 'ghost', title: 'Recovered', order: 0 }]);
  });

  it('status.change to done increments the done count; flipping back decrements', () => {
    const base = [item(col('c1', 'Todo', 0)), item(task('t1', 'c1', 'A', 0))];
    expect(foldProject([...base, item({ t: 'status.change', e: { taskId: 't1', to: 'done' } })]).done).toBe(1);
    expect(
      foldProject([
        ...base,
        item({ t: 'status.change', e: { taskId: 't1', to: 'done' } }, 100, 'x'),
        item({ t: 'status.change', e: { taskId: 't1', to: 'todo' } }, 101, 'y'),
      ]).done,
    ).toBe(0);
  });

  it('task.delete drops the task and reduces total', () => {
    const board = foldProject([
      item(col('c1', 'Todo', 0)),
      item(task('t1', 'c1', 'A', 0)),
      item(task('t2', 'c1', 'B', 1)),
      item({ t: 'task.delete', e: { taskId: 't1' } }),
    ]);
    expect(board.total).toBe(1);
    expect(board.tasksByColumn.c1).toEqual([{ id: 't2', columnId: 'c1', title: 'B', order: 1 }]);
  });

  it('task.move relocates a task to another column', () => {
    const board = foldProject([
      item(col('c1', 'Todo', 0)),
      item(col('c2', 'Done', 1)),
      item(task('t1', 'c1', 'A', 0)),
      item({ t: 'task.move', e: { taskId: 't1', columnId: 'c2', order: 0 } }),
    ]);
    expect(board.tasksByColumn.c1).toEqual([]);
    expect(board.tasksByColumn.c2).toEqual([{ id: 't1', columnId: 'c2', title: 'A', order: 0 }]);
  });

  it('keeps a task whose column never existed under its (stale) columnId — never silently lost', () => {
    const board = foldProject([item(task('t1', 'gone', 'Orphan', 0))]);
    expect(board.total).toBe(1);
    expect(board.tasksByColumn.gone).toEqual([{ id: 't1', columnId: 'gone', title: 'Orphan', order: 0 }]);
    expect(board.columns).toEqual([]);
  });

  it('ignores update/move/status on a task that was never created', () => {
    const board = foldProject([
      item(col('c1', 'Todo', 0)),
      item({ t: 'task.update', e: { taskId: 'nope', title: 'X' } }),
      item({ t: 'task.move', e: { taskId: 'nope', columnId: 'c1', order: 0 } }),
      item({ t: 'status.change', e: { taskId: 'nope', to: 'done' } }),
    ]);
    expect(board.total).toBe(0);
    expect(board.done).toBe(0);
  });

  it('task.update merges only the provided fields (LWW), leaving others intact', () => {
    const board = foldProject([
      item(col('c1', 'Todo', 0)),
      item(task('t1', 'c1', 'A', 0)),
      item({ t: 'task.update', e: { taskId: 't1', assignees: ['paul'], tag: 'urgent' } }),
      item({ t: 'task.update', e: { taskId: 't1', title: 'A renamed' } }),
    ]);
    expect(board.tasksByColumn.c1![0]).toEqual({ id: 't1', columnId: 'c1', title: 'A renamed', order: 0, assignees: ['paul'], tag: 'urgent' });
  });

  it('sorts columns and tasks by (order, id)', () => {
    const board = foldProject([
      item(col('cB', 'B', 1)),
      item(col('cA', 'A', 0)),
      item(task('t2', 'cA', 'second', 1)),
      item(task('t1', 'cA', 'first', 0)),
      item(task('tB1', 'cA', 'tie-b', 0)),
    ]);
    expect(board.columns.map((c) => c.id)).toEqual(['cA', 'cB']);
    // order 0 tie between t1 and tB1 → broken by id ('t1' < 'tB1')
    expect(board.tasksByColumn.cA!.map((t) => t.id)).toEqual(['t1', 'tB1', 't2']);
  });
});

describe('orderForInsert (drag-drop reorder → task.move order)', () => {
  const t = (id: string, order: number): BoardTask => ({ id, columnId: 'c', title: id, order });
  // A column with three cards at integer orders 0,1,2.
  const list = [t('a', 0), t('b', 1), t('c', 2)];

  it('drop at the end → maxOrder + 1', () => {
    // dragging a card FROM ANOTHER column (not in `list`); index = list length.
    expect(orderForInsert(list, 3, 'x')).toBe(3);
  });

  it('drop at the front → firstOrder - 1', () => {
    expect(orderForInsert(list, 0, 'x')).toBe(-1);
  });

  it('drop between two cards → their midpoint', () => {
    expect(orderForInsert(list, 1, 'x')).toBe(0.5); // between a(0) and b(1)
    expect(orderForInsert(list, 2, 'x')).toBe(1.5); // between b(1) and c(2)
  });

  it('empty column → 0', () => {
    expect(orderForInsert([], 0, 'x')).toBe(0);
  });

  it('normalizes the dragged card OWN slot (same-column move down)', () => {
    // moving 'a' (index 0) down to rendered index 2: with 'a' removed the neighbors are
    // b(1) and c(2) → midpoint 1.5, so 'a' lands between them.
    expect(orderForInsert(list, 2, 'a')).toBe(1.5);
  });

  it('normalizes the dragged card OWN slot (same-column move up)', () => {
    // moving 'c' (index 2) up to rendered index 0: neighbors none/a(0) → a.order - 1.
    expect(orderForInsert(list, 0, 'c')).toBe(-1);
  });
});
