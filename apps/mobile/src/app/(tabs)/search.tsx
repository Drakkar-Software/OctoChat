import { useState } from 'react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import type { CrossRoomMessage } from '@/lib/cross-room';
import { useSession } from '@/lib/session-context';
import { useSearch } from '@/lib/use-search';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { MessageResult } from '@/components/chat/MessageResult';

export default function SearchScreen() {
  const { session } = useSession();
  const { activeId } = useSpaces();
  const [query, setQuery] = useState('');
  const { results, loading } = useSearch(query, activeId);

  const open = (r: CrossRoomMessage) =>
    router.push({ pathname: '/room/[id]', params: { id: r.room.id, name: r.room.name, kind: r.room.kind } });

  return (
    <StackScreen inTabs header={<AppBar title="Search" />} contentStyle={styles.content}>
      <TextField
        leadingIcon="search"
        value={query}
        onChangeText={setQuery}
        placeholder="Search messages…"
        autoCorrect={false}
        autoCapitalize="none"
      />

      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" />
      ) : query.trim().length < 2 ? (
        <EmptyState
          iconName="search"
          title="Search everything"
          subtitle="Find messages across your encrypted rooms — decrypted on-device."
        />
      ) : loading && results.length === 0 ? (
        <MessageListSkeleton count={4} />
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
  flex: { flex: 1 },
  list: { gap: spacing.sm, paddingBottom: 96 },
});
