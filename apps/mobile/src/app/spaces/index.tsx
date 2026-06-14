import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { DM_HOME_ID, isDmHomeId } from '@/lib/dm-home';
import { tapFeedback } from '@/lib/haptics';
import { useTotalDmUnread } from '@/lib/use-dms';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { SpacePicker } from '@/components/chat/SpacePicker';

/**
 * Dedicated space-switcher screen, pushed from the mobile {@link SpaceTabHeader}
 * (tap the space pill). Replaces the old dropdown with a full screen that slides
 * in natively. Picking a space updates the shared spaces context and pops back to
 * the tab the user came from — its content has already re-keyed to the new space.
 */
export default function SpacesScreen() {
  const { spaces, activeId, setActiveId, moveSpace } = useSpaces();
  const dmUnread = useTotalDmUnread();
  const isDmHome = isDmHomeId(activeId);

  // Deep-linked straight to /spaces (no history to pop) falls back to the Chat tab.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));

  const choose = (id: string) => {
    tapFeedback();
    setActiveId(id);
    goBack();
  };

  return (
    <StackScreen header={<AppBar title="Spaces" onBack={goBack} />} scroll contentStyle={styles.content}>
      <SpacePicker
        spaces={spaces}
        activeId={activeId ?? DM_HOME_ID}
        isDmHome={isDmHome}
        dmUnread={dmUnread}
        onSelectSpace={choose}
        onSelectDms={() => choose(DM_HOME_ID)}
        onAddSpace={() => router.push('/join')}
        onBrowseSpaces={() => router.push('/spaces/explore')}
        onMoveSpace={moveSpace}
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, gap: spacing.md },
});
