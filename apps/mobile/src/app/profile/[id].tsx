import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useDm } from '@/lib/use-dm';
import { useUserProfile } from '@/lib/use-user-profile';
import { AppBar } from '@/components/ui/AppBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

/** Read-only public profile for any user id — reached by tapping an author's
 *  avatar or name in chat. Public-read, so it needs no session. */
export default function ProfileScreen() {
  // useUserProfile reads a module cache the React Compiler can't track; opt out
  // so a freshly-fetched pseudo/avatar reaches this screen. See use-pseudos.ts.
  'use no memo';
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUserProfile(id);
  // The "Message" affordance + its availability (self / no shared private space / peer
  // hasn't published keys / ready). Logic lives in the hook; this page only maps the
  // status onto button visibility.
  const { status, busy, error, openDm } = useDm(id);
  const showMessage = status === 'ready' || status === 'no-keys';

  return (
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Profile" onBack={() => router.back()} />}>
      <View style={styles.identity}>
        <Avatar label={user.initials} image={user.avatar} size={68} ring />
        <View style={styles.identityText}>
          <Txt variant="heading" weight="bold" numberOfLines={1}>
            {user.name}
          </Txt>
          <Txt variant="footnote" mono tone="inkMuted" numberOfLines={1}>
            {user.handle}
          </Txt>
        </View>
      </View>

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
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  identityText: { flex: 1, gap: 2 },
  actions: { gap: spacing.sm },
});
