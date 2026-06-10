import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useProfile } from '@/lib/profile-context';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AccountSwitcher } from '@/components/account/AccountSwitcher';
import { AppLockRow } from '@/components/settings/AppLockRow';
import { DebugStatsCard } from '@/components/settings/DebugStatsCard';
import { AiSettingsCard } from '@/components/settings/AiSettingsCard';
import { NotificationSettingsCard } from '@/components/settings/NotificationSettingsCard';
import { QuickReactionsCard } from '@/components/settings/QuickReactionsCard';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { UpdateSettingsCard } from '@/components/settings/UpdateSettingsCard';
import { AppBar } from '@/components/ui/AppBar';
import { EditableAvatar } from '@/components/ui/EditableAvatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

export default function YouScreen() {
  const { colors } = useTheme();
  const inShell = useInShell();
  const { fullSignOut, accounts, activeBootstrapOrigin } = useSession();
  const nostrPubHex = activeBootstrapOrigin?.kind === 'secp256k1' ? activeBootstrapOrigin.pubHex : null;
  const { profile, draft, setDraft, dirty, save, saving, avatarDraft, pickAvatar, removeAvatar, avatarError } =
    useProfile();

  // Reached by pushing /you from the Chat header (mobile) — needs a back action;
  // on the desktop shell it sits in the main pane, where the sidebar is the nav.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));

  if (!profile) {
    return (
      <StackScreen header={<AppBar title="Profile" onBack={inShell ? undefined : goBack} />}>
        <SignInPrompt subtitle="Create an identity to view your profile." />
      </StackScreen>
    );
  }

  const initials = profile.name.slice(0, 2).toUpperCase();

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Profile"
          onBack={inShell ? undefined : goBack}
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
      <EditableAvatar
        label={initials}
        image={avatarDraft}
        onPick={pickAvatar}
        onRemove={removeAvatar}
        error={avatarError}
        accessibilityLabel="Change profile photo"
      >
        <Txt variant="heading" weight="bold">
          {profile.name}
        </Txt>
        <Txt variant="footnote" mono tone="inkMuted">
          {profile.handle}
        </Txt>
      </EditableAvatar>

      <SettingsSection title="Identity">
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
        </Card>

        <Card title="ACCOUNTS">
          <AccountSwitcher />
        </Card>

        <Card title="SECURITY">
          {nostrPubHex ? (
            <Row
              iconName="key"
              title="Linked to Nostr"
              detail={`${nostrPubHex.slice(0, 8)}…${nostrPubHex.slice(-8)} · sign in with the same extension`}
              detailMono
            />
          ) : (
            <Row
              iconName="shield"
              accent
              title="Recovery seed"
              detail="12 words · view or back up"
              onPress={() => router.push('/account/backup')}
            />
          )}
          <Divider style={styles.divider} />
          <Row
            iconName="devices"
            title="Add a device"
            detail="Show pairing QR · PIN-sealed"
            onPress={() => router.push('/account/add-device')}
          />
          <AppLockRow />
        </Card>
      </SettingsSection>

      <SettingsSection title="Preferences">
        <AiSettingsCard />
        <NotificationSettingsCard />
        <QuickReactionsCard />
      </SettingsSection>

      <SettingsSection title="This device">
        <UpdateSettingsCard />
        <DebugStatsCard />
      </SettingsSection>

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
  field: { gap: 3 },
  divider: { marginVertical: spacing.xs },
});
