import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { WEB_BASE } from '@/lib/octochat-config';
import { isDmSpaceId } from '@drakkar.software/octochat-sdk';
import { useMutes } from '@/lib/mutes-context';
import { useRooms } from '@/lib/use-rooms';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { useSpaceSettings } from '@/lib/use-space-settings';
import { useSpaceStats } from '@/lib/use-space-stats';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { Icon } from '@/components/ui/Icon';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Txt } from '@/components/ui/Txt';
import { QrCode } from '@/components/onboarding/QrCode';
import { CategoryManager } from '@/components/chat/CategoryManager';
import { SpaceMembersCard } from '@/components/chat/SpaceMembersCard';
import { SpaceMeta } from '@/components/chat/SpaceMeta';
import { SpaceStatsCard } from '@/components/chat/SpaceStatsCard';
import { StreamBotPanel } from '@/components/chat/StreamBotPanel';

function copy(text: string) {
  try {
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => void } } }).navigator?.clipboard?.writeText?.(text);
  } catch {
    /* ignore */
  }
}

/** Origin for shareable invite links: the live web origin on web, else the
 *  configured universal-links domain (`WEB_BASE`) so native invites are full
 *  `https://<domain>/join#…` URLs that open the app. '' yields a host-less link. */
function webOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return WEB_BASE;
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
  const fromRoomIsStream = params.roomKind === 'stream';
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
    isPublic,
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
  const memberCount = 1 + members.length; // owner + roster (public spaces have no roster)

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
            <Txt variant="title" weight="bold" numberOfLines={1}>
              {name}
            </Txt>
            <SpaceMeta isPublic={isPublic} memberCount={memberCount} iconSize={12} variant="footnote" />
            <Txt variant="caption" mono tone="inkMuted" numberOfLines={1}>
              {spaceId}
            </Txt>
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

          {isPublic ? null : (
            <SpaceMembersCard ownerId={ownerId} members={members} currentUserId={session.userId} />
          )}

          {loading ? null : isOwner ? (
            <>
              <Card title="SETTINGS">
                <View style={styles.imageRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change space image"
                    onPress={pickImage}
                    style={styles.imageWrap}
                  >
                    <Avatar label={shortLabel} image={imageDraft} size={68} />
                    <View style={[styles.cameraBadge, { backgroundColor: colors.accent, borderColor: colors.paper }]}>
                      <Icon name="camera" size={12} color={colors.onAccent} />
                    </View>
                  </Pressable>
                  <View style={styles.imageText}>
                    <Txt variant="footnote" tone="inkSoft">
                      Space image
                    </Txt>
                    <View style={styles.imageActions}>
                      <Pressable accessibilityRole="button" onPress={pickImage} hitSlop={6}>
                        <Txt variant="footnote" weight="semibold" tone="accent">
                          {imageDraft ? 'Change image' : 'Upload image'}
                        </Txt>
                      </Pressable>
                      {imageDraft ? (
                        <Pressable accessibilityRole="button" onPress={removeImage} hitSlop={6}>
                          <Txt variant="footnote" weight="semibold" tone="danger">
                            Remove
                          </Txt>
                        </Pressable>
                      ) : null}
                    </View>
                    {imageError ? (
                      <Txt variant="micro" tone="danger">
                        {imageError}
                      </Txt>
                    ) : null}
                  </View>
                </View>

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

              {isDm ? null : isPublic ? (
                <Card title="INVITATION LINK">
                  <Callout tone="warning" iconName="unlock" title="Not end-to-end encrypted">
                    Anyone with the link can open this space without an account. A read &amp; write link also lets them post.
                  </Callout>
                  <View style={styles.typeRow}>
                    <Button
                      label={genWrite === false ? 'Generating…' : 'Read-only link'}
                      variant="primary"
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
                      {/* Public-invite links pack ~1.3 KB (member cap + ephemeral key + space id)
                          into the URL fragment — at the pairing QR's defaults (small render,
                          ecl="M", 22% center mark) the modules end up sub-2px and the logo blots
                          out the dense center, so no scanner can read it. Render bigger, drop the
                          mark, and use ecl="L" so the picked QR version stays low (bigger modules). */}
                      <View style={styles.qr}>
                        <QrCode value={link.url} size={280} ecl="L" hideMark />
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
                      {showQr ? (
                        inviteCap.length > 2500 ? (
                          // react-native-qrcode-svg at ecl="L" tops out around 2953 bytes
                          // (Version 40 binary capacity); private-invite JSON carries a hex
                          // Kyber pubkey + Ed25519 sig and can sit on that edge. Fall back
                          // to copy/paste instead of rendering a code scanners can't read.
                          <Callout tone="warning" iconName="alert" title="Invite too large for a QR">
                            Copy/paste the invite instead — scanners can&apos;t read codes this dense.
                          </Callout>
                        ) : (
                          // Same size class as the public-invite QR above — render bigger,
                          // drop the center mark, and use ecl="L" so the picked QR version
                          // stays low (bigger modules) and stays scannable.
                          <View style={styles.qr}>
                            <QrCode value={inviteCap} size={280} ecl="L" hideMark />
                          </View>
                        )
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              )}

              {/* Owner-only "Connect a bot" panel for the room the user navigated
                  from — surfaced here once the in-room panel hides itself (rooms
                  with messages don't carry it, see {@link StreamBotPanelWhenEmpty}).
                  Public-stream-only: private stream rooms enroll bots as keyring
                  members instead, so no link-cap minting applies. */}
              {isPublic && fromRoomIsStream && fromRoomId ? (
                <StreamBotPanel ownerId={session.userId} spaceId={spaceId} roomId={fromRoomId} />
              ) : null}
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
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  imageWrap: { position: 'relative' },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageText: { flex: 1, gap: 2 },
  imageActions: { flexDirection: 'row', gap: spacing.md, marginTop: 2 },
  inviteBox: { gap: spacing.sm },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  linkBox: { gap: spacing.md },
  qr: { alignItems: 'center', paddingVertical: spacing.sm },
});
