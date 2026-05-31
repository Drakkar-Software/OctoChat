import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';

export default function NotFound() {
  return (
    <Screen style={styles.screen}>
      <EmptyState iconName="globe" title="Lost at sea" subtitle="This channel has drifted out of range.">
        <Button
          label="Back to rooms"
          variant="primary"
          size="lg"
          style={styles.cta}
          onPress={() => router.replace('/(tabs)/rooms')}
        />
      </EmptyState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center', padding: spacing.xl },
  cta: { alignSelf: 'center' },
});
