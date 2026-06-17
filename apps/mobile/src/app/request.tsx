import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useRequestLink } from '@/lib/use-request-link';
import { useResourceRequest, type RequestNodeType } from '@/lib/use-resource-request';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { ProfileHero } from '@/components/ui/ProfileHero';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

const NODE_TYPES = [
  { key: 'room' as const, label: 'Private room' },
  { key: 'ticket' as const, label: 'Support ticket' },
] as const;

/**
 * Landing screen for request links (`…/request?s=<spaceId>#<token>`).
 *
 * An authenticated user opens this link to request a **private room** or a **support
 * ticket** inside a space they are NOT a member of. The owner reviews the request in
 * their Requests shelf and accepts or declines it. If accepted, the user gets an
 * isolated per-node invite — they can chat in that one room without joining the space.
 *
 * Link verification + request-link reconstruction live in {@link useRequestLink};
 * submit/claim lifecycle lives in {@link useResourceRequest}.
 */
export default function RequestScreen() {
  // usePseudos/useAvatars read a module cache the React Compiler can't track; opt out.
  'use no memo';

  const { session } = useSession();
  const { s: spaceId } = useLocalSearchParams<{ s?: string }>();

  const { token, decodeError, verified, invalid, ownerId, ownerName, avatar, requestLink } =
    useRequestLink(spaceId);

  const [nodeType, setNodeType] = useState<RequestNodeType>('room');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { submit, busy, claimed } = useResourceRequest();

  // Once the owner accepts, navigate to the newly granted room automatically.
  useEffect(() => {
    if (claimed.length === 0) return;
    const grant = claimed[0];
    router.replace({
      pathname: '/room/[id]',
      params: {
        id: grant.nodeId,
        name,
        kind: 'channel',
        spaceId: grant.spaceId,
        access: 'invite',
        enc: '0', // resource-request rooms are plaintext (enc:false) in Phase 1–4
      },
    });
  }, [claimed, name]);

  const handleSubmit = async () => {
    if (!session || !requestLink || busy) return;
    const requesterName = session.userId.slice(0, 8);
    const err = await submit({
      type: nodeType,
      requestLink,
      title: name.trim(),
      requester: requesterName,
      message: message.trim() || undefined,
    });
    if (err) {
      setSubmitError(err);
    } else {
      setSubmitted(true);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));
  const livePseudo = ownerName !== ownerId.slice(0, 8) ? ownerName : undefined;

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Request access" onBack={goBack} />}
    >
      {!token ? (
        decodeError ? (
          <Callout tone="danger" iconName="alert" title="Invalid request link">
            {decodeError}
          </Callout>
        ) : (
          <Txt variant="footnote" tone="inkMuted">
            Open a request link to ask for access to a space.
          </Txt>
        )
      ) : invalid ? (
        <Callout tone="danger" iconName="alert" title="Invalid request link">
          This link's identity doesn't check out — its keys don't match the owner's address. Ask for a fresh link.
        </Callout>
      ) : verified === null ? (
        <Txt variant="footnote" tone="inkMuted">
          Checking link…
        </Txt>
      ) : !session ? (
        <SignInPrompt subtitle={`Create an identity to request access from ${ownerName}.`} />
      ) : submitted ? (
        <>
          <ProfileHero
            name={ownerName}
            handle={`@${livePseudo ?? ownerId.slice(0, 6)}`}
            avatarLabel={ownerName.slice(0, 2).toUpperCase()}
            image={avatar}
          />
          <Callout tone="info" iconName="clock" title="Request sent">
            {`Your ${nodeType === 'room' ? 'room request' : 'ticket'} was sent to ${ownerName}. You'll get access once they accept it.`}
          </Callout>
          <Button
            label="Go home"
            variant="secondary"
            onPress={() => router.replace('/(tabs)/rooms')}
          />
        </>
      ) : (
        <>
          <ProfileHero
            name={ownerName}
            handle={`@${livePseudo ?? ownerId.slice(0, 6)}`}
            avatarLabel={ownerName.slice(0, 2).toUpperCase()}
            image={avatar}
          />

          <View style={styles.form}>
            <SegmentedControl
              segments={NODE_TYPES}
              selected={nodeType}
              onSelect={setNodeType}
            />

            <TextField
              value={name}
              onChangeText={setName}
              placeholder={nodeType === 'room' ? 'Room name…' : 'Ticket subject…'}
              leadingIcon={nodeType === 'room' ? 'hash' : 'dm'}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />

            <TextField
              value={message}
              onChangeText={setMessage}
              placeholder={
                nodeType === 'room'
                  ? 'Why do you need this room? (optional)'
                  : 'Describe the issue… (optional)'
              }
              multiline
              autoCapitalize="sentences"
            />

            {submitError ? (
              <Callout tone="danger" iconName="alert">
                {submitError}
              </Callout>
            ) : null}

            <Button
              label={
                busy
                  ? 'Sending…'
                  : nodeType === 'room'
                    ? 'Request private room'
                    : 'Submit ticket'
              }
              variant="primary"
              size="lg"
              full
              loading={busy}
              disabled={busy || !name.trim()}
              onPress={() => void handleSubmit()}
            />

            <Txt variant="footnote" tone="inkMuted">
              {nodeType === 'room'
                ? `${ownerName} will review your request. If accepted, you'll get a private room in their space — no membership required.`
                : `${ownerName} will review your ticket. You'll get access to a private support thread once it's opened.`}
            </Txt>
          </View>
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  form: { gap: spacing.md },
});
