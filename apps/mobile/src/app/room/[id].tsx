import { useCallback, useMemo, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { motion, spacing } from '@/theme';
import { useAutomationCommands } from '@/lib/automations/use-automation-commands';
import { useAutomationDriver } from '@/lib/automations/use-automation-driver';
import { useIsAutomationLeader } from '@/lib/automations/leader';
import { useArchivedDms } from '@/lib/use-archived-dms';
import { useSession } from '@/lib/session-context';
import { useRoomsRegistry } from '@/lib/rooms-registry-context';
import { roomDraftKey, threadDraftKey } from '@/lib/use-draft';
import { useMessageEditing } from '@/lib/use-message-editing';
import { useHardwareBack } from '@/lib/use-hardware-back';
import { composeSend } from '@/lib/compose-send';
import { useRoom } from '@/lib/use-room';
import { useRoomSend } from '@/lib/use-room-send';
import { useUnread } from '@/lib/unread-context';
import { spaceIdFromRoomId, kvSet } from '@drakkar.software/octochat-sdk';
import type { NodeAccess, RoomKind, StoredMsg } from '@drakkar.software/octochat-sdk';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';
import { buildSuggestionMessages } from '@drakkar.software/octochat-sdk';
import { makeEmptyConversationStore } from '@/lib/use-conversation-data';

// Stable empty store so useStarfishData can be called unconditionally while the
// real store is still null (room opening). Created once at module scope.
const EMPTY_STORE = makeEmptyConversationStore();
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { Reveal } from '@/components/ui/Reveal';
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
import { WebhookPanelWhenEmpty } from '@/components/chat/WebhookPanel';
import { ThreadDigestPublisher } from '@/components/chat/ThreadDigestPublisher';
import { TicketActionsSheet } from '@/components/desk/TicketActionsSheet';
import { useFeature } from '@/lib/use-feature';
import { useTickets } from '@/lib/use-tickets';

export default function RoomScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string; kind?: string; spaceId?: string; access?: string; enc?: string }>();
  const id = params.id;
  const name = params.name ?? id;
  // A ticket id (`ticket-<hex>`) embeds no space segment, so spaceIdFromRoomId can't recover
  // its space — the ticket list passes `spaceId` explicitly. Normal room ids (`sp-<rand>-…`)
  // carry it, so the derivation is the fallback when no param is present.
  const spaceId = params.spaceId ?? spaceIdFromRoomId(id);
  const { session } = useSession();
  const { markRoomRead, lastReadAt, hydrated } = useUnread();
  // `kind` drives the title/icon + automated-room behaviour, so it MUST be authoritative.
  // A notification open carries no `kind` on the wire (chat is E2EE) and the route param
  // then defaults to 'channel'. The shared rooms registry (resolves for owned, joined AND
  // public spaces) is the source of truth; the route param is only an interim fallback
  // while the registry read settles.
  const { owner, rooms, loading: registryLoading, loaded: registryLoaded } = useRoomsRegistry(spaceId);
  const registryRoom = rooms.find((r) => r.id === id) ?? null;
  const kind = (registryRoom?.kind ?? params.kind ?? 'channel') as RoomKind;
  // Tickets live OUTSIDE the rooms registry (a separate shelf), so registryRoom is null for
  // them and their access tier can't be resolved from there — the ticket list passes
  // `access`/`enc` as params. Normal rooms resolve from the registry; the params are only the
  // fallback. Without the correct `access: 'invite'`, the open path can't reach the per-node
  // objinvlog stream (and the owner self-heal in useRoomOpen never runs).
  const access = registryRoom?.access ?? (params.access as NodeAccess | undefined);
  const enc = registryRoom?.enc ?? (params.enc === '1' ? true : params.enc === '0' ? false : undefined);
  // Every room is an append-only log now — one hook for all kinds. An automated room
  // additionally has a runner attached (driven below) + its own settings sheet.
  const isAutomated = kind === 'automated';
  const { store, opening, openError, offline, reload, syncError, send, toggleReaction, editMessage, deleteMessage, pinMessage, unpinMessage, uploadAttachment, loadAttachment, canWrite } =
    useRoom(id, { access, enc, owner: owner ?? null, spaceId });
  const { editingId, setEditingId, editLast } = useMessageEditing(store, session?.userId ?? '');
  // Offline outbox: route text sends through the queue when offline / on failure,
  // and surface this room's pending bubbles + retry. Attachments still need a
  // connection (handled in the Composer's onSend below).
  const { online, pending, retry, sendText } = useRoomSend({ roomId: id, kind, send });

  // `owner`/`rooms` come from the shared registry read above (the kind source of
  // truth). `owner` gates the per-message pin affordance AND is the only author whose
  // pin events count when folding `pinned` at render (see resolvePinned), so every
  // viewer needs it — `use-room`'s own registry read is null for joiners.
  // Owner-only "Connect a bot" panel for a PUBLIC stream room is gated below.
  const automatedRoom = isAutomated ? registryRoom : null;
  // Drive scheduled ticks + slash-command replies while the room is foreground.
  // Both hooks no-op when the room isn't automated or the device isn't the elected
  // runner (`automation.runOnDeviceId !== session.keys.edPub`). `isLeader` further
  // serializes across same-account instances (two web tabs share an edPub) so one
  // instance ticks / replies, not both (see leader.ts).
  const isLeader = useIsAutomationLeader(isAutomated ? id : null);
  useAutomationDriver({ session, room: automatedRoom, active: isLeader });
  useAutomationCommands({ session, room: automatedRoom, store, active: isLeader });
  const [showAutomationSheet, setShowAutomationSheet] = useState(false);
  const isOwner = !!owner && session?.userId === owner;
  const onPinMessage = (msgId: string, pin: boolean) => (pin ? pinMessage(msgId) : unpinMessage(msgId));

  // Ticket detection — only active when the space has the 'tickets' capability.
  // Tickets open as kind:'channel' so the room screen doesn't know they're tickets;
  // we detect by looking up the room in the object index.
  const hasTickets = useFeature('tickets');
  const { tickets, setStatus: setTicketStatus, archive: archiveTicket } = useTickets(hasTickets ? spaceId : null);
  const ticketEntry = tickets.find((t) => t.node.id === id) ?? null;
  const [showTicketSheet, setShowTicketSheet] = useState(false);

  // DM archive toggle — only used when kind === 'dm'.
  const { isDmArchived, setDmArchived } = useArchivedDms();
  const dmArchived = kind === 'dm' ? isDmArchived(spaceId) : false;
  const toggleDmArchive = () => {
    const nowArchiving = !dmArchived;
    setDmArchived(spaceId, nowArchiving);
    // Return to the DM list when archiving (same as a channel being deleted from view).
    if (nowArchiving) goBack();
  };
  // Offer the "Connect a bot" panel only to the owner of a PUBLIC room — webhook
  // delivery is hardwired to `streampub`, so a webhook on a non-public room would
  // post into `streampub` while the room reads from `streamchat` (silent black hole).
  // Mirrors the same guard in space/[id].tsx (fromRoom?.access === 'public').
  const showBotPanel =
    !!session && owner === session.userId && registryRoom?.access === 'public';
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
  // event so the OS doesn't background the app.
  useHardwareBack(() => {
    if (router.canGoBack()) return false;
    router.replace('/(tabs)/rooms');
    return true;
  });
  const openThread = (msgId: string) =>
    router.push({ pathname: '/thread/[id]', params: { id: msgId, roomId: id, roomName: name, kind } });
  // Pass the room context so the space screen can surface the owner-only "Connect
  // a bot" panel for public rooms (the in-room panel hides once the room has
  // messages — see {@link WebhookPanelWhenEmpty}). Automated rooms route the info
  // button to their dedicated settings sheet instead.
  const openMembers = () => {
    if (isAutomated) {
      setShowAutomationSheet(true);
      return;
    }
    router.push({ pathname: '/space/[id]', params: { id: spaceId, roomId: id, roomKind: kind } });
  };
  const openSearch = () => router.push('/search');
  const openProfile = (userId: string) => router.push({ pathname: '/profile/[id]', params: { id: userId } });
  // DM only: the full thread history with this peer (the sidebar shows just the top
  // few). The Threads tab is space-scoped and the virtual DM-home has no Threads row,
  // so DMs get their own pushed list keyed by the dm- space.
  const openDmThreads = () => router.push({ pathname: '/threads/[spaceId]', params: { spaceId, peer: name } });

  // Build suggestion context from the live message log. The store is null until
  // the room opens; empty messages → no suggestion generated.
  const messages = (useStarfishData(store ?? EMPTY_STORE, (d) => d.messages as StoredMsg[] | undefined) ?? []) as StoredMsg[];
  const lastMsg = messages.at(-1) ?? null;
  // The model can suggest more than a reply: react / pin (owner-only) the last
  // message, or open a thread — optionally pre-seeded with a starter reply (the
  // "thread + answer" combo, written to the thread draft before navigating).
  const suggestionContext = useMemo(() => {
    if (!session || !canWrite) return undefined;
    return {
      lastMsgId: lastMsg && lastMsg.authorId !== session.userId ? lastMsg.id : null,
      buildMessages: () => buildSuggestionMessages(messages, session.userId),
      onReact: (msgId: string, emoji: string) => toggleReaction(msgId, emoji),
      onPin: isOwner ? (msgId: string) => pinMessage(msgId) : undefined,
      onOpenThread: async (msgId: string, prefill?: string) => {
        // Await the draft write BEFORE navigating: on native (AsyncStorage) the
        // thread's useDraft kvGet could otherwise resolve before this set commits
        // and the seeded "answer" would silently vanish.
        if (prefill) await kvSet(threadDraftKey(session.userId, id, msgId), prefill);
        router.push({ pathname: '/thread/[id]', params: { id: msgId, roomId: id, roomName: name, kind } });
      },
    };
  }, [session, canWrite, lastMsg, messages, isOwner, toggleReaction, pinMessage, id, name, kind]);

  return (
    <StackScreen
      contentStyle={styles.content}
      header={
        <AppBar
          title={title}
          onBack={goBack}
          right={
            <View style={styles.headerActions}>
              {kind === 'dm' ? (
                <IconButton name="thread" accessibilityLabel="All threads with this person" onPress={openDmThreads} />
              ) : null}
              {kind === 'dm' ? (
                <IconButton
                  name="archive"
                  accessibilityLabel={dmArchived ? 'Unarchive this conversation' : 'Archive this conversation'}
                  onPress={toggleDmArchive}
                />
              ) : null}
              {ticketEntry ? (
                <IconButton name="check-circle" accessibilityLabel="Ticket actions" onPress={() => setShowTicketSheet(true)} />
              ) : null}
              <IconButton name="info" accessibilityLabel="Space details" onPress={openMembers} />
            </View>
          }
        />
      }
      desktopHeader={
        <DesktopChatTopbar
          name={name}
          kind={kind}
          spaceId={spaceId}
          onSearch={openSearch}
          onDetails={openMembers}
          onThreads={kind === 'dm' ? openDmThreads : undefined}
          onArchived={kind === 'dm' ? goBack : undefined}
          onTicketActions={ticketEntry ? () => setShowTicketSheet(true) : undefined}
        />
      }
      footer={
        canWrite ? (
          <Composer
            placeholder={`Message ${title}`}
            draftKey={session ? roomDraftKey(session.userId, id) : undefined}
            offline={!online}
            suggestionContext={suggestionContext}
            onSend={(t, file) =>
              void composeSend({
                text: t,
                file,
                uploadAttachment,
                send,
                sendText,
              })
            }
            onEditLast={editLast}
          />
        ) : (
          <ReadOnlyFooter />
        )
      }
    >
      {!session ? (
        <SignInPrompt subtitle="Create an identity to open encrypted rooms." />
      ) : opening || (registryLoading && !registryLoaded && !registryRoom) ? (
        // Show the skeleton during useRoomOpen's async open AND during the initial
        // registry read when the room's access type is still unknown. Without this,
        // an E2EE room opened from a notification (no access/kind on the wire) defaults
        // enc:false while the registry read is in-flight → cursor built without an
        // encryptor → sealed envelopes fold to nothing → an empty conversation flashes
        // until the registry resolves (one round-trip, then self-heals). The skeleton
        // covers that gap: once `loaded` flips true, the room renders with real access.
        <ConversationSkeleton />
      ) : openError ? (
        // A DM open-error is an ACCESS problem, not connectivity: `use-room-open` only
        // routes a SpaceAccessError here (no keyring / not a recipient), so the cause is
        // almost always that THIS device doesn't hold the DM's key — a QR-paired or
        // secondary device has a fresh keypair and isn't a recipient of the keyring the
        // peer sealed to your SEED identity. Explain that plainly (and what to do) rather
        // than the bare "offline" banner this used to fall through to; the DM decrypts on
        // your primary device.
        kind === 'dm' ? (
          <EmptyState
            iconName="alert"
            title="This device can’t unlock this DM"
            subtitle="Direct messages are end-to-end encrypted to your main identity. Open this conversation on the device that holds your recovery phrase — or re-pair this device — to read its history and reply."
          />
        ) : (
          <EmptyState iconName="alert" title="Couldn't open room" subtitle={openError}>
            <Button label="Try again" iconName="refresh" style={styles.cta} onPress={reload} />
          </EmptyState>
        )
      ) : store ? (
        // Fade the decrypted conversation up where the skeleton sat (a soft
        // "materializing" instead of a jump-cut). Reveal mounts only when this
        // branch does — i.e. exactly at the skeleton→content swap — and collapses
        // to an instant show under reduced motion (via FadeView). styles.fill keeps
        // the LegendList filling the pane.
        <Reveal duration={motion.base} style={styles.fill}>
          {!online || offline ? (
            // Genuine connectivity (the access cases above show their own reason). Spell out
            // that BOTH history and new messages are affected — an empty offline DM looked
            // broken under the old bare "you're offline" copy.
            <OfflineBanner
              message={
                kind === 'dm'
                  ? 'You’re offline — this conversation’s history and any messages you send will sync once you’re back online.'
                  : undefined
              }
            />
          ) : syncError ? (
            <Callout tone="warning" iconName="alert">
              {syncError}
            </Callout>
          ) : null}
          {showBotPanel ? (
            <WebhookPanelWhenEmpty store={store} spaceId={spaceId} roomId={id} />
          ) : null}
          {automatedRoom ? <AutomationHints room={automatedRoom} /> : null}
          <RoomConversation
            store={store}
            spaceId={spaceId}
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
            roomName={kind === 'dm' ? undefined : name}
          />
          {/* Publish this room's recent threads to the desktop sidebar (no UI).
              Stream rooms support threads too (replies are appended with a parentId),
              so this runs for every kind. */}
          <ThreadDigestPublisher store={store} roomId={id} readBefore={readBefore} />
        </Reveal>
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
      <TicketActionsSheet
        visible={showTicketSheet}
        entry={ticketEntry}
        onSetStatus={(s) => setTicketStatus(id, s)}
        onArchive={() => { archiveTicket(id); goBack(); }}
        onClose={() => setShowTicketSheet(false)}
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.xs, paddingBottom: spacing.md },
  cta: { alignSelf: 'center' },
  // Keeps the conversation list filling the pane through the reveal wrapper.
  fill: { flex: 1 },
  // Row that holds the DM-specific right-hand header buttons (thread + archive + info).
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
