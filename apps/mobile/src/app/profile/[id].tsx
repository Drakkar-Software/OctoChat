import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useDm } from '@/lib/use-dm';
import { useUserProfile } from '@/lib/use-user-profile';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { ProfileHero } from '@/components/ui/ProfileHero';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

/** Read-only public profile for any user id — reached by tapping an author's
 *  avatar or name in chat. Public-read, so it needs no session. */
export default function ProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUserProfile(id);
  // The "Message" affordance + its availability (self / peer hasn't published keys /
  // ready — any peer with keys is DM-able now, no shared space required). Logic lives
  // in the hook; this page only maps the status onto button visibility.
  const { status, busy, error, openDm } = useDm(id);
  const showMessage = status === 'ready' || status === 'no-keys';

  return (
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Profile" onBack={() => router.back()} />}>
      <ProfileHero name={user.name} handle={user.handle} avatarLabel={user.initials} image={user.avatar} />

      {showMessage ? (
        <View style={styles.actions}>
          <Button
            label="Message"
            iconName="thread"
            variant="primary"
            size="lg"
            full
            loading={busy}
            disabled={status === 'no-keys'}
            onPress={() => openDm(user.name)}
          />
          {status === 'no-keys' ? (
            <Txt variant="footnote" tone="inkMuted">
              They need to open the app once before you can message them.
            </Txt>
          ) : null}
          {error ? (
            <Callout tone="warning" iconName="alert">
              {error}
            </Callout>
          ) : null}
        </View>
      ) : null}

      <Card title="IDENTITY">
        <CopyField label="User ID" value={id} copyLabel="Copy ID" lines={2} />
      </Card>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  actions: { gap: spacing.sm },
});
