import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { webOrigin } from '@/lib/links';
import { isDmSpaceId } from '@drakkar.software/octochat-sdk';
import { useMutes } from '@/lib/mutes-context';
import { automationBotUserIds, useRooms } from '@/lib/use-rooms';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { useSpaceSettings } from '@/lib/use-space-settings';
import { useSpaceStats } from '@/lib/use-space-stats';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Avatar } from '@/components/ui/Avatar';
import { EditableAvatar } from '@/components/ui/EditableAvatar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { Icon } from '@/components/ui/Icon';
import { LinkQrCode } from '@/components/ui/LinkQrCode';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Txt } from '@/components/ui/Txt';
import { CategoryManager } from '@/components/chat/CategoryManager';
import { SpaceMembersCard } from '@/components/chat/SpaceMembersCard';
import { SpaceMeta } from '@/components/chat/SpaceMeta';
import { SpaceStatsCard } from '@/components/chat/SpaceStatsCard';
import { WebhookPanel } from '@/components/chat/WebhookPanel';

function copy(text: string) {
  try {
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => void } } }).navigator?.clipboard?.writeText?.(text);
  } catch {
    /* ignore */
  }
}

export default function SpaceScreen() {
  const { colors } = useTheme();
  // `roomId`+`roomKind` are set by the room screen's info button so the owner of
  // a public stream room can reach the "Connect a bot" panel from here once the
  // in-room panel has hidden itself (rooms with messages don't carry it).
  const params = useLocalSearchParams<{ id: string; name?: string; roomId?: string; roomKind?: string }>();
  const spaceId = params.id;
  // A DM space is a 1:1 conversation rendered AS a space (see starfish/dm.ts). It has
  // no categories to manage and no one to invite — the peer is already its sole member —
  // so those owner cards are hidden for it.
  const isDm = isDmSpaceId(spaceId);
  const fromRoomId = params.roomId;
  const { session } = useSession();
  const { spaces } = useSpaces();
  const space = spaces.find((s) => s.id === spaceId);
  const name = space?.name ?? params.name ?? 'Space';
  const shortLabel = space?.short ?? name.slice(0, 2).toUpperCase();
  const {
    ownerId,
    isOwner,
    isMember,
    members,
    loading,
    nameDraft,
    setNameDraft,
    imageDraft,
    pickImage,
    removeImage,
    imageError,
    dirty,
    saving,
    save,
    invite,
    createInvite,
    leave,
  } = useSpaceSettings(spaceId);
  // Gate on `!loading` too: `isOwner` is optimistically true until useSpaceSettings
  // resolves real ownership (ownerId starts null), so without it a non-owner would
  // fire the per-room fan-out once before the gate flips false.
  const { stats: spaceStats, loading: statsLoading } = useSpaceStats(spaceId, isOwner && !loading);
  // Category management (owner-only Card below). Shares the same registry the rooms
  // list reads — actions are owner-gated + refresh on success (see useRooms).
  const { rooms, categories, createCategory, renameCategory, deleteCategory, reorderCategories } = useRooms(spaceId);
  // In the per-node model, spaces are always member-based (access distinction is per-room).
  const fromRoom = fromRoomId ? rooms.find((r) => r.id === fromRoomId) : undefined;
  const fromRoomIsPublic = fromRoom?.access === 'public';
  // Automation bots are real roster members (private spaces) — drop them from the human roster so
  // the count + members list don't show phantom, profile-less members.
  const botIds = useMemo(() => new Set(automationBotUserIds(rooms)), [rooms]);
  const humanMembers = useMemo(() => members.filter((id) => !botIds.has(id)), [members, botIds]);
  const memberCount = 1 + humanMembers.length; // owner + roster (public spaces have no roster)

  // Per-user mute prefs (synced). Surfaced for every member: silence the whole space
  // (also drops its native FCM topic) or just the room the user navigated from.
  const { isSpaceMuted, isRoomMuted, setSpaceMuted, setRoomMuted } = useMutes();
  const fromRoomName = fromRoomId ? rooms.find((r) => r.id === fromRoomId)?.name : undefined;

  const [saved, setSaved] = useState(false);
  const [request, setRequest] = useState('');
  const [inviting, setInviting] = useState(false);
  // Which public link is currently being minted (null = none) — drives the
  // per-button "Generating…" spinner so the keygen wait reads as working.
  const [genWrite, setGenWrite] = useState<boolean | null>(null);
  const [inviteCap, setInviteCap] = useState<string | null>(null);
  // Private-invite QR is collapsed by default — the cap text is the source of
  // truth (copy/paste always works); the QR is a convenience for a second device
  // physically present. Re-collapses whenever a new cap is minted.
  const [showQr, setShowQr] = useState(false);
  const [link, setLink] = useState<{ url: string; write: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Clear the "Saved." note as soon as the form is dirtied again (name or image).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: drop the transient "Saved." note the moment the form is re-dirtied
    if (dirty) setSaved(false);
  }, [dirty]);

  const onSave = async () => {
    await save();
    setSaved(true);
  };

  const createPrivateInvite = async () => {
    if (inviting) return;
    setInviting(true);
    setError(null);
    try {
      setInviteCap(await invite(request.trim()));
      setShowQr(false);
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
    setGenWrite(write);
    setError(null);
    try {
      const url = await createInvite(write, name, webOrigin());
      setLink({ url, write });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setInviting(false);
      setGenWrite(null);
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
        <SignInPrompt />
      ) : (
        <>
          <Card title="INFORMATION">
            <View style={styles.identity}>
              <Avatar label={shortLabel} image={space?.image} size={48} />
              <View style={styles.identityText}>
                <Txt variant="title" weight="bold" numberOfLines={1}>
                  {name}
                </Txt>
                <SpaceMeta isPublic={false} memberCount={memberCount} iconSize={12} variant="footnote" />
              </View>
            </View>
            <View style={styles.idLine}>
              <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
                ID
              </Txt>
              <Txt variant="micro" mono tone="inkFaint" numberOfLines={1} style={styles.idValue}>
                {spaceId}
              </Txt>
            </View>
          </Card>

          <Card title="NOTIFICATIONS">
            <ToggleRow
              iconName="volume-off"
              title="Mute space"
              detail="Silence notifications for every room in this space"
              value={isSpaceMuted(spaceId)}
              onValueChange={(next) => setSpaceMuted(spaceId, next)}
            />
            {fromRoomId ? (
              <ToggleRow
                iconName="volume-off"
                title={fromRoomName ? `Mute #${fromRoomName}` : 'Mute this room'}
                detail="Silence notifications for this room only"
                value={isRoomMuted(fromRoomId)}
                // Whole-space mute already covers this room; keep it from reading as a
                // separate control the user can fight with.
                disabled={isSpaceMuted(spaceId)}
                onValueChange={(next) => setRoomMuted(fromRoomId, next)}
              />
            ) : null}
          </Card>

          <SpaceMembersCard ownerId={ownerId} members={humanMembers} currentUserId={session.userId} />

          {loading ? null : isOwner ? (
            <>
              <Card title="SETTINGS">
                <EditableAvatar
                  label={shortLabel}
                  image={imageDraft}
                  onPick={pickImage}
                  onRemove={removeImage}
                  error={imageError}
                  accessibilityLabel="Change space image"
                  uploadLabel="Upload image"
                  changeLabel="Change image"
                >
                  <Txt variant="footnote" tone="inkSoft">
                    Space image
                  </Txt>
                </EditableAvatar>

                <Txt variant="footnote" tone="inkSoft">
                  Space name
                </Txt>
                <TextField
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Space name…"
                  autoCapitalize="words"
                  autoCorrect={false}
                  onSubmitEditing={onSave}
                  returnKeyType="done"
                />
                <Button
                  label={saving ? 'Saving…' : 'Save'}
                  variant="primary"
                  size="md"
                  disabled={saving || !dirty}
                  onPress={onSave}
                />
                {saved ? (
                  <View style={styles.meta}>
                    <Icon name="check" size={12} color={colors.success} />
                    <Txt variant="footnote" tone="inkMuted">
                      Saved.
                    </Txt>
                  </View>
                ) : null}
              </Card>

              <SpaceStatsCard stats={spaceStats} loading={statsLoading} />

              {isDm ? null : (
                <Card title="CATEGORIES">
                  <Txt variant="footnote" tone="inkSoft">
                    Group channels into categories. Drag a channel onto a category (or long-press it) to move it.
                  </Txt>
                  <CategoryManager
                    categories={categories.map((c) => c.name)}
                    onCreate={createCategory}
                    onRename={renameCategory}
                    onDelete={deleteCategory}
                    onReorder={reorderCategories}
                  />
                </Card>
              )}

              {isDm ? null : (
                <Card title="INVITE SOMEONE">
                  <Txt variant="footnote" tone="inkSoft">
                    Paste their join request (from "Join or create" on their device). They'll get access to every channel.
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
                  <Txt variant="footnote" tone="inkSoft" style={styles.orDivider}>
                    or share an invitation link:
                  </Txt>
                  <View style={styles.typeRow}>
                    <Button
                      label={genWrite === false ? 'Generating…' : 'Read-only link'}
                      variant="secondary"
                      size="sm"
                      iconName="eye"
                      loading={genWrite === false}
                      disabled={genWrite === true}
                      onPress={() => createPublicLink(false)}
                    />
                    <Button
                      label={genWrite === true ? 'Generating…' : 'Read & write link'}
                      variant="secondary"
                      size="sm"
                      iconName="edit"
                      loading={genWrite === true}
                      disabled={genWrite === false}
                      onPress={() => createPublicLink(true)}
                    />
                  </View>
                  {link ? (
                    <View style={styles.linkBox}>
                      <Txt variant="footnote" weight="semibold" center>
                        {link.write ? 'Read & write link' : 'Read-only link'}
                      </Txt>
                      <LinkQrCode value={link.url} />
                      <CopyField label="Invitation link" value={link.url} copyLabel="Copy link" lines={3} />
                    </View>
                  ) : null}
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
                      <View style={styles.typeRow}>
                        {Platform.OS === 'web' ? (
                          <Button label="Copy invite" variant="secondary" size="sm" iconName="copy" onPress={() => copy(inviteCap)} />
                        ) : null}
                        <Button
                          label={showQr ? 'Hide QR' : 'Show QR'}
                          variant="secondary"
                          size="sm"
                          iconName="qr-scan"
                          onPress={() => setShowQr((s) => !s)}
                        />
                      </View>
                      {showQr ? <LinkQrCode value={inviteCap} maxBytes={2500} /> : null}
                    </View>
                  ) : null}
                </Card>
              )}

              {/* Owner-only SELF-SERVICE inbound webhooks for the navigated-from room:
                  mint a paste-able URL + one-time token any external tool can POST to.
                  Public rooms only (plaintext append-only log the server can write). */}
              {fromRoomIsPublic && fromRoomId ? (
                <WebhookPanel spaceId={spaceId} roomId={fromRoomId} />
              ) : null}
            </>
          ) : isMember ? (
            <Card title="MEMBERSHIP">
              <Txt variant="footnote" tone="inkSoft">
                You're a member of this space.
              </Txt>
              <Button
                label={leaving ? 'Leaving…' : 'Leave space'}
                variant="danger"
                size="md"
                disabled={leaving}
                onPress={doLeave}
              />
            </Card>
          ) : (
            <Card title="ACCESS">
              <Callout tone="info" iconName="key" title="You're not a member yet">
                You're viewing this space's details. Join with an invitation link from its owner.
              </Callout>
            </Card>
          )}
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: spacing.xs },
  idLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  idValue: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inviteBox: { gap: spacing.sm },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  linkBox: { gap: spacing.md },
  orDivider: { marginTop: spacing.sm },
});
