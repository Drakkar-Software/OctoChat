import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { ProjectPlaceholder } from '@/components/work/ProjectPlaceholder';

/** Placeholder project board — previews the kanban surface (see {@link ProjectPlaceholder}). */
export default function WorkProjectScreen() {
  const router = useRouter();
  const { emoji, label, hint } = useLocalSearchParams<{ emoji?: string; label?: string; hint?: string }>();
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/work'));
  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Project" subtitle="Preview" onBack={goBack} />}
    >
      <ProjectPlaceholder emoji={emoji || '🗂️'} label={label || 'Untitled'} hint={hint} />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },
});
