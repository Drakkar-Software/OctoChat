import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import type { CrossRoomMessage } from '@/lib/cross-room';
import { useSession } from '@/lib/session-context';
import { useSearch } from '@/lib/use-search';
import { useSpaces } from '@/lib/use-spaces';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { StackScreen } from '@/components/ui/StackScreen';
import { MessageResult } from '@/components/chat/MessageResult';

export default function SearchScreen() {
  const { colors } = useTheme();
  const { session } = useSession();
  const { activeId } = useSpaces();
  const [query, setQuery] = useState('');
  const { results, loading } = useSearch(query, activeId);

  const open = (r: CrossRoomMessage) =>
    router.push({ pathname: '/room/[id]', params: { id: r.room.id, name: r.room.name, kind: r.room.kind } });

  return (
    <StackScreen inTabs header={<AppBar title="Search" />} contentStyle={styles.content}>
      <View style={[styles.field, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
        <Icon name="search" size={16} color={colors.inkMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search messages…"
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, { color: colors.ink }]}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" />
      ) : query.trim().length < 2 ? (
        <EmptyState
          iconName="search"
          title="Search everything"
          subtitle="Find messages across your encrypted rooms — decrypted on-device."
        />
      ) : loading ? (
        <EmptyState iconName="globe" title="Searching…" />
      ) : results.length === 0 ? (
        <EmptyState iconName="search" title="No matches" subtitle={`Nothing for “${query.trim()}”.`} />
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {results.map((r) => (
            <MessageResult
              key={r.room.id + r.msg.id}
              room={r.room}
              msg={r.msg}
              currentUserId={session.userId}
              onPress={() => open(r)}
            />
          ))}
        </ScrollView>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, gap: spacing.md },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  input: { flex: 1, fontFamily: fonts.body, fontSize: typeScale.body.fontSize, includeFontPadding: false },
  flex: { flex: 1 },
  list: { gap: spacing.sm, paddingBottom: 96 },
});
