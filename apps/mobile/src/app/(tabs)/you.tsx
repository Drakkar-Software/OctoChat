import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing, verificationColor } from '@/theme';
import { PROFILE } from '@/lib/placeholder-data';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Row } from '@/components/ui/Row';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

const ABOUT_FIELDS: { label: string; value: string; mono?: boolean }[] = [
  { label: 'Display name', value: PROFILE.user.name },
  { label: 'Pseudo', value: PROFILE.user.handle, mono: true },
  { label: 'Pronouns', value: PROFILE.pronouns },
  { label: 'Description', value: PROFILE.description },
];

export default function YouScreen() {
  const { colors } = useTheme();

  return (
    <StackScreen
      inTabs
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Profile"
          right={
            <Txt variant="subhead" weight="semibold" tone="accent">
              Save
            </Txt>
          }
        />
      }
    >
      <View style={styles.identity}>
        <View>
          <Avatar label={PROFILE.user.initials} size={68} presence={PROFILE.user.presence} />
          <View style={[styles.camera, { backgroundColor: colors.accent, borderColor: colors.paper }]}>
            <Icon name="camera" size={12} color={colors.onAccent} />
          </View>
        </View>
        <View style={styles.identityText}>
          <Txt variant="heading" weight="bold">
            {PROFILE.user.name}
          </Txt>
          <Txt variant="footnote" mono tone="inkMuted">
            {PROFILE.user.handle}
          </Txt>
          <Pill tone="accent" label={PROFILE.status} style={styles.statusPill} />
        </View>
      </View>

      <Card title="ABOUT">
        {ABOUT_FIELDS.map((f) => (
          <View key={f.label} style={styles.field}>
            <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
              {f.label}
            </Txt>
            <Txt variant="callout" mono={f.mono}>
              {f.value}
            </Txt>
          </View>
        ))}
      </Card>

      <Card title="SECURITY">
        {PROFILE.security.map((item, i) => (
          <View key={item.id}>
            {i > 0 ? <Divider style={styles.divider} /> : null}
            <Row
              iconName={item.icon}
              title={item.title}
              detail={item.detail}
              detailMono={item.mono}
              right={<Icon name="check-circle" size={16} color={verificationColor(colors, item.level)} />}
            />
          </View>
        ))}
      </Card>

      <Button
        label="Lock app"
        variant="ghost"
        size="md"
        iconName="logout"
        onPress={() => router.replace('/(onboarding)/welcome')}
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg, paddingBottom: 96 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  camera: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { flex: 1, gap: 2 },
  statusPill: { marginTop: 4 },
  field: { gap: 3 },
  divider: { marginVertical: spacing.xs },
});
