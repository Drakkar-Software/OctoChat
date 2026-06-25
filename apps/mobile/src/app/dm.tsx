import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { createDmViaLink, decodeIdentityLink, verifyIdentityLinkBinding, type IdentityLink } from '@drakkar.software/octochat-sdk';
import { useInviteFragment } from '@/lib/use-invite-link';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { ProfileHero } from '@/components/ui/ProfileHero';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

/**
 * Landing screen for "DM me" links (`…/dm#<token>`): shows whose link this is and
 * starts the DM on an explicit tap — opening a link must never silently create a
 * conversation. All flow logic lives in the SDK's `createDmViaLink` (dedup,
 * delivery, registration); this page only decodes the fragment, VERIFIES its
 * identity binding before showing anything about the owner, waits for a session
 * (the fragment survives onboarding exactly like /join's), and maps outcomes onto
 * navigation/copy.
 */
export default function DmLinkScreen() {
  const { session } = useSession();
  const inviteFrag = useInviteFragment();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decode once per fragment; a malformed link renders as an error, not a crash.
  const { token, decodeError } = useMemo((): { token: IdentityLink | null; decodeError: string | null } => {
    if (!inviteFrag || inviteFrag === '#') return { token: null, decodeError: null };
    try {
      return { token: decodeIdentityLink(inviteFrag.replace(/^#/, '')), decodeError: null };
    } catch (e) {
      return { token: null, decodeError: String((e as Error)?.message ?? e) };
    }
  }, [inviteFrag]);

  // Verify the offline identity binding (ownerId == sha256(edPub)) BEFORE rendering
  // the owner's profile — a tampered token must never show a misleading identity.
  // `null` = checking, `false` = bound to a forged id (treat as invalid).
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    if (!token || !session) return;
    let cancelled = false;
    setVerified(null);
    void verifyIdentityLinkBinding(token, session).then((ok) => {
      if (!cancelled) setVerified(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [token, session]);

  const ownerId = token?.ownerId ?? '';
  // Only fetch + show the profile once the binding is verified. The live pseudo
  // wins when resolved (undefined until then); the link's embedded pseudo is the
  // fallback, the hex prefix the last resort — no coupling to a fallback format.
  const livePseudo = usePseudos(verified ? [ownerId] : [])(ownerId)?.trim();
  const avatar = useAvatars(verified ? [ownerId] : [])(ownerId);
  const name = livePseudo || token?.pseudo?.trim() || (ownerId ? ownerId.slice(0, 8) : 'someone');
  const handle = livePseudo ? `@${livePseudo}` : `@${ownerId.slice(0, 6)}`;
  const isSelf = !!session && !!token && token.ownerId === session.userId;

  const startDm = async () => {
    if (!session || !token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { roomId } = await createDmViaLink(session, token, name);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // Clear the consumed credential from the address bar (the /join pattern).
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      router.replace({ pathname: '/room/[id]', params: { id: roomId, name, kind: 'dm' } });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));

  const invalid = !!token && verified === false;

  return (
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Direct message" onBack={goBack} />}>
      {!token ? (
        decodeError ? (
          <Callout tone="danger" iconName="alert" title="Invalid DM link">
            {decodeError}
          </Callout>
        ) : (
          <Txt variant="footnote" tone="inkMuted">
            Open someone’s DM link to start an encrypted conversation with them.
          </Txt>
        )
      ) : invalid ? (
        <Callout tone="danger" iconName="alert" title="Invalid DM link">
          This link’s identity doesn’t check out — its keys don’t match its address. Ask for a fresh link.
        </Callout>
      ) : verified === null ? (
        <Txt variant="footnote" tone="inkMuted">
          Checking link…
        </Txt>
      ) : !session ? (
        <SignInPrompt subtitle={`Create an identity to message ${name}.`} />
      ) : isSelf ? (
        <Callout tone="info" iconName="dm" title="This is your own DM link">
          Share it with others so they can message you.
        </Callout>
      ) : (
        <>
          <ProfileHero name={name} handle={handle} avatarLabel={name.slice(0, 2).toUpperCase()} image={avatar} />
          <View style={styles.actions}>
            <Button
              label={busy ? 'Starting…' : `Message ${name}`}
              iconName="dm"
              variant="primary"
              size="lg"
              full
              loading={busy}
              onPress={startDm}
            />
            <Txt variant="footnote" tone="inkMuted">
              End-to-end encrypted. They shared this link so anyone holding it can DM them; your name will be visible to
              them.
            </Txt>
          </View>
          {error ? (
            <Callout tone="danger" iconName="alert">
              {error}
            </Callout>
          ) : null}
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  actions: { gap: spacing.sm },
});
