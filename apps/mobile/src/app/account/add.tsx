import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

/** Add-account chooser: create a fresh identity or recover one from a seed. Both
 *  append to the already-unlocked vault and switch to it — no PIN step. */
export default function AddAccountScreen() {
  const { session } = useSession();
  // Adding an account only makes sense over an unlocked vault; bounce out otherwise.
  if (!session) return <Redirect href="/" />;

  return (
    <StackScreen
      contentStyle={styles.content}
      header={
        <AppBar
          title="Add account"
          subtitle="Another identity on this device"
          onBack={() => router.back()}
          right={<IconButton name="x" onPress={() => router.back()} accessibilityLabel="Cancel" />}
        />
      }
    >
      <Txt variant="body" tone="inkSoft">
        Hold several identities here and switch between them instantly. Your current account stays signed in.
      </Txt>
      <View style={styles.actions}>
        <Button
          label="Create new identity"
          variant="primary"
          size="lg"
          full
          onPress={() => router.push('/account/create')}
        />
        <Button
          label="I have a recovery seed"
          variant="secondary"
          size="lg"
          full
          onPress={() => router.push('/account/recover')}
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
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  actions: { gap: spacing.md },
});
