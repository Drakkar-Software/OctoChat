import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing, verificationColor } from '@/theme';
import { useProfile } from '@/lib/use-profile';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Row } from '@/components/ui/Row';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

export default function YouScreen() {
  const { colors } = useTheme();
  const { lock } = useSession();
  const { profile, save, saving } = useProfile();
  const verified = verificationColor(colors, 'verified');

  if (!profile) {
    return (
      <StackScreen inTabs header={<AppBar title="Profile" />}>
        <EmptyState iconName="lock" title="Sign in first" subtitle="Create an identity to view your profile." />
      </StackScreen>
    );
  }

  const initials = profile.name.slice(0, 2).toUpperCase();
  const check = <Icon name="check-circle" size={16} color={verified} />;

  return (
    <StackScreen
      inTabs
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Profile"
          right={
            <Pressable accessibilityRole="button" onPress={() => save(profile.name)}>
              <Txt variant="subhead" weight="semibold" tone="accent">
                {saving ? 'Saving…' : 'Save'}
              </Txt>
            </Pressable>
          }
        />
      }
    >
      <View style={styles.identity}>
        <Avatar label={initials} size={68} presence="online" />
        <View style={styles.identityText}>
          <Txt variant="heading" weight="bold">
            {profile.name}
          </Txt>
          <Txt variant="footnote" mono tone="inkMuted">
            {profile.handle}
          </Txt>
        </View>
      </View>

      <Card title="ABOUT">
        <View style={styles.field}>
          <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
            Display name
          </Txt>
          <Txt variant="callout">{profile.name}</Txt>
        </View>
        <View style={styles.field}>
          <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
            User ID
          </Txt>
          <Txt variant="callout" mono>
            {profile.userId}
          </Txt>
        </View>
      </Card>

      <Card title="SECURITY">
        <Row iconName="shield" title="Recovery seed" detail="12-word phrase · backed up" right={check} />
        <Divider style={styles.divider} />
        <Row
          iconName="devices"
          title="Devices"
          detail="1 active · add another"
          right={check}
          onPress={() => router.push('/(onboarding)/add-device')}
        />
        <Divider style={styles.divider} />
        <Row iconName="key" title="Identity fingerprint" detail={profile.fingerprint} detailMono right={check} />
      </Card>

      <Button
        label="Lock app"
        variant="ghost"
        size="md"
        iconName="logout"
        onPress={async () => {
          await lock();
          router.replace('/(onboarding)/welcome');
        }}
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg, paddingBottom: 96 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  identityText: { flex: 1, gap: 2 },
  field: { gap: 3 },
  divider: { marginVertical: spacing.xs },
});
