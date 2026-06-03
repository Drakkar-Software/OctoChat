import { Fragment, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { layout, motion, opacity, paperBorder, radii, shadows, spacing } from '@/theme';
import { useInlineEdit } from '@/lib/use-inline-edit';
import { useProject } from '@/lib/use-project';
import { orderForInsert, type BoardColumn as BoardCol, type BoardTask } from '@/lib/project-board';
import { useColumnDrop, useDraggableTask } from '@/lib/use-board-dnd';
import { useRevealActions } from '@/lib/use-reveal-actions';
import { useTheme } from '@/lib/use-theme';
import { AutosaveField } from '@/components/ui/AutosaveField';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';
import { ObjectHero } from '@/components/work/ObjectHero';

const STATUS_DONE = 'done';

interface ColumnHandlers {
  ready: boolean;
  edit: ReturnType<typeof useInlineEdit>;
  onChangeStatus: (taskId: string, to: string, from?: string) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAddTask: (columnId: string) => void;
  onRenameColumn: (columnId: string, title: string) => void;
  /** Drop a dragged task into this column at the resolved index (web DnD). */
  onDropTask: (columnId: string, taskId: string, index: number) => void;
}

/**
 * Live kanban board for one `project` Object — columns + cards folded from the
 * append-only event log. Add/toggle/rename/delete/move each append a NEW event (the log
 * is never mutated); the board re-folds on the next pull. On web, cards drag to reorder
 * within a column and across columns (a `task.move` event); the drag math lives in
 * {@link useColumnDrop} + the pure {@link orderForInsert}. Title edits reuse the shared
 * inline editor; edit-which-cell state lives in {@link useInlineEdit}.
 */
export function ProjectBoard({ spaceId, objectId, emoji, title }: { spaceId: string; objectId: string; emoji?: string; title?: string }) {
  const { colors } = useTheme();
  const { board, ready, offline, addColumn, addTask, changeStatus, renameTask, deleteTask, renameColumn, moveTask } = useProject(spaceId, objectId);
  const edit = useInlineEdit();

  // Resolve a drop into a single task.move: normalize the dragged card's own slot, skip
  // a drop that lands back where it started (no spurious event), else midpoint-reorder.
  const onDropTask = (columnId: string, taskId: string, index: number) => {
    const colTasks = board.tasksByColumn[columnId] ?? [];
    let from: BoardTask | undefined;
    for (const c of board.columns) {
      const hit = board.tasksByColumn[c.id]?.find((t) => t.id === taskId);
      if (hit) {
        from = hit;
        break;
      }
    }
    if (!from) return;
    if (from.columnId === columnId) {
      const curPos = colTasks.findIndex((t) => t.id === taskId);
      const target = curPos < index ? index - 1 : index;
      if (target === curPos) return; // dropped into its own slot
    }
    moveTask(taskId, columnId, orderForInsert(colTasks, index, taskId));
  };

  const handlers: ColumnHandlers = {
    ready,
    edit,
    onChangeStatus: changeStatus,
    onRenameTask: (taskId, t) => renameTask(taskId, t),
    onDeleteTask: deleteTask,
    onAddTask: (columnId) => addTask(columnId, 'New task'),
    onRenameColumn: (columnId, t) => renameColumn(columnId, t),
    onDropTask,
  };

  return (
    <View style={styles.wrap}>
      <ObjectHero
        emoji={emoji}
        title={title}
        subtitle={`${board.done}/${board.total} done`}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add column"
            disabled={!ready}
            onPress={() => addColumn('New column')}
            style={[styles.add, { borderColor: colors.lineFaint, opacity: ready ? 1 : opacity.disabled }]}
          >
            <Icon name="plus" size={12} color={colors.inkMuted} />
            <Txt variant="caption" tone="inkMuted">Column</Txt>
          </Pressable>
        }
      />

      {offline ? (
        <Callout tone="info" iconName="info">Offline — showing the last synced board.</Callout>
      ) : null}

      {board.columns.length === 0 ? (
        <Callout tone="info" iconName="info">No columns yet. Add one to start the board.</Callout>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.columns}>
          {board.columns.map((col) => (
            <BoardColumn key={col.id} col={col} tasks={board.tasksByColumn[col.id] ?? []} handlers={handlers} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** One column: a collapsible-free list of cards that doubles as a drop zone. The insert
 *  line marks where a dragged card would land (web); columns reorder by appending a
 *  single `task.move`. */
function BoardColumn({ col, tasks, handlers }: { col: BoardCol; tasks: BoardTask[]; handlers: ColumnHandlers }) {
  const { colors } = useTheme();
  const { ready, edit } = handlers;
  const { ref: dropRef, overIndex } = useColumnDrop((taskId, index) => handlers.onDropTask(col.id, taskId, index));

  return (
    <View ref={dropRef} style={[styles.column, paperBorder(colors), shadows.sm]}>
      <View style={styles.colHead}>
        {edit.isEditing(col.id) ? (
          <View style={styles.colEdit}>
            <AutosaveField
              initialText={col.title}
              onCommit={(t) => handlers.onRenameColumn(col.id, t.trim())}
              onClose={() => {
                if (edit.isEditing(col.id)) edit.close();
              }}
              debounceMs={motion.autosaveLog}
              accessibilityLabel={`Rename column ${col.title}`}
            />
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Rename column ${col.title}`}
              onPress={() => edit.begin(col.id)}
              style={styles.colTitle}
            >
              <Txt variant="caption" weight="bold" tone="inkMuted" numberOfLines={1}>
                {col.title.toUpperCase()}
              </Txt>
            </Pressable>
            <Txt variant="micro" mono tone="inkFaint">{tasks.length}</Txt>
          </>
        )}
      </View>

      {tasks.map((task, i) => (
        <Fragment key={task.id}>
          {overIndex === i ? <InsertLine /> : null}
          <DraggableTaskCard taskId={task.id} draggable={!edit.isEditing(task.id)}>
            {edit.isEditing(task.id) ? (
              <View style={[styles.card, { backgroundColor: colors.fill, borderColor: colors.lineFaint }]}>
                <AutosaveField
                  initialText={task.title}
                  onCommit={(t) => handlers.onRenameTask(task.id, t.trim())}
                  onClose={() => {
                    if (edit.isEditing(task.id)) edit.close();
                  }}
                  debounceMs={motion.autosaveLog}
                  accessibilityLabel={`Rename ${task.title}`}
                />
              </View>
            ) : (
              <TaskCard
                title={task.title}
                done={task.status === STATUS_DONE}
                onToggle={() => handlers.onChangeStatus(task.id, task.status === STATUS_DONE ? 'todo' : STATUS_DONE, task.status)}
                onEdit={() => edit.begin(task.id)}
                onDelete={() => handlers.onDeleteTask(task.id)}
              />
            )}
          </DraggableTaskCard>
        </Fragment>
      ))}
      {overIndex === tasks.length ? <InsertLine /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add task"
        disabled={!ready}
        onPress={() => handlers.onAddTask(col.id)}
        style={[styles.addCard, { borderColor: colors.lineFaint, opacity: ready ? 1 : opacity.disabled }]}
      >
        <Icon name="plus" size={12} color={colors.inkFaint} />
        <Txt variant="caption" tone="inkFaint">Add card</Txt>
      </Pressable>
    </View>
  );
}

/** Wraps a card so its DOM node is the drag handle (web); inert on native. Disabled
 *  while the card is being edited so text selection isn't hijacked. */
function DraggableTaskCard({ taskId, draggable, children }: { taskId: string; draggable: boolean; children: ReactNode }) {
  const ref = useDraggableTask(taskId, draggable);
  return <View ref={ref}>{children}</View>;
}

/** The drop position indicator — a thin accent rule drawn in the gap a dragged card
 *  would land in. */
function InsertLine() {
  const { colors } = useTheme();
  return <View style={[styles.insert, { backgroundColor: colors.accent }]} />;
}

/** One kanban card: tap the glyph to toggle done, the title to rename; a delete
 *  affordance reveals on hover (web) or long-press (native) via {@link useRevealActions}. */
function TaskCard({ title, done, onToggle, onEdit, onDelete }: { title: string; done: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const { colors } = useTheme();
  const { revealed, rowProps, onLongPress, hide } = useRevealActions();
  return (
    <View {...rowProps} style={[styles.card, { backgroundColor: colors.fill, borderColor: colors.lineFaint }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={done ? 'Mark not done' : 'Mark done'} onPress={onToggle} hitSlop={6}>
        <Icon name={done ? 'check' : 'target'} size={13} color={done ? colors.success : colors.inkFaint} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${title}`} onPress={onEdit} onLongPress={onLongPress} style={styles.cardText}>
        <Txt variant="subhead" numberOfLines={2} style={done ? styles.cardDone : undefined}>
          {title}
        </Txt>
      </Pressable>
      {revealed ? (
        <IconButton
          name="trash"
          size={14}
          color={colors.inkMuted}
          onPress={() => {
            hide();
            onDelete();
          }}
          accessibilityLabel="Delete task"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  add: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.xs, borderWidth: 1 },
  columns: { gap: spacing.sm, paddingBottom: spacing.sm },
  column: { width: layout.boardColumnWidth, borderRadius: radii.card, borderWidth: 1, padding: spacing.sm, gap: spacing.xs },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: 2, paddingBottom: spacing.xs },
  colTitle: { flex: 1 },
  colEdit: { flex: 1 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1 },
  cardText: { flex: 1 },
  cardDone: { textDecorationLine: 'line-through', opacity: opacity.muted },
  addCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, borderRadius: radii.md, borderWidth: 1, borderStyle: 'dashed' },
  insert: { height: 2, borderRadius: radii.xs, marginVertical: 1 },
});
