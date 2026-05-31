import { useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { spacing } from '@/theme';
import type { CrossRoomMessage } from '@/lib/cross-room';
import { useSession } from '@/lib/session-context';
import { useSearch } from '@/lib/use-search';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { MessageResult } from '@/components/chat/MessageResult';

export default function SearchScreen() {
  const { session } = useSession();
  const { activeId } = useSpaces();
  const [query, setQuery] = useState('');
  const { results, loading } = useSearch(query, activeId);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));

  const open = (r: CrossRoomMessage) =>
    router.push({ pathname: '/room/[id]', params: { id: r.room.id, name: r.room.name, kind: r.room.kind } });

  return (
    <StackScreen header={<AppBar title="Search" onBack={goBack} />} contentStyle={styles.content}>
      <TextField
        leadingIcon="search"
        value={query}
        onChangeText={setQuery}
        placeholder="Search messages…"
        autoCorrect={false}
        autoCapitalize="none"
      />

      {!session ? (
        <SignInPrompt />
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
        // Virtualized via LegendList. recycleItems stays off because MessageResult
        // holds per-row hover state (mirrors RoomConversation), and a separator
        // reproduces the old container `gap` that a virtualized list ignores.
        <LegendList
          style={styles.flex}
          contentContainerStyle={styles.list}
          {...(Platform.OS !== 'web' && { keyboardShouldPersistTaps: 'handled' })}
          data={results}
          keyExtractor={(r) => r.room.id + r.msg.id}
          estimatedItemSize={88}
          ItemSeparatorComponent={Separator}
          renderItem={({ item: r }) => (
            <MessageResult room={r.room} msg={r.msg} currentUserId={session.userId} onPress={() => open(r)} />
          )}
        />
      )}
    </StackScreen>
  );
}

/** Spacer between results — the virtualized list can't honor the container `gap`. */
const Separator = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  list: { paddingBottom: 96 },
  gap: { height: spacing.sm },
});
