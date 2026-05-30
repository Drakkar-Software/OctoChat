import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useExploreSpaces } from '@/lib/use-explore-spaces';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { SpaceExploreRow } from '@/components/chat/SpaceExploreRow';

/**
 * Explore — the public-space directory. Lists every public space the server knows
 * about (from the `_index/spaces/public` projection), newest first. View-only: it
 * shows what exists; joining still needs an invite link (stated below the list).
 * Thin route — all data access lives in `useExploreSpaces`.
 */
export default function ExploreScreen() {
  const { colors } = useTheme();
  const { spaces, ownerNames, loading, reload } = useExploreSpaces();

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Explore spaces"
          onBack={() => router.back()}
          right={<Button label="Refresh" variant="ghost" size="sm" iconName="refresh" onPress={reload} />}
        />
      }
    >
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Txt variant="footnote" tone="inkSoft">
            Loading public spaces…
          </Txt>
        </View>
      ) : spaces.length === 0 ? (
        <EmptyState
          iconName="globe"
          title="No public spaces yet"
          subtitle="Public spaces show up here once someone creates one. Create one from “Join or create”."
        />
      ) : (
        <>
          <Txt variant="footnote" tone="inkSoft">
            Public spaces anyone can discover. To join one, ask its owner for an invitation link —
            then paste it on the Join screen.
          </Txt>
          <View style={styles.list}>
            {spaces.map((s) => (
              <SpaceExploreRow key={s.id} space={s} ownerName={s.ownerId ? ownerNames.get(s.ownerId) : undefined} />
            ))}
          </View>
          <Callout tone="info" iconName="info" title="View-only directory">
            Listing a space here doesn’t grant access — public spaces are still joined by invitation link.
          </Callout>
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  center: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm },
  list: { gap: spacing.sm },
});
