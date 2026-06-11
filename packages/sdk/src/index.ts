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
export * from './starfish/base64';
export * from './starfish/fetch-timeout';
export * from './starfish/paths';
export * from './starfish/storage-types';
export * from './starfish/account-seal';
export * from './starfish/identity';
export * from './starfish/client';
// Re-export AppendLogCursor so consumers build it against the SAME StarfishClient
// declaration the SDK's own client funnels produce (one resolution, no nominal clash
// from the `private baseUrl` field across duplicate package copies/symlinks).
export { AppendLogCursor } from '@drakkar.software/starfish-client';
export * from './starfish/pairing';
export * from './starfish/session-restore';
export * from './starfish/profile-cache';
export * from './starfish/pull-cache';
export * from './starfish/registry';
export * from './starfish/members';
export * from './starfish/member-caps';
export * from './starfish/objects';
export * from './starfish/object-index';
export * from './starfish/space-encryptor';
export * from './starfish/attachments';
export * from './starfish/stream-bots';
export * from './starfish/dm';
export * from './starfish/dm-ids';
export * from './starfish/dm-keys';
export * from './starfish/dm-inbox';
export * from './starfish/dm-link';
export * from './starfish/base64url';
export * from './starfish/pubspace';
export * from './starfish/pubspace-caps';
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
