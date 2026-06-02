import { Platform, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { isDmHomeId } from '@/lib/dm-home';
import { useSpaces } from '@/lib/use-spaces';
import { StackScreen } from '@/components/ui/StackScreen';
import { SpaceTabHeader } from '@/components/chat/SpaceTabHeader';
import { WorkObjects } from '@/components/work/WorkObjects';

/** Work bottom tab — live docs + projects tree from the unified object index
 *  (see {@link WorkObjects}). Space context comes from {@link useSpaces}. */
export default function WorkScreen() {
  const { activeId } = useSpaces();
  const spaceId = isDmHomeId(activeId) ? null : activeId;
  // Native gets the shared nav-stack header (see SpaceStackLayout); web keeps the
  // in-screen custom header with hide-on-scroll.
  const nativeHeader = Platform.OS !== 'web';
  return (
    <StackScreen
      inTabs
      scroll
      collapsibleHeader={!nativeHeader}
      header={nativeHeader ? undefined : <SpaceTabHeader />}
      headerProvidedNatively={nativeHeader}
      contentStyle={styles.content}
    >
      <WorkObjects spaceId={spaceId} hero />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
});
