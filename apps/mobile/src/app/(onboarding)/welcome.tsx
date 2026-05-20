import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Octopus } from '@/components/brand/Octopus';
import { Wordmark } from '@/components/brand/Wordmark';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';

export default function Welcome() {
  const { colors } = useTheme();
  return (
    <Screen style={styles.screen}>
      <View style={styles.hero}>
        <View
          style={[
            styles.mark,
            { backgroundColor: colors.accentBg, borderColor: colors.accentBorder },
            shadows.accentGlow,
          ]}
        >
          <Octopus size={84} />
        </View>
        <Wordmark hideMark size={30} />
        <Txt variant="subhead" weight="medium" tone="inkSoft" center>
          End-to-end encrypted{'\n'}team chat by design.
        </Txt>
      </View>

      <View style={styles.actions}>
        <Button
          label="Create new identity"
          variant="primary"
          size="lg"
          full
          onPress={() => router.push('/(onboarding)/seed')}
        />
        <Button
          label="I have a recovery seed"
          variant="secondary"
          size="lg"
          full
          onPress={() => router.push('/(onboarding)/recover')}
        />
        <Button
          label="Scan QR from existing device"
          variant="ghost"
          size="md"
          full
          iconName="qr"
          onPress={() => router.push('/pair')}
        />
      </View>

      <View style={styles.trust}>
        <Icon name="lock" size={12} color={colors.accent} />
        <Txt variant="caption" tone="inkMuted">
          No email, no phone, no password.
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xl,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  mark: {
    width: 132,
    height: 132,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    gap: spacing.md,
  },
  trust: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
