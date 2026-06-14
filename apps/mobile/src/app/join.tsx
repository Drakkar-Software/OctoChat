import { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { acceptSpaceInvite, joinNodeByLink, joinSpaceByLink, makeJoinRequest, previewInvite } from '@drakkar.software/octochat-sdk';
import type { InvitePreview } from '@drakkar.software/octochat-sdk';
import { useInviteFragment } from '@/lib/use-invite-link';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { Divider } from '@/components/ui/Divider';
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
  // Pending invite waiting for the user's consent. Set by BOTH the auto-link effect
  // and the manual join() — neither runs the actual join until "Join" is pressed.
  // `raw` is the original text/fragment (for the deep-link effect; manual join uses
  // the InvitePreview directly). `source` distinguishes the auto-link path (so the
  // web history entry is cleared on confirm) from the manual paste/scan path.
  const [pendingInvite, setPendingInvite] = useState<{
    inv: InvitePreview;
    raw: string;
    source: 'auto-link' | 'manual';
  } | null>(null);
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

  /**
   * Preview an invite — shows a consent card WITHOUT joining.
   * The actual join runs only when the user confirms via the consent card's "Join" button.
   * Handles link-based invites (`#…` fragment) and raw JSON cap bundles.
   */
  const join = async (raw: string) => {
    if (!session || busy) return;
    const text = raw.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      // A link-based invite carries its token in a `#…` fragment; a private invite
      // is a JSON cap bundle. Branch on the fragment.
      const fragment = text.includes('#') ? text.slice(text.indexOf('#')) : null;
      if (fragment) {
        const inv = await previewInvite(fragment);
        setPendingInvite({ inv, raw: fragment, source: 'manual' });
        setBusy(false); // show the consent card; user decides next
      } else {
        // JSON cap bundle — preview it as a member-bundle first so the user sees
        // which space they're about to join.
        const inv = await previewInvite(text);
        setPendingInvite({ inv, raw: text, source: 'manual' });
        setBusy(false);
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  /** Execute the join after the user has confirmed the consent card. */
  const confirmJoin = async () => {
    if (!session || !pendingInvite || busy) return;
    const { inv, source } = pendingInvite;
    setBusy(true);
    setError(null);
    try {
      let spaceId: string;
      if (inv.kind === 'space-link') {
        spaceId = (await joinSpaceByLink(session, inv.token)).id;
      } else if (inv.kind === 'node-link') {
        // joinNodeByLink returns the node id (which OctoChat uses as the space id —
        // room ids derive from it e.g. `<nodeId>-general`). Navigating to that id is correct.
        spaceId = await joinNodeByLink(session, inv.token);
      } else {
        // member-bundle
        spaceId = (await acceptSpaceInvite(session, inv.inviteJson)).id;
      }
      if (source === 'auto-link' && Platform.OS === 'web' && typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      setPendingInvite(null);
      enterSpace(spaceId);
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
        const inv = await previewInvite(inviteFrag);
        let spaceId: string;
        if (inv.kind === 'space-link') {
          spaceId = (await joinSpaceByLink(session, inv.token)).id;
        } else if (inv.kind === 'node-link') {
          spaceId = await joinNodeByLink(session, inv.token);
        } else {
          spaceId = (await acceptSpaceInvite(session, inv.inviteJson)).id;
        }
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        enterSpace(spaceId);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, inviteFrag]);

  return (
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Join or create" onBack={() => router.back()} />}>
      <Txt variant="caption" mono uppercase tone="inkMuted">
        Start something new
      </Txt>
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

      <View style={styles.joinHeader}>
        <Divider />
        <Txt variant="caption" mono uppercase tone="inkMuted">
          Join an existing space
        </Txt>
      </View>

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

      <Card title="DISCOVER">
        <Txt variant="footnote" tone="inkSoft">
          Browse public spaces anyone can find, then ask an owner for an invitation link.
        </Txt>
        <Button
          label="Browse public spaces"
          variant="secondary"
          size="md"
          iconName="globe"
          onPress={() => router.push('/spaces/explore')}
        />
      </Card>

      <Card title="YOUR JOIN REQUEST">
        <Txt variant="footnote" tone="inkSoft">
          For private spaces: send this to an owner so they can invite you.
        </Txt>
        <CopyField value={myRequest} copyLabel="Copy join request" share shareTitle="My OctoChat join request" />
      </Card>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1 },
  joinHeader: { gap: spacing.sm, marginTop: spacing.xs },
});
