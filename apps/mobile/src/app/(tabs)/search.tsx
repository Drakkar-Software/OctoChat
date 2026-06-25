import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { layout, spacing } from '@/theme';
import type { CrossRoomMessage, PublicSpaceEntry } from '@drakkar.software/octochat-sdk';
import { useExploreSpaces } from '@/lib/use-explore-spaces';
import { useSearch } from '@/lib/use-search';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { MessageResult } from '@/components/chat/MessageResult';
import { SpaceExploreRow, SpaceExploreRowSkeleton } from '@/components/chat/SpaceExploreRow';

type SearchMode = 'messages' | 'spaces';

const SEGMENTS = [
  { key: 'messages' as const, label: 'Messages' },
  { key: 'spaces' as const, label: 'Spaces' },
] as const;

export default function SearchScreen() {
  const { session } = useSession();
  const { activeId } = useSpaces();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('messages');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  // Both hooks called unconditionally (React rules). useExploreSpaces loads on
  // mount regardless of active mode so the directory is ready when the user
  // switches, with no extra round-trip. useSearch is cheap to idle-mount.
  const { results, loading: msgLoading } = useSearch(query, activeId);
  const { spaces: allSpaces, loading: spacesLoading } = useExploreSpaces();

  const q = query.trim().toLowerCase();

  // Client-side name filter — the directory is a single small doc, no server round-trip.
  const filteredSpaces = useMemo(() => {
    if (!q) return allSpaces;
    return allSpaces.filter((s) => (s.name ?? '').toLowerCase().includes(q));
  }, [allSpaces, q]);

  // The space whose invite-only callout is currently shown (toggle on re-tap).
  const selectedSpace = selectedSpaceId
    ? (filteredSpaces.find((s) => s.id === selectedSpaceId) ?? null)
    : null;

  const openRoom = (r: CrossRoomMessage) =>
    router.push({ pathname: '/room/[id]', params: { id: r.room.id, name: r.room.name, kind: r.room.kind } });

  const selectMode = (m: SearchMode) => {
    setMode(m);
    setSelectedSpaceId(null);
  };

  const pressSpace = (s: PublicSpaceEntry) =>
    setSelectedSpaceId((prev) => (prev === s.id ? null : s.id));

  const changeQuery = (t: string) => {
    setQuery(t);
    setSelectedSpaceId(null);
  };

  return (
    <StackScreen header={<AppBar title="Search" />} contentStyle={styles.content}>
      <TextField
        leadingIcon="search"
        value={query}
        onChangeText={changeQuery}
        placeholder={mode === 'messages' ? 'Search messages…' : 'Search spaces…'}
        autoCorrect={false}
        autoCapitalize="none"
      />

      <SegmentedControl segments={SEGMENTS} selected={mode} onSelect={selectMode} />

      {/* Messages mode requires a session (E2EE decrypt on-device). */}
      {mode === 'messages' && !session ? (
        <SignInPrompt />
      ) : mode === 'messages' ? (
        // ── Messages ─────────────────────────────────────────────────────────
        q.length < 2 ? (
          <EmptyState
            iconName="search"
            title="Search everything"
            subtitle="Find messages across your encrypted rooms — decrypted on-device."
          />
        ) : msgLoading && results.length === 0 ? (
          <MessageListSkeleton count={4} />
        ) : results.length === 0 ? (
          <EmptyState iconName="search" title="No matches" subtitle={`Nothing for "${query.trim()}".`} />
        ) : (
          <LegendList
            style={styles.flex}
            contentContainerStyle={styles.list}
            {...(Platform.OS !== 'web' && { keyboardShouldPersistTaps: 'handled' })}
            data={results}
            keyExtractor={(r) => r.room.id + r.msg.id}
            estimatedItemSize={88}
            ItemSeparatorComponent={Separator}
            renderItem={({ item: r }) => (
              <MessageResult room={r.room} msg={r.msg} currentUserId={session!.userId} onPress={() => openRoom(r)} />
            )}
          />
        )
      ) : (
        // ── Spaces — public directory, world-readable (no session needed) ────
        <>
          {selectedSpace && (
            <View style={styles.inviteCard}>
              <Callout tone="info" iconName="key">
                {`${selectedSpace.name ?? 'This space'} is invite-only — ask the owner for an invite link.`}
              </Callout>
              <Button
                label="Join with invite link"
                variant="primary"
                iconName="plus"
                full
                onPress={() => router.push('/join')}
              />
            </View>
          )}
          {spacesLoading ? (
            <View style={styles.skeletons}>
              {[0, 1, 2, 3].map((i) => <SpaceExploreRowSkeleton key={i} />)}
            </View>
          ) : filteredSpaces.length === 0 ? (
            <EmptyState
              iconName="globe"
              title={q.length >= 2 ? 'No spaces found' : 'No public spaces yet'}
              subtitle={
                q.length >= 2
                  ? `No public space matches "${query.trim()}".`
                  : "Public spaces will appear here once they're listed."
              }
            />
          ) : (
            <LegendList
              style={styles.flex}
              contentContainerStyle={styles.list}
              {...(Platform.OS !== 'web' && { keyboardShouldPersistTaps: 'handled' })}
              data={filteredSpaces}
              keyExtractor={(s) => s.id}
              estimatedItemSize={70}
              ItemSeparatorComponent={Separator}
              renderItem={({ item: s }) => (
                <SpaceExploreRow space={s} onPress={() => pressSpace(s)} />
              )}
            />
          )}
        </>
      )}
    </StackScreen>
  );
}

const Separator = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  list: { paddingBottom: layout.tabBarSafeBottom },
  gap: { height: spacing.sm },
  inviteCard: { gap: spacing.sm },
  skeletons: { gap: spacing.sm },
});
