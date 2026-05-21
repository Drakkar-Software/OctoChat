import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { acceptInvite, makeJoinRequest } from '@/lib/starfish/members';
import { addJoinedRoom } from '@/lib/starfish/registry';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

function copy(text: string) {
  try {
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => void } } }).navigator?.clipboard?.writeText?.(text);
  } catch {
    /* ignore */
  }
}

export default function JoinScreen() {
  const { session } = useSession();
  const { createSpace } = useSpaces();
  const myRequest = useMemo(() => (session ? makeJoinRequest(session) : ''), [session]);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const makeSpace = async () => {
    if (!session || creating) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const space = await createSpace(spaceName);
      if (!space) throw new Error('Could not create space.');
      setSpaceName('');
      router.replace({ pathname: '/room/[id]', params: { id: `${space.id}-general`, name: 'general', kind: 'channel' } });
    } catch (e) {
      setCreateErr(String((e as Error)?.message ?? e));
      setCreating(false);
    }
  };

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
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Join or create" onBack={() => router.back()} />}>
      <Card title="CREATE A SPACE">
        <Txt variant="footnote" tone="inkSoft">
          Start a new space with its own channels. You’ll be its owner.
        </Txt>
        <TextField
          value={spaceName}
          onChangeText={setSpaceName}
          placeholder="Space name…"
          autoCapitalize="words"
          autoCorrect={false}
          onSubmitEditing={makeSpace}
          returnKeyType="go"
        />
        <Button label={creating ? 'Creating…' : 'Create space'} variant="primary" size="md" disabled={creating} onPress={makeSpace} />
        {createErr ? (
          <Callout tone="danger" iconName="alert">
            {createErr}
          </Callout>
        ) : null}
      </Card>

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
        <TextField
          value={invite}
          onChangeText={setInvite}
          placeholder="Paste invite cap…"
          multiline
          mono
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
});
