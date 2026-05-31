import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { DOCS_SECTIONS } from '@/lib/work-placeholder';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { WorkPanel } from '@/components/work/WorkPanel';

/** Docs bottom tab — placeholder docs / knowledge tree (see {@link WorkPanel}). */
export default function DocsScreen() {
  return (
    <StackScreen inTabs scroll header={<AppBar title="Docs" />} contentStyle={styles.content}>
      <WorkPanel sections={DOCS_SECTIONS} note="Docs and knowledge live here soon — a preview of the workspace." />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
});
