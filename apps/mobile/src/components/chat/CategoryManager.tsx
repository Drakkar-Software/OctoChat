import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

type ActionResult = Promise<string | null> | void;

interface CategoryManagerProps {
  categories: string[];
  onCreate: (name: string) => ActionResult;
  onRename: (oldName: string, newName: string) => ActionResult;
  onDelete: (name: string) => ActionResult;
  onReorder: (order: string[]) => ActionResult;
}

/** Owner-only category management: reorder (arrows), rename (inline), delete, and add.
 *  Each action resolves to a user-facing error message (or null on success) which is
 *  surfaced in a Callout. Pure composition of existing `ui` primitives. */
export function CategoryManager({ categories, onCreate, onRename, onDelete, onReorder }: CategoryManagerProps) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async (result: ActionResult) => {
    const message = await result;
    setError(typeof message === 'string' ? message : null);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= categories.length) return;
    const order = [...categories];
    [order[i], order[j]] = [order[j], order[i]];
    void run(onReorder(order));
  };

  const submitRename = (oldName: string) => {
    const n = draft.trim();
    setEditing(null);
    if (!n || n === oldName) return;
    void run(onRename(oldName, n));
  };

  const submitNew = () => {
    const n = newName.trim();
    setNewName('');
    if (!n) return;
    void run(onCreate(n));
  };

  return (
    <>
      {categories.map((c, i) => (
        <View key={c} style={[styles.row, { borderBottomColor: colors.lineFaint }]}>
          {editing === c ? (
            <TextField
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => submitRename(c)}
              autoFocus
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              containerStyle={styles.field}
            />
          ) : (
            <>
              <Icon name="folder" size={15} color={colors.inkMuted} />
              <Txt variant="subhead" numberOfLines={1} style={styles.name}>
                {c}
              </Txt>
            </>
          )}
          <View style={styles.actions}>
            {i > 0 ? (
              <IconButton name="chevron-up" size={16} color={colors.inkMuted} accessibilityLabel={`Move ${c} up`} onPress={() => move(i, -1)} />
            ) : null}
            {i < categories.length - 1 ? (
              <IconButton name="chevron-down" size={16} color={colors.inkMuted} accessibilityLabel={`Move ${c} down`} onPress={() => move(i, 1)} />
            ) : null}
            {editing === c ? (
              <IconButton name="check" size={16} color={colors.accent} accessibilityLabel="Save name" onPress={() => submitRename(c)} />
            ) : (
              <IconButton
                name="edit"
                size={15}
                color={colors.inkMuted}
                accessibilityLabel={`Rename ${c}`}
                onPress={() => {
                  setEditing(c);
                  setDraft(c);
                }}
              />
            )}
            <IconButton name="trash" size={15} color={colors.danger} accessibilityLabel={`Delete ${c}`} onPress={() => void run(onDelete(c))} />
          </View>
        </View>
      ))}

      <View style={styles.addRow}>
        <TextField
          leadingIcon="folder"
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={submitNew}
          placeholder="New category"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          containerStyle={styles.field}
        />
        <Button label="Add" variant="secondary" size="sm" iconName="plus" disabled={!newName.trim()} onPress={submitNew} />
      </View>

      {error ? (
        <Callout tone="warning" iconName="alert">
          {error}
        </Callout>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  name: { flex: 1 },
  field: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
});
