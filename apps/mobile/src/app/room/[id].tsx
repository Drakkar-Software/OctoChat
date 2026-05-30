import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { BackHandler, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useAutomationCommands } from '@/lib/automations/use-automation-commands';
import { useAutomationDriver } from '@/lib/automations/use-automation-driver';
import { useSession } from '@/lib/session-context';
import { useRoomsRegistry } from '@/lib/rooms-registry-context';
import { roomDraftKey } from '@/lib/use-draft';
import { useMessageEditing } from '@/lib/use-message-editing';
import { useRoom } from '@/lib/use-room';
import { useRoomSend } from '@/lib/use-room-send';
import { useStreamRoom } from '@/lib/use-stream-room';
import { useUnread } from '@/lib/unread-context';
import { spaceIdFromRoomId } from '@/lib/starfish/paths';
import { isPublicSpaceId, publicSpaceAuth } from '@/lib/starfish/pubspace';
import type { RoomKind } from '@/lib/types';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { AutomatedRoomSettingsSheet } from '@/components/chat/AutomatedRoomSettingsSheet';
import { AutomationHints } from '@/components/chat/AutomationHints';
import { Composer } from '@/components/chat/Composer';
import { ConversationSkeleton } from '@/components/chat/ConversationSkeleton';
import { DesktopChatTopbar } from '@/components/chat/DesktopChatTopbar';
import { OfflineBanner } from '@/components/chat/OfflineBanner';
import { ReadOnlyFooter } from '@/components/chat/ReadOnlyFooter';
import { RoomConversation } from '@/components/chat/RoomConversation';
import { StreamBotPanelWhenEmpty } from '@/components/chat/StreamBotPanel';
import { ThreadDigestPublisher } from '@/components/chat/ThreadDigestPublisher';

export default function RoomScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string; kind?: string }>();
  const id = params.id;
  const name = params.name ?? id;
  const kind = (params.kind ?? 'channel') as RoomKind;
  const { session } = useSession();
  const { markRoomRead, lastReadAt, hydrated } = useUnread();
  // A stream room is append-only (useStreamRoom); a channel/dm is a merge-doc room
  // (useRoom). An automated room is a stream room with a runner attached — same
  // pubstream storage, same hook. Both hooks are called unconditionally (React rules)
  // but only the one matching `kind` is `enabled` and does any work.
  const isAutomated = kind === 'automated';
  const isStream = kind === 'stream' || isAutomated;
  const channel = useRoom(id, { enabled: !isStream });
  const stream = useStreamRoom(id, { enabled: isStream });
  const { store, opening, openError, offline, reload, syncError, send, toggleReaction, editMessage, deleteMessage, pinMessage, unpinMessage, uploadAttachment, loadAttachment, canWrite } =
    isStream ? stream : channel;
  const { editingId, setEditingId, editLast } = useMessageEditing(store, session?.userId ?? '');
  // Offline outbox: route text sends through the queue when offline / on failure,
  // and surface this room's pending bubbles + retry. Attachments still need a
  // connection (handled in the Composer's onSend below).
  const { online, pending, retry, sendText } = useRoomSend({ roomId: id, kind, send });

  // Owner-only "Connect a bot" panel for a PUBLIC stream room (mints a createPublicLink
  // audience cap). Private streams enroll bots as keyring members instead, so no panel.
  const spaceId = spaceIdFromRoomId(id);

  // The space owner gates the per-message pin affordance, AND is the only author whose
  // pin events count when folding `pinned` at render (see resolvePinned) — so every
  // viewer needs it, not just the owner. Read from the shared registry (resolves for
  // owned, joined AND public spaces); `use-room`'s own registry read is null for joiners.
  const { owner, rooms } = useRoomsRegistry(spaceId);
  const automatedRoom = isAutomated ? rooms.find((r) => r.id === id) ?? null : null;
  // Drive scheduled ticks + slash-command replies while the room is foreground.
  // Both hooks no-op when the room isn't automated or the device isn't the elected
  // runner (`automation.runOnDeviceId !== session.keys.edPub`).
  useAutomationDriver({ session, room: automatedRoom });
  useAutomationCommands({ session, room: automatedRoom, store });
  const [showAutomationSheet, setShowAutomationSheet] = useState(false);
  const isOwner = !!owner && session?.userId === owner;
  const onPinMessage = (msgId: string, pin: boolean) => (pin ? pinMessage(msgId) : unpinMessage(msgId));
  const showBotPanel =
    isStream && !!session && isPublicSpaceId(spaceId) && publicSpaceAuth(session, spaceId).ownerId === session.userId;
  const title = kind === 'dm' ? name : `#${name}`;

  // The room's last-read mark as it stood at the START of this visit — re-captured
  // on EVERY focus. Messages and threads newer than it render as unread for the visit
  // (escalating an @mention's highlight) even after the room is marked read on open.
  // Capturing per focus — not once per mount — is what fixes thread badges sticking
  // unread on re-entry: returning from a thread (this screen stays mounted underneath)
  // or re-entering the room re-reads the now-advanced mark, so threads caught up since
  // stop reading unread.
  //
  // `null` until captured: the mark lives in kv and hydrates async (unread-context),
  // so on a fresh page load it isn't ready at mount. Capturing then would read 0 and
  // flash EVERY thread/message as unread. So we gate the capture on `hydrated` and
  // treat null as "all read" downstream — lazy-init to the real mark only when it's
  // already hydrated (room-to-room nav), avoiding a flash there too.
  const [readBefore, setReadBefore] = useState<number | null>(() =>
    hydrated ? lastReadAt(id) : null,
  );

  // Mark this room read whenever it becomes the focused screen — on first open AND on
  // returning to it after it sat backgrounded (where it accrues unread, since useRoom
  // only suppresses change-events while focused). Wait for `hydrated` so we snapshot
  // the persisted mark, not the empty-map 0; the effect re-runs when it flips true.
  // Snapshot readBefore FIRST: lastReadAt reads the very mark markRoomRead is about to
  // overwrite, so the order matters.
  useFocusEffect(
    useCallback(() => {
      if (!session || !hydrated) return;
      setReadBefore(lastReadAt(id));
      markRoomRead(id);
    }, [session, hydrated, id, lastReadAt, markRoomRead]),
  );

  // Cold-start entries (FCM tap, universal link, SSE toast click) push straight to
  // `/room/[id]` with no parent in the stack, so `router.back()` would no-op and the
  // arrow appears broken. Fall through to `/rooms` only when there's nothing to pop.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));

  // Android hardware back: same rule as the AppBar arrow — let RN pop normally
  // when a parent screen exists; otherwise redirect to `/rooms` and consume the
  // event so the OS doesn't background the app. Gated on focus so it only runs
  // when THIS room is the foreground screen. iOS has no hardware back, and on web
  // BackHandler is a no-op stub; both are fine, the listener simply never fires.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (router.canGoBack()) return false;
        router.replace('/(tabs)/rooms');
        return true;
      });
      return () => sub.remove();
    }, []),
  );
  const openThread = (msgId: string) =>
    router.push({ pathname: '/thread/[id]', params: { id: msgId, roomId: id, roomName: name, kind } });
  // Pass the room context so a public-stream room's space screen can surface the
  // owner-only "Connect a bot" panel for THIS room (the in-room panel hides once
  // the room has messages — see {@link StreamBotPanelWhenEmpty}). Automated rooms
  // route the info button to their dedicated settings sheet instead.
  const openMembers = () => {
    if (isAutomated) {
      setShowAutomationSheet(true);
      return;
    }
    router.push({ pathname: '/space/[id]', params: { id: spaceIdFromRoomId(id), roomId: id, roomKind: kind } });
  };
  const openSearch = () => router.push('/search');
  const openProfile = (userId: string) => router.push({ pathname: '/profile/[id]', params: { id: userId } });

  return (
    <StackScreen
      contentStyle={styles.content}
      header={
        <AppBar
          title={title}
          onBack={goBack}
          right={
            <>
              <IconButton name="search" accessibilityLabel="Search in room" onPress={openSearch} />
              <IconButton name="info" accessibilityLabel="Space details" onPress={openMembers} />
            </>
          }
        />
      }
      desktopHeader={<DesktopChatTopbar name={name} kind={kind} onSearch={openSearch} />}
      footer={
        canWrite ? (
          <Composer
            placeholder={`Message ${title}`}
            draftKey={session ? roomDraftKey(session.userId, id) : undefined}
            offline={!online}
            onSend={async (t, file) => {
              // A file needs a live upload — the Composer blocks this path while
              // offline (attachments aren't queued), so we only reach it online.
              if (file) {
                const ref = await uploadAttachment(file.bytes, file.name, file.mime);
                send(t, undefined, ref ?? undefined);
                return;
              }
              await sendText(t);
            }}
            onEditLast={editLast}
          />
        ) : (
          <ReadOnlyFooter />
        )
      }
    >
      {!session ? (
        <SignInPrompt subtitle="Create an identity to open encrypted rooms." />
      ) : opening ? (
        <ConversationSkeleton />
      ) : openError ? (
        // A DM open-error is almost always the known paired-device limitation: a QR-
        // paired device has a fresh keypair, so it's not a recipient of the DM space's
        // keyring (the peer sealed it to your SEED key). Surface that instead of the
        // generic keyring copy; the DM rehydrates + decrypts on your primary device.
        kind === 'dm' ? (
          <EmptyState
            iconName="alert"
            title="Open this DM on your primary device"
            subtitle="Direct messages are encrypted to your seed identity, so a paired device can’t unlock them yet."
          />
        ) : (
          <EmptyState iconName="alert" title="Couldn't open room" subtitle={openError}>
            <Button label="Try again" iconName="refresh" onPress={reload} />
          </EmptyState>
        )
      ) : store ? (
        <>
          {!online || offline ? (
            <OfflineBanner />
          ) : syncError ? (
            <Callout tone="warning" iconName="alert">
              {syncError}
            </Callout>
          ) : null}
          {showBotPanel ? (
            <StreamBotPanelWhenEmpty store={store} ownerId={session.userId} spaceId={spaceId} roomId={id} />
          ) : null}
          {automatedRoom ? <AutomationHints room={automatedRoom} /> : null}
          <RoomConversation
            store={store}
            spaceId={spaceIdFromRoomId(id)}
            currentUserId={session.userId}
            currentUserName={session.name}
            lastReadAt={readBefore ?? undefined}
            onToggleReaction={toggleReaction}
            onOpenThread={openThread}
            onEditMessage={editMessage}
            onDeleteMessage={deleteMessage}
            onPinMessage={onPinMessage}
            ownerId={owner ?? undefined}
            isOwner={isOwner}
            onOpenProfile={openProfile}
            onLoadAttachment={loadAttachment}
            pending={pending}
            onRetry={retry}
            editingId={editingId}
            onEditingChange={setEditingId}
          />
          {/* Publish this room's recent threads to the desktop sidebar (no UI).
              Stream rooms support threads too (replies are appended with a parentId),
              so this runs for every kind. */}
          <ThreadDigestPublisher store={store} roomId={id} readBefore={readBefore} />
        </>
      ) : (
        <EmptyState iconName="globe" title="Connecting…" />
      )}
      {session && automatedRoom && showAutomationSheet ? (
        <AutomatedRoomSettingsSheet
          session={session}
          room={automatedRoom}
          onClose={() => setShowAutomationSheet(false)}
          onDeleted={() => {
            setShowAutomationSheet(false);
            goBack();
          }}
        />
      ) : null}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.xs, paddingBottom: spacing.md },
});
