import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useAppLockGate } from '@/lib/use-app-lock-gate';
import { useTheme } from '@/lib/use-theme';
import { HeroMark } from '@/components/brand/HeroMark';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Txt } from '@/components/ui/Txt';

/**
 * Full-screen biometric lock that covers the app — and its app-switcher snapshot — until
 * the owner re-authenticates. Native-only: the gate hook is inert on web, so this renders
 * nothing there. Mounted by {@link AppFrame} as the topmost child so it sits over every
 * route; it does NOT tear down the session (the OS protects the seed at rest), it only
 * gates the UI. The lockup reuses the onboarding {@link HeroMark} so the lock feels like
 * the same OctoChat, not a system dialog.
 */
export function AppLockGate() {
  const { colors } = useTheme();
  const { locked, authing, error, unlock } = useAppLockGate();
  if (!locked) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: colors.canvas }]}>
      <View style={styles.center}>
        <HeroMark size={132} />
        <View style={styles.copy}>
          <Txt variant="title" weight="bold" center>
            OctoChat is locked
          </Txt>
          <Txt variant="caption" mono uppercase tone="inkMuted" center>
            Authenticate to continue
          </Txt>
        </View>
        {error ? (
          <Callout tone="danger" iconName="alert">
            {error}
          </Callout>
        ) : null}
        <Button
          label={authing ? 'Unlocking…' : 'Unlock'}
          variant="primary"
          size="lg"
          full
          iconName="unlock"
          loading={authing}
          disabled={authing}
          onPress={unlock}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  center: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xl },
  copy: { gap: spacing.xs, alignItems: 'center' },
});
