import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import type { BoardTask } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';
import { AutosaveField } from '@/components/ui/AutosaveField';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

const STATUS_DONE = 'done';

interface TaskDetailSheetProps {
  /** The task being viewed, or null when the sheet is closed. */
  task: BoardTask | null;
  onRename: (taskId: string, title: string) => void;
  onSetContent: (taskId: string, content: string) => void;
  onToggleStatus: (task: BoardTask) => void;
  onDelete: (taskId: string) => void;
  onClose: () => void;
}

/**
 * Bottom-sheet detail panel for one kanban task — title + a free Markdown body
 * ("notes"), a done toggle and delete. Both fields autosave through
 * {@link AutosaveField} (no Save button), matching the seamless doc editor; the body
 * gives a task real content, not just a one-line title. Built on RN `Modal` like
 * {@link MoveToCategorySheet}. Keyed by task id by the caller so switching tasks
 * reseeds the fields.
 */
export function TaskDetailSheet({ task, onRename, onSetContent, onToggleStatus, onDelete, onClose }: TaskDetailSheetProps) {
  const { colors } = useTheme();
  const done = task?.status === STATUS_DONE;

  return (
    <Modal visible={!!task} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={onClose} accessibilityLabel="Dismiss">
        {/* Swallow inner taps so they don't fall through to the backdrop. */}
        <Pressable style={[styles.sheet, { backgroundColor: colors.paper }]} onPress={() => undefined}>
          {task ? (
            <>
              <View style={styles.head}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={done ? 'Mark not done' : 'Mark done'}
                  onPress={() => onToggleStatus(task)}
                  hitSlop={8}
                  style={styles.statusBtn}
                >
                  <Icon name={done ? 'check' : 'target'} size={16} color={done ? colors.success : colors.inkFaint} />
                  <Txt variant="micro" weight="bold" mono uppercase tone={done ? 'success' : 'inkMuted'}>
                    {done ? 'Done' : 'Open'}
                  </Txt>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}>
                  <Icon name="x" size={16} color={colors.inkMuted} />
                </Pressable>
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
                <AutosaveField
                  key={`title-${task.id}`}
                  initialText={task.title}
                  onCommit={(t) => onRename(task.id, t.trim())}
                  placeholder="Task title"
                  accessibilityLabel="Task title"
                />

                <Txt variant="micro" weight="bold" mono uppercase tone="inkFaint" style={styles.label}>
                  Notes
                </Txt>
                <AutosaveField
                  key={`content-${task.id}`}
                  initialText={task.content ?? ''}
                  onCommit={(t) => onSetContent(task.id, t)}
                  commitEmpty
                  multiline
                  minHeight={layout.taskContentMinHeight}
                  placeholder="Add details, in Markdown…"
                  accessibilityLabel="Task notes"
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete task"
                  onPress={() => {
                    onDelete(task.id);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.delete, { borderColor: colors.lineFaint }, pressed ? { backgroundColor: colors.hover } : null]}
                >
                  <Icon name="trash" size={14} color={colors.danger} />
                  <Txt variant="subhead" weight="semibold" tone="danger">
                    Delete task
                  </Txt>
                </Pressable>
              </ScrollView>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', paddingBottom: spacing.lg, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  body: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  label: { marginTop: spacing.sm },
  delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.md, borderWidth: 1 },
});
