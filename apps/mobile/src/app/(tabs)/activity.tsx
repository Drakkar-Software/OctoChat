import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useResponsive } from '@/lib/use-responsive';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { ActivityFeed } from '@/components/chat/ActivityFeed';

export default function ActivityScreen() {
  const { activeId } = useSpaces();
  const { isWide } = useResponsive();
  // Desktop reaches this via the always-visible bell, so it spans every space;
  // the mobile tab scopes to the active space alongside its room list.
  return (
    <StackScreen inTabs header={<AppBar title="Activity" />} contentStyle={styles.content}>
      <ActivityFeed spaceId={isWide ? null : activeId} />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, flex: 1 },
});
