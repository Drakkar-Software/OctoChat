import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { getProvider } from '@/lib/automations/providers';
import type { Room } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Txt } from '@/components/ui/Txt';

/** Tiny status + command-hint chip rendered in an automated room. Tells the
 *  viewer (a) which provider runs here, (b) which device is the runner, and
 *  (c) the available `/<commands>`. Hidden when the kind isn't automated. */
export function AutomationHints({ room }: { room: Room }) {
  const { session } = useSession();
  const { colors } = useTheme();
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
  return (
    <View style={styles.wrap}>
      <Callout tone={tone} iconName={tone === 'warning' ? 'alert' : 'info'}>
        <Txt variant="footnote" weight="semibold">
          {provider.name}
        </Txt>
        <Txt variant="caption" tone="inkMuted">
          {statusLabel}
        </Txt>
        {provider.commands && provider.commands.length ? (
          <Txt variant="caption" tone="inkMuted" style={{ color: colors.inkMuted }}>
            Try {provider.commands.map((c) => c.usage).join(' · ')}
          </Txt>
        ) : null}
      </Callout>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
});
