import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useAppLock } from '@/lib/use-app-lock';
import { Callout } from '@/components/ui/Callout';
import { Divider } from '@/components/ui/Divider';
import { ToggleRow } from '@/components/ui/ToggleRow';

/**
 * Security-card row that enables the faster app unlock for this platform — a WebAuthn
 * passkey on web, device biometrics on native (see `lib/use-app-lock`). Renders nothing
 * where unsupported (the desktop build, a browser without a platform authenticator, or a
 * device with no biometrics) so the card stays clean. Owns a leading divider so it slots
 * after another row without the parent dangling one when this is hidden.
 */
export function AppLockRow() {
  const lock = useAppLock();
  if (!lock.supported) return null;
  return (
    <>
      <Divider style={styles.divider} />
      <ToggleRow
        iconName={lock.iconName}
        title={lock.title}
        detail={lock.detail}
        value={lock.enabled}
        onValueChange={lock.toggle}
        disabled={lock.busy}
      />
      {lock.error ? (
        <View style={styles.error}>
          <Callout tone="danger" iconName="alert">
            {lock.error}
          </Callout>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  divider: { marginVertical: spacing.xs },
  error: { marginTop: spacing.sm },
});
