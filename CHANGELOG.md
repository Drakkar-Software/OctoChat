# OctoChat Changelog

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
