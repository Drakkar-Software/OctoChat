import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { PROJECTS_SECTIONS } from '@/lib/work-placeholder';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { WorkPanel } from '@/components/work/WorkPanel';

/** Projects bottom tab — placeholder projects / boards tree (see {@link WorkPanel}). */
export default function ProjectsScreen() {
  return (
    <StackScreen inTabs scroll header={<AppBar title="Projects" />} contentStyle={styles.content}>
      <WorkPanel sections={PROJECTS_SECTIONS} note="Projects and boards live here soon — a preview of the workspace." />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
});
