import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { getProvider } from '@drakkar.software/octochat-sdk';
import type { Room } from '@drakkar.software/octochat-sdk';
import { Callout } from '@/components/ui/Callout';

/** Tiny status + command-hint chip rendered in an automated room. Tells the
 *  viewer (a) which provider runs here, (b) which device is the runner, and
 *  (c) the available `/<commands>`. Hidden when the kind isn't automated. */
export function AutomationHints({ room }: { room: Room }) {
  const { session } = useSession();
  const auto = room.automation;
  if (!auto) return null;
  const provider = getProvider(auto.providerId);
  if (!provider) {
    return (
      <View style={styles.wrap}>
        <Callout tone="warning" iconName="alert">
          Unknown automation provider “{auto.providerId}”. This device can't run it.
        </Callout>
      </View>
    );
  }
  const runsHere = session && auto.runOnDeviceId === session.keys.edPub;
  const statusLabel = !auto.enabled
    ? 'Disabled'
    : auto.lastError
    ? `Failed: ${auto.lastError}`
    : runsHere
    ? 'Running on this device'
    : auto.runOnDeviceId
    ? 'Running on another device'
    : 'No device elected to run';
  const tone: 'info' | 'warning' = auto.lastError ? 'warning' : 'info';
  // The provider name is the Callout title (its own line); status + the command
  // hint go in the body, newline-joined — Callout wraps children in a single
  // <Txt>, so sibling <Txt> nodes would render inline ("RSS feedRunning on…").
  const hint = provider.commands?.length
    ? `Try ${provider.commands.map((c) => c.usage).join(' · ')}`
    : null;
  return (
    <View style={styles.wrap}>
      <Callout tone={tone} iconName={tone === 'warning' ? 'alert' : 'info'} title={provider.name}>
        {hint ? `${statusLabel}\n${hint}` : statusLabel}
      </Callout>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
});
