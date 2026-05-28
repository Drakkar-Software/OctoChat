import { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { acceptSpaceInvite, makeJoinRequest } from '@/lib/starfish/members';
import { decodePublicInvite, joinPublicSpace } from '@/lib/starfish/pubspace';
import { useInviteFragment } from '@/lib/use-invite-link';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';
import { QrScanner } from '@/components/onboarding/QrScanner';

type SpaceType = 'private' | 'public';

export default function JoinScreen() {
  const { session } = useSession();
  const { createSpace } = useSpaces();
  const inviteFrag = useInviteFragment();
  // The last fragment we auto-joined. Native re-delivers the same launch URL on
  // remount (there's no address bar to clear, unlike web's `replaceState`), so
  // this guards a given credential to a single join.
  const consumed = useRef<string | null>(null);
  const myRequest = useMemo(() => (session ? makeJoinRequest(session) : ''), [session]);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Native-only: scan a public-space invitation QR with the camera. The web
  // platform has no QrScanner (the shim returns null), so the button is hidden.
  const canScan = Platform.OS !== 'web';
  const [scanning, setScanning] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [spaceType, setSpaceType] = useState<SpaceType>('private');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const enterSpace = (spaceId: string) =>
    router.replace({ pathname: '/room/[id]', params: { id: `${spaceId}-general`, name: 'general', kind: 'channel' } });

  const makeSpace = async () => {
    if (!session || creating) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const space = await createSpace(spaceName, spaceType);
      if (!space) throw new Error('Could not create space.');
      setSpaceName('');
      enterSpace(space.id);
    } catch (e) {
      setCreateErr(String((e as Error)?.message ?? e));
      setCreating(false);
    }
  };

  /** Accept either a PRIVATE invite cap (JSON) or a PUBLIC invitation link/token. */
  const join = async (raw: string) => {
    if (!session || busy) return;
    const text = raw.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      // A public invite link carries its token in a `#…` fragment; a private invite
      // is a JSON cap bundle. Branch on the fragment.
      if (text.includes('#')) {
        const space = await joinPublicSpace(session, decodePublicInvite(text.slice(text.indexOf('#'))));
        enterSpace(space.id);
      } else {
        const space = await acceptSpaceInvite(session, text);
        enterSpace(space.id);
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  // Opening an invitation link (`…/join#<token>`) auto-joins the public space.
  // The fragment comes from the launch URL on web AND native (see
  // `useInviteFragment`). Waits for a session (needed to register the join), and
  // joins each credential once (web also clears it from the address bar).
  useEffect(() => {
    if (!inviteFrag || inviteFrag === '#' || !session) return;
    if (consumed.current === inviteFrag) return;
    consumed.current = inviteFrag;
    void (async () => {
      try {
        const space = await joinPublicSpace(session, decodePublicInvite(inviteFrag));
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        enterSpace(space.id);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, inviteFrag]);

  return (
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Join or create" onBack={() => router.back()} />}>
      <Card title="CREATE A SPACE">
        <View style={styles.typeRow}>
          <Button
            label="Private"
            variant={spaceType === 'private' ? 'primary' : 'secondary'}
            size="sm"
            iconName="lock"
            onPress={() => setSpaceType('private')}
          />
          <Button
            label="Public"
            variant={spaceType === 'public' ? 'primary' : 'secondary'}
            size="sm"
            iconName="globe"
            onPress={() => setSpaceType('public')}
          />
        </View>
        <Txt variant="footnote" tone="inkSoft">
          {spaceType === 'private'
            ? 'End-to-end encrypted. Members join by encrypted invite. You’ll be its owner.'
            : 'Plaintext — anyone with the invitation link can read (or, with a read/write link, post). You’ll be its owner.'}
        </Txt>
        {spaceType === 'public' ? (
          <Callout tone="warning" iconName="unlock" title="Not end-to-end encrypted">
            A public space is stored as plaintext the server can read. Don’t use it for anything sensitive.
          </Callout>
        ) : null}
        <TextField
          value={spaceName}
          onChangeText={setSpaceName}
          placeholder="Space name…"
          autoCapitalize="words"
          autoCorrect={false}
          onSubmitEditing={makeSpace}
          returnKeyType="go"
        />
        <Button
          label={creating ? 'Creating…' : spaceType === 'public' ? 'Create public space' : 'Create space'}
          variant="primary"
          size="md"
          disabled={creating}
          onPress={makeSpace}
        />
        {createErr ? (
          <Callout tone="danger" iconName="alert">
            {createErr}
          </Callout>
        ) : null}
      </Card>

      <Card title="YOUR JOIN REQUEST">
        <Txt variant="footnote" tone="inkSoft">
          For private spaces: send this to an owner so they can invite you.
        </Txt>
        <CopyField value={myRequest} copyLabel="Copy join request" />
      </Card>

      <Card title="PASTE AN INVITE">
        <Txt variant="footnote" tone="inkSoft">
          Paste a private invite cap, or a public space’s invitation link.
        </Txt>
        <TextField
          value={invite}
          onChangeText={setInvite}
          placeholder="Paste invite cap or link…"
          multiline
          mono
          autoCapitalize="none"
          autoCorrect={false}
        />
        {scanning ? (
          <QrScanner
            onScan={(data) => {
              setScanning(false);
              setInvite(data);
              void join(data);
            }}
          />
        ) : null}
        <View style={styles.actionRow}>
          <Button
            label={busy ? 'Joining…' : 'Join space'}
            variant="primary"
            size="md"
            style={styles.actionBtn}
            disabled={busy}
            onPress={() => join(invite)}
          />
          {canScan ? (
            <Button
              label={scanning ? 'Cancel scan' : 'Scan invite'}
              variant="secondary"
              size="md"
              iconName={scanning ? 'x' : 'qr-scan'}
              style={styles.actionBtn}
              onPress={() => setScanning((s) => !s)}
            />
          ) : null}
        </View>
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
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1 },
});
