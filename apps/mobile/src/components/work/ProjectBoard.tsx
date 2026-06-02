import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { layout, paperBorder, radii, shadows, spacing } from '@/theme';
import { useProject } from '@/lib/use-project';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

const STATUS_DONE = 'done';

/**
 * Live kanban board for one `project` Object — columns + cards folded from the
 * append-only event log. Adding a column/task or toggling a card's done status
 * appends a NEW event (the log is never mutated); the board re-folds on the next pull.
 */
export function ProjectBoard({ spaceId, objectId, emoji, title }: { spaceId: string; objectId: string; emoji?: string; title?: string }) {
  const { colors } = useTheme();
  const { board, ready, offline, addColumn, addTask, changeStatus } = useProject(spaceId, objectId);

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        {emoji ? <Txt style={styles.emoji}>{emoji}</Txt> : null}
        <View style={styles.heroText}>
          <Txt variant="display" weight="bold">{title || 'Untitled'}</Txt>
          <Txt variant="caption" tone="inkFaint">{board.done}/{board.total} done</Txt>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add column"
          disabled={!ready}
          onPress={() => addColumn('New column')}
          style={[styles.add, { borderColor: colors.lineFaint, opacity: ready ? 1 : 0.5 }]}
        >
          <Icon name="plus" size={12} color={colors.inkMuted} />
          <Txt variant="caption" tone="inkMuted">Column</Txt>
        </Pressable>
      </View>

      {offline ? (
        <Callout tone="info" iconName="info">Offline — showing the last synced board.</Callout>
      ) : null}

      {board.columns.length === 0 ? (
        <Callout tone="info" iconName="info">No columns yet. Add one to start the board.</Callout>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.columns}>
          {board.columns.map((col) => (
            <View key={col.id} style={[styles.column, paperBorder(colors), shadows.sm]}>
              <View style={styles.colHead}>
                <Txt variant="caption" weight="bold" tone="inkMuted" numberOfLines={1} style={styles.colTitle}>
                  {col.title.toUpperCase()}
                </Txt>
                <Txt variant="micro" mono tone="inkFaint">{board.tasksByColumn[col.id]?.length ?? 0}</Txt>
              </View>
              {(board.tasksByColumn[col.id] ?? []).map((task) => {
                const done = task.status === STATUS_DONE;
                return (
                  <Pressable
                    key={task.id}
                    accessibilityRole="button"
                    accessibilityLabel={task.title}
                    onPress={() => changeStatus(task.id, done ? 'todo' : STATUS_DONE, task.status)}
                    style={[styles.card, { backgroundColor: colors.fill, borderColor: colors.lineFaint }]}
                  >
                    <Icon name={done ? 'check' : 'target'} size={13} color={done ? colors.success : colors.inkFaint} />
                    <Txt variant="subhead" numberOfLines={2} style={[styles.cardText, done && styles.cardDone]}>
                      {task.title}
                    </Txt>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add task"
                disabled={!ready}
                onPress={() => addTask(col.id, 'New task')}
                style={[styles.addCard, { borderColor: colors.lineFaint, opacity: ready ? 1 : 0.5 }]}
              >
                <Icon name="plus" size={12} color={colors.inkFaint} />
                <Txt variant="caption" tone="inkFaint">Add card</Txt>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroText: { flex: 1, gap: 2 },
  emoji: { fontSize: 34 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.xs, borderWidth: 1 },
  columns: { gap: spacing.sm, paddingBottom: spacing.sm },
  column: { width: layout.boardColumnWidth, borderRadius: radii.card, borderWidth: 1, padding: spacing.sm, gap: spacing.xs },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: 2, paddingBottom: spacing.xs },
  colTitle: { flex: 1, letterSpacing: 0.5 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1 },
  cardText: { flex: 1 },
  cardDone: { textDecorationLine: 'line-through', opacity: 0.6 },
  addCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, borderRadius: radii.md, borderWidth: 1, borderStyle: 'dashed' },
});
