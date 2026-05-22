import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { useSpaceSettings } from '@/lib/use-space-settings';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';
import { QrCode } from '@/components/onboarding/QrCode';
import { SpaceMembersCard } from '@/components/chat/SpaceMembersCard';
import { SpaceMeta } from '@/components/chat/SpaceMeta';

function copy(text: string) {
  try {
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => void } } }).navigator?.clipboard?.writeText?.(text);
  } catch {
    /* ignore */
  }
}

function webOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return '';
}

export default function SpaceScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const spaceId = params.id;
  const { session } = useSession();
  const { spaces } = useSpaces();
  const space = spaces.find((s) => s.id === spaceId);
  const name = space?.name ?? params.name ?? 'Space';
  const { ownerId, isOwner, isMember, members, loading, isPublic, rename, invite, createInvite, leave } =
    useSpaceSettings(spaceId);
  const memberCount = 1 + members.length; // owner + roster (public spaces have no roster)

  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [request, setRequest] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteCap, setInviteCap] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; write: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await rename(draft ?? name);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const createPrivateInvite = async () => {
    if (inviting) return;
    setInviting(true);
    setError(null);
    try {
      setInviteCap(await invite(request.trim()));
      setRequest('');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setInviting(false);
    }
  };

  const createPublicLink = async (write: boolean) => {
    if (inviting) return;
    setInviting(true);
    setError(null);
    try {
      const url = await createInvite(write, name, webOrigin());
      setLink({ url, write });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setInviting(false);
    }
  };

  const doLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await leave();
      router.replace('/(tabs)/rooms');
    } catch {
      setLeaving(false);
    }
  };

  return (
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Space" onBack={() => router.back()} />}>
      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" />
      ) : (
        <>
          <Card title="INFORMATION">
            <Txt variant="title" weight="bold" numberOfLines={1}>
              {name}
            </Txt>
            <SpaceMeta isPublic={isPublic} memberCount={memberCount} iconSize={12} variant="footnote" />
            <Txt variant="caption" mono tone="inkMuted" numberOfLines={1}>
              {spaceId}
            </Txt>
          </Card>

          {isPublic ? null : (
            <SpaceMembersCard ownerId={ownerId} members={members} currentUserId={session.userId} />
          )}

          {loading ? null : isOwner ? (
            <>
              <Card title="SETTINGS">
                <Txt variant="footnote" tone="inkSoft">
                  Space name
                </Txt>
                <TextField
                  value={draft ?? name}
                  onChangeText={(t) => {
                    setDraft(t);
                    setSaved(false);
                  }}
                  placeholder="Space name…"
                  autoCapitalize="words"
                  autoCorrect={false}
                  onSubmitEditing={save}
                  returnKeyType="done"
                />
                <Button label={saving ? 'Saving…' : 'Save'} variant="primary" size="md" disabled={saving} onPress={save} />
                {saved ? (
                  <View style={styles.meta}>
                    <Icon name="check" size={12} color={colors.success} />
                    <Txt variant="footnote" tone="inkMuted">
                      Saved.
                    </Txt>
                  </View>
                ) : null}
              </Card>

              {isPublic ? (
                <Card title="INVITATION LINK">
                  <Callout tone="warning" iconName="unlock" title="Not end-to-end encrypted">
                    Anyone with the link can open this space without an account. A read &amp; write link also lets them post.
                  </Callout>
                  <View style={styles.typeRow}>
                    <Button
                      label="Read-only link"
                      variant="primary"
                      size="sm"
                      iconName="eye"
                      disabled={inviting}
                      onPress={() => createPublicLink(false)}
                    />
                    <Button
                      label="Read & write link"
                      variant="secondary"
                      size="sm"
                      iconName="edit"
                      disabled={inviting}
                      onPress={() => createPublicLink(true)}
                    />
                  </View>
                  {link ? (
                    <View style={styles.linkBox}>
                      <Txt variant="footnote" weight="semibold" center>
                        {link.write ? 'Read & write link' : 'Read-only link'}
                      </Txt>
                      <View style={styles.qr}>
                        <QrCode value={link.url} size={196} />
                      </View>
                      <CopyField label="Invitation link" value={link.url} copyLabel="Copy link" lines={3} />
                    </View>
                  ) : null}
                  {error ? (
                    <Txt variant="footnote" tone="inkMuted">
                      {error}
                    </Txt>
                  ) : null}
                </Card>
              ) : (
                <Card title="INVITE SOMEONE">
                  <Txt variant="footnote" tone="inkSoft">
                    Paste their join request (from “Join or create” on their device). They’ll get access to every channel.
                  </Txt>
                  <TextField
                    value={request}
                    onChangeText={setRequest}
                    placeholder="Paste join request…"
                    mono
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Button
                    label={inviting ? 'Creating…' : 'Create invite'}
                    variant="primary"
                    size="md"
                    disabled={inviting}
                    onPress={createPrivateInvite}
                  />
                  {error ? (
                    <Txt variant="footnote" tone="inkMuted">
                      {error}
                    </Txt>
                  ) : null}
                  {inviteCap ? (
                    <View style={styles.inviteBox}>
                      <Txt variant="micro" weight="semibold" mono uppercase tone="inkSoft">
                        Invite — send to your invitee
                      </Txt>
                      <Txt variant="caption" mono tone="inkSoft" numberOfLines={4}>
                        {inviteCap}
                      </Txt>
                      {Platform.OS === 'web' ? (
                        <Button label="Copy invite" variant="secondary" size="sm" iconName="copy" onPress={() => copy(inviteCap)} />
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              )}
            </>
          ) : isMember ? (
            <Card title="MEMBERSHIP">
              <Txt variant="footnote" tone="inkSoft">
                {isPublic ? 'You joined this public space via an invitation link.' : 'You’re a member of this space.'}
              </Txt>
              <Button
                label={leaving ? 'Leaving…' : 'Leave space'}
                variant="danger"
                size="md"
                disabled={leaving}
                onPress={doLeave}
              />
            </Card>
          ) : null}
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inviteBox: { gap: spacing.sm },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  linkBox: { gap: spacing.md },
  qr: { alignItems: 'center', paddingVertical: spacing.sm },
});
