import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, TextInput } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import { acceptInvite, makeJoinRequest } from '@/lib/starfish/members';
import { addJoinedRoom } from '@/lib/starfish/registry';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

function copy(text: string) {
  try {
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => void } } }).navigator?.clipboard?.writeText?.(text);
  } catch {
    /* ignore */
  }
}

export default function JoinScreen() {
  const { colors } = useTheme();
  const { session } = useSession();
  const myRequest = useMemo(() => (session ? makeJoinRequest(session) : ''), [session]);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const roomId = await acceptInvite(session, invite.trim());
      await addJoinedRoom(session.accountClient, session.userId, roomId);
      router.replace({ pathname: '/room/[id]', params: { id: roomId, name: `room-${roomId.slice(-6)}`, kind: 'channel' } });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Join a room" onBack={() => router.back()} />}>
      <Card title="YOUR JOIN REQUEST">
        <Txt variant="footnote" tone="inkSoft">
          Send this to a room owner so they can invite you.
        </Txt>
        <Txt variant="caption" mono tone="inkSoft" numberOfLines={4}>
          {myRequest}
        </Txt>
        {Platform.OS === 'web' ? (
          <Button label="Copy join request" variant="secondary" size="sm" iconName="copy" onPress={() => copy(myRequest)} />
        ) : null}
      </Card>

      <Card title="PASTE AN INVITE">
        <TextInput
          value={invite}
          onChangeText={setInvite}
          placeholder="Paste invite cap…"
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, { color: colors.ink, backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button label={busy ? 'Joining…' : 'Join room'} variant="primary" size="md" disabled={busy} onPress={join} />
        {error ? (
          <Callout tone="danger" iconName="alert">
            {error}
          </Callout>
        ) : null}
      </Card>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  input: {
    minHeight: 72,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    fontFamily: fonts.mono,
    fontSize: typeScale.caption.fontSize,
    textAlignVertical: 'top',
  },
});
