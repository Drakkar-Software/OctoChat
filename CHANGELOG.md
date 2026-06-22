# OctoChat Changelog

## sdk 0.3.11 — 2026-06-22 · declined-request persistence

### SDK changes (0.3.10 → 0.3.11)

- **0.3.11 – Declined incoming requests persist across refresh** (`domain/types.ts`,
  `starfish/registry.ts`, `desk/intake.ts`): declining a ticket/room request on the
  owner-side "Incoming requests" shelf now records the `reqId` durably in the user's
  `_spaces` doc under `extra.declinedRequests`, synced cross-device alongside
  `archivedDms`. `listPendingTicketRequests` reads this set and filters it from the
  scan result, so a declined request stays gone after refresh/restart/other-device.
  Previously `declineTicketRequest` only sealed a rejection to the requester's inbox
  and `usePendingRequests` removed it in-memory only — causing it to reappear on
  the next `scanResourceRequests` call (mount, navigation, foreground).

## sdk 0.3.10 — 2026-06-22 · DM kemSig fix

### SDK changes (0.3.9 → 0.3.10)

- **0.3.10 – DM request `kemSig` propagation** (`starfish/dm-keys.ts`,
  `starfish/dm-link.ts`, `starfish/dm.ts`): octospaces-sdk 0.20 hardened
  `parseJoinRequest` to require a `kemSig` field (Ed25519 sig of `kemPub` by
  `edPriv`, binding the KEM key to the signing key). OctoChat's DM flow
  hand-builds the peer's join-request from their *public* keys — this field was
  never produced for the sender's own key, so it already exists in the published
  profile (`PublicProfile.kemSig`) and in the `IdentityLink` token, but was
  silently dropped before building `requestJson`. Fix: `PeerKeys` and `DmPeer`
  now carry `kemSig`; both `requestJson` construction sites (`createOrOpenDm`
  and `createOrOpenDmViaInbox`) include it. `readPeerKeys` returns `null` for
  profiles missing `kemSig` (peer self-heals on next root sign-in), so the UI
  correctly shows "can't message yet" instead of crashing on invite.

## sdk 0.3.9 — 2026-06-22 · ticket-info 400 fix

### SDK changes (0.3.8 → 0.3.9)

- **0.3.9 – `readSealedTicketInfo` append-window fix** (`desk/ticket-info.ts`): the pull that
  reads the sealed ticket-info header from the ticket's invite-log stream was missing the
  required window option, causing the server to reject it with `400 pull_bound_required`. The
  pull now passes `{ appendField: 'items', full: true }` (matching the `pullAndFold` /
  `scanDmInbox` convention), unblocking the ticket title for all E2EE tickets. The result
  extraction is updated to match the flat-array return of the `AppendPullOptions` overload.

## mobile 1.14.3 / sdk 0.3.8 — 2026-06-21 · octospaces 0.16 migration

### Bug fixes

- **Unread marks threw on room open** (`lib/unread-context.tsx`): octospaces-sdk 0.16.0
  renamed `ReadPrefs.rooms` → `nodes`; `unread-context` still read `.rooms`, so
  `getReadPrefs().rooms` was `undefined` and `Object.entries()` threw when navigating to
  `/rooms` — both directly and via the `setNodeReadAt → emit → reconcileReads` listener.

### SDK changes (0.3.4 → 0.3.8)

- **0.3.8 – octospaces-sdk 0.16.0 migration** (`starfish/paths.ts`, `starfish/registry.ts`,
  `domain/ids.ts`, `domain/types.ts`, `messaging/mutes.ts`, `messaging/reads.ts`):
  octospaces 0.16 de-chatted its generic SDK surface (node-oriented names) and extracted
  DM/quick-reactions behind a generic `extra` passthrough. OctoChat preserves its room-named
  API via aliases and reimplements `updateDmsDoc` / `updateArchivedDmsDoc` /
  `setDmMapping` / `updateQuickReactionsDoc` over `updateSpacesExtraField`; `readSpaces`
  re-flattens `extra.{dms,archivedDms,quickReactions}`. `session.chatClient/chatCap` →
  `contentClient/contentCap`. Mutes/reads store methods renamed; `MutePrefs/ReadPrefs`
  `.rooms` field → `.nodes`.
- **0.3.7 – octospaces-sdk 0.15.1 pin**: micro-module folds and dead export removal in
  octospaces; no OctoChat code changes.
- **0.3.6 – octospaces-sdk 0.14.3 pin** (`domain/octochat-config.ts`): move off the
  published-0.13.0 workspace floor; declare OctoChat's own `webBase?: string`
  (octospaces removed its inherited field in 0.13.x).
- **0.3.5 – room pull-path resolver** (`messaging/room-paths.ts`): extract
  `roomStreamPull(room, roomId)` from the three callers that hand-rolled identical tier
  routing (`cross-room.ts`, `space-stats.ts`, `notification-preview.ts`); public surface
  unchanged. Pin octospaces-sdk 0.13.4.
- **0.3.4 – internal refactor + octospaces-sdk 0.13.3 pin** (`messaging/cross-room.ts`,
  `desk/requester.ts`, `starfish/webhooks.ts`, `starfish/paths.ts`): extract
  `foldRoom` / `forEachSpaceRoom`, fold `submitRoomRequest` / `submitTicketRequest` →
  `submitNodeRequest`, dedup `toHex` → `bytesToHex` and `opsForAccess`. Octospaces-sdk
  stepped through 0.13.1 → 0.13.2 → 0.13.3 (internal rounds, API identical).

## mobile 1.14.2 / sdk 0.3.3 — 2026-06-17 · DM + ticket live notifications

### Bug fixes

- **DM live notifications + unread never delivered** (`starfish/dm.ts`,
  `lib/spaces-context.tsx`): the deployed `/events` SSE proxy + FCM bridge authorize a
  space purely from `spaces/{id}/_access.{owner,members}` (the strict, no-TOFU enricher —
  the member cap that gates message *reads* is ignored there), so a DM whose peer was
  missing from that roster loaded history but received NO live notifications/unread on any
  surface (web SSE, native FCM, in-app badge). Root cause: the peer was added to `_access`
  via a read-modify-write (`addSpaceMember`) that raced the just-written owner stamp.
  - `createDmSpaceCore` now seeds the peer into `_access.members` in the single owner write
    (no race); the later `inviteToSpace` `addSpaceMember` no-ops.
  - New `healDmRosters(session, dms)` (wired into the spaces reconcile) repairs DMs created
    before the fix — owner-only, idempotent, best-effort; each side heals the DMs it owns.
  - The space-rail DM badge (`useTotalDmUnread`) needed no change — it lights up once DM
    unread populates.
- **Ticket notifications dropped + ticket unread pruned on reload** (`44c2b83`;
  `notifications/notification-{labels,preview}.ts`, `lib/notify.ts`,
  `lib/push/background-notify.native.ts`, `lib/unread-context.tsx`): the notification
  resolvers re-derived the space from the room id via `spaceIdFromRoomId`, which returns a
  bogus space for `ticket-<hex>` ids (no embedded space). They now accept the real
  `spaceId` the SSE event / FCM payload already carries; ticket room ids are exempt from
  the unread hydrate-prune (new `isTicketRoomId`).
- **Request link card hidden on non-desk builds** (`components/desk/IntakeSettings.tsx`,
  `app/space/[id].tsx`): the "REQUESTS" card (shareable request link) was gated on
  `useFeature('tickets')`, so non-desk spaces could not share their request link even though
  the link can now be used to request a private room. The gate is removed from the mount
  site; the ticket intake-mode selector inside the card remains gated on `hasTickets`.

### Tests
- `starfish/dm.test.ts`: roster seeding at creation + `healDmRosters` (adds missing peer,
  idempotent, skips peer-owned DMs, best-effort, skips non-DM ids) — end-to-end against the
  real `addSpaceMember` + an in-memory client.
- `notifications/notification-{labels,preview}.test.ts`, `desk/ticket.test.ts`: explicit
  `spaceId` resolves the real space (not `ticket-<hex>`); `isTicketRoomId` predicate.

## mobile 1.14.1 / sdk 0.3.2 — 2026-06-17 · post-review bug fixes

### Bug fixes

- **`claimGrantedNodes` malformed bundle** (`requester.ts`): JSON.parse failure no longer
  orphans a grant whose caps are already stored — falls back to `nodeId` as display name and
  still pushes the grant to `claimed[]`.
- **`makeNodeCreateHandler` empty nodeType** (`intake.ts`): removed the `!nodeType` fallback
  that silently created a ticket for requests with a missing/empty `nodeType` field; unknown
  types now throw (and are caught per-request so the rest of the batch is unaffected).
- **`makeNodeCreateHandler` outside try/catch** (`intake.ts`): moved inside the per-request
  try block so an unknown `nodeType` skips that single request rather than aborting the entire
  reconcile loop.
- **`SharedRoomList` not updating after accept** (`use-pending-requests.ts`): `accept` now
  calls `refreshSpaces()` in addition to `dispatchRoomChange` — `useObjects` does not react
  to room-change events, only to SSE/focus.
- **Double-submission window** (`use-resource-request.ts`): `claimPending()` is now awaited
  inside the submit try-block (with an 8 s timeout) so `busy` stays true until the claim
  completes; `busyRef` used as the sync guard to avoid recreating the callback on every state
  toggle.
- **`refreshSpaces` missing from `accept` deps** (`use-pending-requests.ts`): added to the
  `useCallback` dep array to prevent a stale closure if SpacesContext ever adds deps beyond
  `session`.
- **Tests** (`requester.test.ts`, `intake.test.ts`): 12 new test cases covering the above
  paths (malformed bundle, non-string nodeName, corrupt-grant skipping, nodeType routing for
  room/unknown/empty, best-effort isolation, auto-reply suppression for rooms).

## mobile 1.14.0 / sdk 0.3.1 — 2026-06-17 · shared rooms (request-link)

### New — request-link shared rooms

**SDK (`packages/sdk`)**
- `desk/shared-room.ts`: `SHARED_ROOM_PREFIX = 'shared-'`, `isSharedRoomId()` predicate.
- `desk/registry-write.ts`: `createSharedRoomNodeWithReqId()` (creates `type:'room' access:'invite'`
  node with `meta.reqId` dedup stamp); `ensureDeskTicketStreamAccess` renamed to
  `ensureDeskNodeStreamAccess` (deprecated alias kept).
- `desk/orchestrator.ts`: `makeRoomCreateHandler()` — factory for `acceptResourceRequest({ create })`
  that creates isolated shared-room nodes. Title sanitization via `clampField()` (consistent with
  `makeTicketCreateHandler`).
- `desk/intake.ts`: `makeNodeCreateHandler()` routes accept by `req.nodeType` (`'room'` →
  `makeRoomCreateHandler`, `'ticket'` → `makeTicketCreateHandler`, unknown → throws). Auto-reply
  gated on `nodeType !== 'room'` (bot reply only applies to support queues, not shared rooms).
  `acceptNodeRequest()` replaces `acceptTicketRequest()` (deprecated alias kept); handles both
  tickets and rooms based on nodeType.
- `desk/requester.ts`: `submitRoomRequest()`, `submitTicketRequest()`, `claimGrantedNodes()`,
  `getRequesterSharedRoomsForSpace()`, `nodeIdsForSpace()` — full requester-side lifecycle.
- Re-exports: `./desk/shared-room` and `./desk/requester` added to `src/index.ts`.

**App (`apps/mobile`)**
- `app/request.tsx`: landing screen for `…/request?s=<spaceId>#<token>` — pick "Private room" or
  "Support ticket", name it, send the request; auto-navigates to the room when the grant is claimed.
- `lib/use-request-link.ts`: decode + async-verify identity token, reconstruct request link,
  derive owner display info — extracted from `request.tsx` per CLAUDE.md rules 3+4.
- `lib/use-resource-request.ts`: submit + claim lifecycle; calls `SpacesProvider.refresh()` on
  successful claim so the guest room appears immediately without a navigation round-trip.
- `lib/use-guest-rooms.ts`: REQUESTER — lists synthetic `shared-*/ticket-*` Space records with
  `ownerSpaceId` (recovered from access store) and `enc` (derived from keyring entry presence).
- `lib/use-shared-rooms.ts`: OWNER — projects `type:'room' access:'invite'` nodes from the space
  object index into a collapsible shelf.
- `components/desk/GuestRoomSection.tsx`: collapsible "Shared rooms" shelf for the requester in
  DM home view; forwards `enc` correctly.
- `components/desk/SharedRoomList.tsx`: collapsible "Shared rooms" shelf for the owner alongside
  TicketList.
- `components/desk/RequestRow.tsx`: shows "Room request" / "Ticket request" label per `nodeType`.
- `lib/spaces-context.tsx`: `guestSpaces` + `guestOwnerSpaceIds` in context; `railSpaces` filters
  out `shared-*/ticket-*` synthetic spaces.
- `lib/unread-context.tsx`: `guestOwnerSpaceIds` added to SSE subscription candidate set;
  `isSharedRoomId` exempted from the left-space unread prune.
- `app/(tabs)/rooms/index.tsx`, `components/chat/DesktopRoomSidebar.tsx`: mount
  `GuestRoomSection` (DM home) and `SharedRoomList` (space sidebar).
- `lib/use-pending-requests.ts`: migrated to `acceptNodeRequest`.

### Bug fixes

- **`makeRoomCreateHandler` title clamp**: replaced inline regex (which was correct but duplicated
  `clampField` logic) with `clampField(req.title, TICKET_TITLE_MAX)` for consistency.
- **Auto-reply skips shared rooms**: `reconcileTicketRequests` no longer posts an intake-reply bot
  message for `nodeType:'room'` requests — shared rooms are not support queues.
- **nodeType allowlist**: unknown `nodeType` values now throw instead of silently creating a ticket,
  surfacing backend/schema mismatches early.
- **`_cfg` unused param**: renamed to `cfg` in `makeNodeCreateHandler` (reads `cfg.enc` for
  Phase 5 E2EE readiness; no underscore suppression).
- **`guestOwnerSpaceIds` reactivity**: `claimGrantedNodes` now calls `SpacesProvider.refresh()`
  on new grants, so the SSE subscription updates immediately instead of waiting for navigation.
- **`enc` forwarded from `GuestRoomEntry`**: `GuestRoomSection` reads `entry.enc` (derived from
  the keyring access store) instead of hardcoding `'0'`, preparing for Phase 5 E2EE shared rooms.
- **Test mock**: `vi.mock('./orchestrator')` in `intake.test.ts` now stubs `makeRoomCreateHandler`
  alongside `makeTicketCreateHandler` so the `nodeType:'room'` code path is testable.
- **Dead interface surface**: removed `lastReqId`, `lastSpaceId`, `claimPending` from
  `UseResourceRequestReturn` (unused by all consumers).
- **`acceptTicketRequest` renamed** to `acceptNodeRequest` (handles both tickets and rooms);
  `use-pending-requests.ts` migrated.

## octochat-sdk 0.3.0 — 2026-06-16 · variant system + OctoDesk

### New
- **Capability registry** (`domain/capabilities.ts`): `Capability` type
  (`'channels' | 'dms' | 'threads' | 'automations' | 'tickets'`),
  `CAPABILITY_META` record (label, description, roomType per capability),
  `ROOM_TYPE_CAPABILITIES` array.
- **OctoDesk ticket model** (`desk/ticket.ts`): `TicketStatus`
  (`open | pending | solved | closed`), `TicketPriority`
  (`low | normal | high | urgent`), `TicketMeta` interface, and pure helpers
  `ticketOf` / `withTicket` / `isTicketNode` / `defaultTicketMeta`.
- **Low-level registry write** (`desk/registry-write.ts`):
  `createTicketNode` (appends to the object index via `addObject` +
  `updateObjectIndex`), `patchTicketMeta`.
- **Ticket orchestrator** (`desk/orchestrator.ts`): `createTicket` (creates
  node + returns `requesterInviteLink` via `createNodeInviteLink`),
  `patchTicketStatus`, `assignTicket`.
- **`ticket` builtin object type** added to `domain/object-types.ts` and
  `domain/types.ts`; `meta?: Record<string, unknown>` field added to
  `NewObjectInput` in `starfish/objects.ts`.
- **Two new automation providers**: `desk-autoreply`, `desk-sla` (registered in
  `automations/providers/index.ts`).
- New exports at the package root: `desk/ticket`, `desk/orchestrator`,
  `domain/capabilities`.

## octochat-sdk 0.2.0 — 2026-06-14 · octospaces-sdk@0.4.3 migration

### Breaking changes
- **Per-node access model replaces per-space public/private.** `Space.type`, `Space.visibility`, `Space.ownerId` are removed. Access is now per room node (`ObjectNode.access ∈ {'public','space','invite'}` + `enc: boolean`).
- `createPublicSpace`, `joinPublicSpace`, `getSpaceEncryptor`, `clearSpaceEncryptors`, `buildSpaceAccess`, `getSpaceAccess` removed. Use `createSpace` + `createNode({access:'public'})`, `joinSpaceByLink`, `joinNodeByLink`, `getNodeAccess` / `buildNodeAccess`, `clearNodeAccessCache`.
- `isPublicSpaceId` removed (no per-space public concept). Gate on per-room `access` field instead.
- `pubstreamRoomPull/Push` removed — use `streamPubRoomPull/Push` (public rooms) or `streamInvRoomPull/Push` (invite-plaintext rooms).
- `pubObjIndexPull/Push` removed — use `objIndexPull/Push` (object index is always plaintext).
- `readRooms` / `writeRooms` replaced by `readSpaceAccess` / `writeSpaceAccess` (registry path changed from `_rooms` → `_access`).
- `removeMemberCap` / `removePubspaceAccess` replaced by `removeSpaceAccessEntry(spaceId)`.
- `createPublicInvite` replaced by `createSpaceInviteLink(session, spaceId, spaceName, write, origin)` — works for all spaces.
- `listWebhooks(client, ownerId, spaceId)` → `listWebhooks(client, spaceId)` — `ownerId` param removed.
- `createWebhook(client, ownerId, spaceId, opts)` → `createWebhook(client, spaceId, opts)`.
- `removeWebhook(client, ownerId, spaceId, id)` → `removeWebhook(client, spaceId, id)`.
- `webhookUrl(base, ownerId, spaceId, id)` → `webhookUrl(base, spaceId, id)`.
- `updateSpacesDoc` mutator callback signature is `(cur: {spaces, caps}) => {spaces, caps}`. The `_spaces` doc still carries a `pubAccess` field (auto-threaded by the implementation — required by `octospaces-sdk` for link-join credential recovery via `recoverSpaceAccess`); the mutator callback never receives or returns it.

### New exports (re-exported from octospaces-sdk)
- `getNodeAccess`, `buildNodeAccess`, `getSpaceClient`, `clearNodeAccessCache`, `NodeAccessHandle`
- `hydrateSpaceAccessStore`, `getSpaceAccessEntry`, `saveSpaceAccessEntry`, `removeSpaceAccessEntry`, `getNodeAccessEntry`, `saveNodeAccessEntry`, `removeNodeAccessEntry`, `localSpaceAccessEntries`, `memberCapsFromStore`, `linkAccessFromStore`, `clearSpaceAccessStore`
- `recoverSpaceAccess`
- `createSpaceInviteLink`, `joinSpaceByLink`, `joinNodeByLink`
- `SpaceAccessError`
- `createNode`, `setNodeAccess`, `inviteToNode`, `acceptNodeInvite`, `createNodeInviteLink`, `decodeNodeInviteLink`, `encodeNodeInviteLink`
- `previewInvite`, `InvitePreview`
- `matchTitle`, `rankResults`, `fold`, `isWordStart`, `MatchRange`, `TitleMatch`, `RankedResult`
- `registerPull`, `dispatchDocChange`, `emitSseStatus`, `onSseStatus`, `clearLiveSyncBus`
- `NodeAccess`

### New stream paths
- `streamPubRoomPull/Push(roomId)` — public room (`streampub` collection, `spaces/{spaceId}/streams/pub/{roomId}`)
- `streamInvRoomPull/Push(roomId)` — invite-plaintext room (`streaminv`, `spaces/{spaceId}/streams/n/{roomId}/log`)
- `spaceRegistryPull/Push(spaceId)` — space access record (`spaces/{spaceId}/_access`)

### Server (apps/server)
- Collections: `chatkeyring` → `spacekeyring`; `rooms`/`_rooms` → `spaceregistry`/`_access`; added `streampub`, `streaminv`; removed `pubspace`, `pubstream`, `pubobjindex`.
- `objindex` encryption changed from `delegated` → `none` (object index is always plaintext).
- Enricher: removed `pubspace_role`; uses `make_space_role_enricher(registry_path="spaces/{id}/_access")`.
- Webhooks: `_webhooks` path no longer includes `ownerId`.

### Mobile app (apps/mobile)
- `useRooms`: removed `isPublic` from return (use `room.access === 'public'` per-room).
- `useSpaceSettings`: removed `isPublic`; `createInvite` uses `createSpaceInviteLink` (works for all spaces).
- `useRoom`: opts now `{access?: NodeAccess; enc?: boolean}` (replaces `isPublic`).
- `WebhookPanel`/`useWebhooks`: removed `ownerId` prop/param.
- `space/[id].tsx`: unified invite card (bundle + link) for all owners; `SpaceMembersCard` always shown.

### Tests (+14 new)
- `starfish/paths.test.ts` — per-node stream path routing + space registry path
- `starfish/objects.test.ts` — `objectsToRoomCategories` `access`/`enc` passthrough
- `starfish/registry.test.ts` — `writeSpaceAccess` (owner + members + meta, null hash)

## Post-migration fixes (2026-06-14)

### Bug fixes
- **`use-merge-doc`/`space-cap` — wrong signing key for link-joined spaces.** The merge-doc
  hook (object index + Work docs) was signing all requests with the account ed key, even
  for spaces joined via an invite link. Link-joined spaces require the link's ephemeral
  bearer key (`entry.key`). Fixed: `space-cap.ts` exports `resolveMemberAuth` (returns
  `{cap, signKey}`) and `use-merge-doc.ts` now uses it instead of `resolveMemberCap`.
- **`room/[id].tsx` — WebhookPanel shown on non-public rooms.** The "Connect a bot" panel
  was offered to the owner on any room, but webhook delivery is hardwired to `streampub`.
  For non-public rooms, posted messages silently land in `streampub` while the room reads
  from `streamchat` — a black hole. Fixed: `showBotPanel` now requires
  `registryRoom?.access === 'public'`, matching the existing guard in `space/[id].tsx`.
- **`use-room` — invite-room composer gate reads space entry, ignoring per-node entry.**
  Fixed: `getNodeAccessEntry(spaceId, roomId) ?? getSpaceAccessEntry(spaceId)` — no user
  impact today (no invite-node creation path exists yet), but hardens for when it ships.

### Security
- **`projectSpaceRegistry` now targets `_index/spaces/public` (not `_index/spaces/meta`).**
  The previous `_index/spaces/meta` shard was `readRoles:["public"]` and contained ALL
  space names/images, including private spaces — anonymously enumerable. The new design
  folds name/image into the same `_index/spaces/public` shard as the public-room count;
  `loadPublicSpaceIndex` filters entries to `publicRooms > 0`, so private-space names
  do not appear in the Explore screen. A transient window (between a spaceregistry write
  and the next objindex removal) may leave a private name in the raw doc; bounded and
  acceptable for the POC.
- **Plaintext object index — known trade-off (D, accepted for POC).** The `objindex`
  collection is `encryption:"none"` (changed from `delegated` in this migration). Room,
  category, and DM titles plus automation metadata (`providerId`, `params`, `botUserId`,
  `lastError`, …) are stored in plaintext and readable by the server. This is intentional:
  the public-directory projection must read node `access` fields, which sealed content
  would hide. Bot `credential` blobs remain `sealToSelf`-sealed (not leaked). Message
  bodies, attachments, and DM content continue to be sealed. This trade-off should be
  re-evaluated before OctoChat is positioned as a high-security product.
