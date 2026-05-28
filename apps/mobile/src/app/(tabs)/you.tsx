import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing, verificationColor } from '@/theme';
import { useProfile } from '@/lib/profile-context';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AccountSwitcher } from '@/components/account/AccountSwitcher';
import { NotificationSettingsCard } from '@/components/settings/NotificationSettingsCard';
import { UpdateSettingsCard } from '@/components/settings/UpdateSettingsCard';
import { AppBar } from '@/components/ui/AppBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { Row } from '@/components/ui/Row';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

export default function YouScreen() {
  const { colors } = useTheme();
  const { fullSignOut, accounts } = useSession();
  const { profile, draft, setDraft, dirty, save, saving, avatarDraft, pickAvatar, removeAvatar, avatarError } =
    useProfile();
  const verified = verificationColor(colors, 'verified');

  if (!profile) {
    return (
      <StackScreen inTabs header={<AppBar title="Profile" />}>
        <SignInPrompt subtitle="Create an identity to view your profile." />
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save profile"
              accessibilityState={{ disabled: !dirty || saving }}
              disabled={!dirty || saving}
              onPress={save}
            >
              <Txt variant="subhead" weight="semibold" tone={dirty || saving ? 'accent' : 'inkMuted'}>
                {saving ? 'Saving…' : 'Save'}
              </Txt>
            </Pressable>
          }
        />
      }
    >
      <View style={styles.identity}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          onPress={pickAvatar}
          style={styles.avatarWrap}
        >
          <Avatar label={initials} image={avatarDraft} size={68} />
          <View style={[styles.cameraBadge, { backgroundColor: colors.accent, borderColor: colors.paper }]}>
            <Icon name="camera" size={12} color={colors.onAccent} />
          </View>
        </Pressable>
        <View style={styles.identityText}>
          <Txt variant="heading" weight="bold">
            {profile.name}
          </Txt>
          <Txt variant="footnote" mono tone="inkMuted">
            {profile.handle}
          </Txt>
          <View style={styles.avatarActions}>
            <Pressable accessibilityRole="button" onPress={pickAvatar} hitSlop={6}>
              <Txt variant="footnote" weight="semibold" tone="accent">
                {avatarDraft ? 'Change photo' : 'Upload photo'}
              </Txt>
            </Pressable>
            {avatarDraft ? (
              <Pressable accessibilityRole="button" onPress={removeAvatar} hitSlop={6}>
                <Txt variant="footnote" weight="semibold" tone="danger">
                  Remove
                </Txt>
              </Pressable>
            ) : null}
          </View>
          {avatarError ? (
            <Txt variant="micro" tone="danger">
              {avatarError}
            </Txt>
          ) : null}
        </View>
      </View>

      <Card title="ACCOUNTS">
        <AccountSwitcher />
      </Card>

      <Card title="ABOUT">
        <View style={styles.field}>
          <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
            Display name
          </Txt>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder="Your display name"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (dirty) save();
            }}
          />
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
        <Row
          iconName="shield"
          title="Recovery seed"
          detail="12 words · view or back up"
          onPress={() => router.push('/account/backup')}
        />
        <Divider style={styles.divider} />
        <Row
          iconName="devices"
          title="Add a device"
          detail="Show pairing QR · PIN-sealed"
          onPress={() => router.push('/account/add-device')}
        />
        <Divider style={styles.divider} />
        <Row iconName="key" title="Identity fingerprint" detail={profile.fingerprint} detailMono right={check} />
      </Card>

      <NotificationSettingsCard />

      <UpdateSettingsCard />

      {accounts.length > 1 ? (
        <Button
          label="Sign out of all accounts"
          variant="ghost"
          size="md"
          iconName="logout"
          onPress={async () => {
            await fullSignOut();
            router.replace('/(onboarding)/welcome');
          }}
        />
      ) : null}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg, paddingBottom: 96 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatarWrap: { position: 'relative' },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { flex: 1, gap: 2 },
  avatarActions: { flexDirection: 'row', gap: spacing.md, marginTop: 2 },
  field: { gap: 3 },
  divider: { marginVertical: spacing.xs },
});
