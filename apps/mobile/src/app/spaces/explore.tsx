import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { plural } from '@drakkar.software/octochat-sdk';
import { useExploreSpaces } from '@/lib/use-explore-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pill } from '@/components/ui/Pill';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { SpaceExploreRow, SpaceExploreRowSkeleton } from '@/components/chat/SpaceExploreRow';

/**
 * Explore — the public-space directory. Lists every public space the server knows
 * about (from the `_index/spaces/public` projection), newest first. View-only: it
 * shows what exists; joining still needs an invite link (stated in the lead).
 * Thin route — all data access lives in `useExploreSpaces`.
 */
export default function ExploreScreen() {
  const { spaces, ownerNames, loading, reload } = useExploreSpaces();
  const hasSpaces = spaces.length > 0;
  // Tapping a directory row reveals the invite-only path forward (the directory
  // grants no access — joining still needs the owner's link), so the inert-looking
  // row becomes an honest, actionable affordance rather than a dead tap.
  const [hintFor, setHintFor] = useState<string | null>(null);

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Explore"
          onBack={() => router.back()}
          right={<Button label="Refresh" variant="ghost" size="sm" iconName="refresh" onPress={reload} />}
        />
      }
    >
      {/* Editorial lead-in: sets the "surfacing from the deep" framing + a live count. */}
      <View style={styles.lead}>
        <View style={styles.kicker}>
          <Txt variant="micro" weight="semibold" mono uppercase tone="accent">
            Discover
          </Txt>
          {!loading && hasSpaces ? <Pill label={plural(spaces.length, 'space')} tone="accent" /> : null}
        </View>
        <Txt variant="title" weight="bold">
          Public spaces
        </Txt>
        <Txt variant="footnote" tone="inkSoft" style={styles.leadCopy}>
          Spaces anyone can find. They’re view-only here — join one with an invitation link from its owner,
          pasted on the Join screen.
        </Txt>
      </View>

      {loading ? (
        <View style={styles.list} accessibilityLabel="Loading public spaces">
          {[0, 1, 2, 3].map((i) => (
            <SpaceExploreRowSkeleton key={i} />
          ))}
        </View>
      ) : hasSpaces ? (
        <View style={styles.list}>
          {spaces.map((s) => (
            <View key={s.id} style={styles.rowGroup}>
              <SpaceExploreRow
                space={s}
                ownerName={s.ownerId ? ownerNames.get(s.ownerId) : undefined}
                onPress={() => setHintFor((cur) => (cur === s.id ? null : s.id))}
              />
              {hintFor === s.id ? (
                <Callout tone="info" iconName="key" title="Invite-only">
                  This directory is preview-only. Ask {s.name ?? 'the space'}’s owner for an invitation link, then paste
                  it on the Join screen to get in.
                </Callout>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          iconName="globe"
          title="The water’s still"
          subtitle="No public spaces have surfaced yet. Create one from “Join or create” and it’ll appear here."
        />
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  lead: { gap: spacing.xs },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leadCopy: { maxWidth: 460 },
  list: { gap: spacing.sm },
  rowGroup: { gap: spacing.sm },
});
