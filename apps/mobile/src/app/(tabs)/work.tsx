import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { WORK_SECTIONS } from '@/lib/work-placeholder';
import { StackScreen } from '@/components/ui/StackScreen';
import { SpaceTabHeader } from '@/components/chat/SpaceTabHeader';
import { WorkPanel } from '@/components/work/WorkPanel';

/** Work bottom tab — placeholder docs + projects tree (see {@link WorkPanel}). */
export default function WorkScreen() {
  return (
    <StackScreen inTabs scroll collapsibleHeader header={<SpaceTabHeader />} contentStyle={styles.content}>
      <WorkPanel sections={WORK_SECTIONS} hero />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
});
