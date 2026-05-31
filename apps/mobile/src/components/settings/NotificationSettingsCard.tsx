import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { isDesktop } from '@/lib/desktop';
import { useNotificationSettings } from '@/lib/notification-settings-context';
import { NOTIFICATION_SOUNDS, type NotificationSound } from '@/lib/notification-settings';
import { NOTIFICATION_SOUND_LABELS, playNotificationSound } from '@/lib/notification-sound';
import { useTheme } from '@/lib/use-theme';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { Row } from '@/components/ui/Row';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Txt } from '@/components/ui/Txt';

/**
 * The NOTIFICATIONS section of the profile screen. Reads/writes the shared
 * per-identity notification preferences; the sub-settings dim and lock while the
 * master toggle is off. The sound controls (toggle + chime picker) only appear on
 * desktop, where we synthesize our own selectable chime — web toasts use the OS
 * default sound and native push follows the platform channel, neither of which we
 * pick here.
 */
export function NotificationSettingsCard() {
  const { settings, update } = useNotificationSettings();
  const off = !settings.enabled;
  const desktop = isDesktop();
  // iOS renders its banner from the generic FCM payload, so it can't show a
  // decrypted preview — lock the toggle off and say so.
  const previewUnsupported = Platform.OS === 'ios';

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
        detail={
          previewUnsupported
            ? 'Not yet supported on iOS — the system renders the banner'
            : 'Decrypt and show the message text'
        }
        value={previewUnsupported ? false : settings.preview}
        onValueChange={(preview) => update({ preview })}
        disabled={off || previewUnsupported}
      />
      {desktop ? (
        <>
          <Divider style={styles.divider} />
          <ToggleRow
            iconName="volume"
            title="Play sound"
            detail="Play a sound with each notification"
            value={settings.sound}
            onValueChange={(sound) => update({ sound })}
            disabled={off}
          />
          {settings.sound && !off ? (
            <SoundPicker
              value={settings.soundName}
              onChange={(soundName) => {
                update({ soundName });
                playNotificationSound(soundName); // preview the choice
              }}
            />
          ) : null}
        </>
      ) : null}
      <Txt variant="micro" tone="inkMuted">
        Previews are decrypted on this device and shown on web, desktop & Android — including
        on the lock screen. iOS shows a generic banner (its preview and sound follow your
        system settings).
      </Txt>
    </Card>
  );
}

/** Radio list of synthesized chimes; selecting one previews it (see card above). */
function SoundPicker({
  value,
  onChange,
}: {
  value: NotificationSound;
  onChange: (sound: NotificationSound) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.picker}>
      {NOTIFICATION_SOUNDS.map((sound) => (
        <Row
          key={sound}
          title={NOTIFICATION_SOUND_LABELS[sound]}
          onPress={() => onChange(sound)}
          right={
            value === sound ? <Icon name="check" size={18} color={colors.accent} /> : <View />
          }
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { marginVertical: spacing.xs },
  picker: { paddingLeft: spacing.xl, paddingTop: spacing.xs },
});
