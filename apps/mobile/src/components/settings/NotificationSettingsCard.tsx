import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useNotificationSettings } from '@/lib/notification-settings-context';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Txt } from '@/components/ui/Txt';

/**
 * The NOTIFICATIONS section of the profile screen. Reads/writes the shared
 * per-identity notification preferences; the sub-settings dim and lock while the
 * master toggle is off.
 */
export function NotificationSettingsCard() {
  const { settings, update } = useNotificationSettings();
  const off = !settings.enabled;

  return (
    <Card title="NOTIFICATIONS">
      <ToggleRow
        iconName="bell"
        title="Enable notifications"
        detail="Alert me about messages in other rooms"
        value={settings.enabled}
        onValueChange={(enabled) => update({ enabled })}
      />
      <Divider style={styles.divider} />
      <ToggleRow
        iconName="eye"
        title="Show message preview"
        detail="Decrypt and show the message text"
        value={settings.preview}
        onValueChange={(preview) => update({ preview })}
        disabled={off}
      />
      <Divider style={styles.divider} />
      <ToggleRow
        iconName="volume"
        title="Play sound"
        detail="Play a sound with each notification"
        value={settings.sound}
        onValueChange={(sound) => update({ sound })}
        disabled={off}
      />
      <Txt variant="micro" tone="inkMuted">
        Previews are decrypted on this device and shown on web, desktop & Android — including
        on the lock screen. iOS shows a generic banner (its preview and sound follow your
        system settings).
      </Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  divider: { marginVertical: spacing.xs },
});
