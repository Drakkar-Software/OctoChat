/**
 * `@drakkar.software/octochat-sdk` — the headless, reusable OctoChat core.
 *
 * All of OctoChat's non-UI logic: identity (BIP-39 seed → Ed25519/Kyber keys),
 * the encrypted Starfish sync client + per-space keyrings, the spaces/rooms
 * registry and object tree, members & invites, DMs, public spaces, attachments,
 * plus the chat-domain types and the pure message/markdown formatters. No UI, no
 * React, no platform lock-in — wire any frontend to it.
 *
 * Host integration: call `configureOctoChat({...})` and `configureKv({...})` once
 * at boot (the SDK is platform-agnostic and does not read env or bind storage).
 * Relative imports are EXTENSIONLESS so Metro can bundle the package from source.
 *
 * Source is grouped by subject under `src/`: `config/` (host wiring), `domain/`
 * (types/ids/object registry), `format/` (pure formatters & view models),
 * `starfish/` (encrypted sync / crypto / registry core), `messaging/` (reads,
 * mutes, reactions, threads, links), `notifications/`, `outbox/`, `spaces/`,
 * `events/`, `nostr/`, and `automations/`.
 */

// ── config/ — host configuration / platform adapters ───────────────────────────
export * from './config/config';
export * from './config/adapters';

// ── domain/ — core model: types, ids, object-type registry ─────────────────────
export * from './domain/types';
export * from './domain/ids';
export * from './domain/object-types';

// ── format/ — pure formatters & view models ────────────────────────────────────
export * from './format/format';
export * from './format/emoji';
export * from './format/message-format';
export * from './format/markdown';
export * from './format/message-view';

// ── starfish/ — encrypted sync / crypto / registry core ────────────────────────
export { starfishBase64 } from '@drakkar.software/octospaces-sdk';
export * from './starfish/fetch-timeout';
export * from './starfish/paths';
export type {
  DerivedIdentity,
  PersistedSession,
  Vault,
  VaultLoad,
  UnlockMethod,
  PasskeyEnrollment,
  SeedLock,
} from '@drakkar.software/octospaces-sdk';
export * from './starfish/account-seal';
export * from './starfish/identity';
export * from './starfish/client';
// Re-export AppendLogCursor so consumers build it against the SAME StarfishClient
// declaration the SDK's own client funnels produce (one resolution, no nominal clash
// from the `private baseUrl` field across duplicate package copies/symlinks).
export { AppendLogCursor } from '@drakkar.software/starfish-client';
export * from './starfish/pairing';
export { sessionFromPersisted, activeAccountOf } from '@drakkar.software/octospaces-sdk';
export { cacheProfile, loadCachedProfile } from '@drakkar.software/octospaces-sdk';
export { pullCache, PULL_CACHE_MAX_AGE_MS } from '@drakkar.software/octospaces-sdk';
export * from './starfish/registry';
export * from './starfish/members';
// member-caps, space-encryptor, pubspace, pubspace-caps are REMOVED —
// their functionality is now provided by @drakkar.software/octospaces-sdk
// (getSpaceAccessEntry, saveSpaceAccessEntry, getNodeAccess, etc.) and
// re-exported below in the octospaces-sdk section.
export * from './starfish/objects';
export * from './starfish/object-index';
export * from './starfish/attachments';
export * from './starfish/stream-bots';
export * from './starfish/dm';
export * from './starfish/dm-ids';
export * from './starfish/dm-keys';
export * from './starfish/dm-inbox';
export * from './starfish/dm-link';
export * from './starfish/base64url';
export * from './starfish/webhooks';

// ── messaging/ — reads, mutes, reactions, threads, links, cross-room ───────────
export * from './messaging/reads';
export * from './messaging/mutes';
export * from './messaging/links';
export * from './messaging/reactions';
export * from './messaging/threads';
export * from './messaging/cross-room';
export * from './messaging/quick-reactions-settings';
export * from './messaging/archived-dms';
export * from './messaging/dm-activity';
export * from './messaging/stream-log';
export * from './messaging/sealed-stream';
export * from './messaging/autosave';

// ── notifications/ — notification formatting, labels, previews ─────────────────
export * from './notifications/notification-format';
export * from './notifications/notification-labels';
export * from './notifications/notification-preview';

// ── outbox/ — offline write queue ──────────────────────────────────────────────
export * from './outbox/outbox-types';
export * from './outbox/outbox-reducers';
export * from './outbox/outbox-send';

// ── spaces/ — space stats + public-space exploration ───────────────────────────
export * from './spaces/space-stats';
export * from './spaces/explore-spaces';

// ── events/ — live room-change SSE stream ──────────────────────────────────────
export * from './events/events.shared';

// ── nostr/ — NIP-07 browser-extension login ────────────────────────────────────
export * from './nostr/nostr';

// Argon2id progress emitter (pure, no platform deps) — re-exported from the platform
// shim so the host's React progress hook can import it from the core entry without
// pulling the platform-adapter subpath. The shim itself is reached by the host's
// `hash-wasm` bundler alias + the `./hash-wasm-shim` subpath export.
export { subscribeArgon2Progress } from './platform/hash-wasm-shim';

// ── ai/ — on-device AI: LLM types, pure prompt builders, digest split, settings ─
export * from './ai/llm';
export * from './ai/engine-port';
export * from './ai/prompt';
export * from './ai/digest-sections';
export * from './ai/settings';

// ── automations/ — scheduled/triggered room automations ────────────────────────
export * from './automations/types';
export * from './automations/hash';
export * from './automations/secrets';
export * from './automations/append';
export * from './automations/registry-write';
export * from './automations/runner-core';
export * from './automations/schedule';
export * from './automations/orchestrator';
export * from './automations/providers/index';

// ── desk/ — OctoDesk sub-app: ticket model + orchestrator ─────────────────────
export * from './desk/ticket';
export * from './desk/registry-write';
export * from './desk/orchestrator';

// ── domain/capabilities — variant capability registry ─────────────────────────
export * from './domain/capabilities';

// ── octospaces-sdk — new generic utilities (0.4.3) ─────────────────────────────
// These were extracted into the shared SDK; re-exported here so OctoChat code
// imports from '@drakkar.software/octochat-sdk' without knowing the origin.
export {
  // search-match — quick-find title ranker
  matchTitle,
  rankResults,
  fold,
  isWordStart,
  type MatchRange,
  type TitleMatch,
  type RankedResult,
  // live-sync-bus — doc-change → pull-hook bus
  registerPull,
  dispatchDocChange,
  emitSseStatus,
  onSseStatus,
  clearLiveSyncBus,
  // invite-preview — classify an invite string before joining
  previewInvite,
  type InvitePreview,
  // per-node access model
  type NodeAccess,
  getNodeAccess,
  buildNodeAccess,
  getSpaceClient,
  getNodeStreamClient,
  clearNodeAccessCache,
  type NodeAccessHandle,
  // space access store (replaces member-caps + pubspace-caps)
  hydrateSpaceAccessStore,
  getSpaceAccessEntry,
  saveSpaceAccessEntry,
  removeSpaceAccessEntry,
  getNodeAccessEntry,
  saveNodeAccessEntry,
  removeNodeAccessEntry,
  localSpaceAccessEntries,
  memberCapsFromStore,
  linkAccessFromStore,
  clearSpaceAccessStore,
  type SpaceAccessEntry,
  type SpaceAccessMap,
  // space access recovery (replaces recoverPubspaceAccess)
  recoverSpaceAccess,
  // space-wide invite links
  createSpaceInviteLink,
  decodeSpaceInviteLink,
  type SpaceInviteLinkToken,
  // joining spaces via link
  joinSpaceByLink,
  // hard access-denial error (thrown by getNodeAccess / openEncryptor)
  SpaceAccessError,
  // node operations
  createNode,
  setNodeAccess,
  inviteToNode,
  acceptNodeInvite,
  createNodeInviteLink,
  decodeNodeInviteLink,
  encodeNodeInviteLink,
  joinNodeByLink,
  type CreateNodeInput,
  type NodeInviteBundle,
  type NodeInviteLinkToken,
  // inbox helpers (shard rotation + authenticated read)
  inboxShard,
  inboxShards,
  pullInbox,
  type InboxElement,
  // anonymous signed append
  appendToInbox,
  postAnonymousAppend,
  AppendHttpError,
  // pure-identity link tokens (no cap/credential — safe to publish)
  encodeIdentityLink,
  decodeIdentityLink,
  verifyIdentityLinkBinding,
  verifyIdentityLinkKeys,
  myIdentityLink,
  type IdentityLink,
  // sealed resource-request inbox
  submitResourceRequest,
  scanResourceRequests,
  acceptResourceRequest,
  rejectResourceRequest,
  scanResourceGrants,
  acceptResourceGrant,
  type ResourceRequest,
  type ResourceGrant,
  type ResourceReject,
  type PendingRequest,
  type AcceptResult,
  type SubmitResourceRequestOptions,
} from '@drakkar.software/octospaces-sdk';
