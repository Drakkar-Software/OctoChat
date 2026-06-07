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
 */

// ── Host configuration / platform adapters ─────────────────────────────────────
export * from './config';
export * from './adapters';

// ── Domain model + id/formatter helpers ────────────────────────────────────────
export * from './types';
export * from './ids';
export * from './format';
export * from './emoji';
export * from './message-format';
export * from './markdown';

// ── Encrypted sync / crypto / registry core ────────────────────────────────────
export * from './starfish/base64';
export * from './starfish/fetch-timeout';
export * from './starfish/paths';
export * from './starfish/storage-types';
export * from './starfish/account-seal';
export * from './starfish/identity';
export * from './starfish/client';
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
export * from './starfish/pubspace';
export * from './starfish/pubspace-caps';

// ── Data / domain layer (offline state, messages, notifications, automations) ───
export * from './outbox-types';
export * from './outbox-send';
export * from './reads';
export * from './mutes';
export * from './links';
export * from './reactions';
export * from './message-view';
export * from './threads';
export * from './cross-room';
export * from './space-stats';
export * from './project-board';
export * from './doc-block';
export * from './object-types';
export * from './nostr';
export * from './notification-format';
export * from './notification-labels';
export * from './notification-preview';
export * from './events.shared';
export * from './automations/types';
export * from './automations/hash';
export * from './automations/secrets';
export * from './automations/append';
export * from './automations/registry-write';
export * from './automations/runner-core';
export * from './automations/orchestrator';
export * from './automations/providers/index';
export * from './quick-reactions-settings';
export * from './explore-spaces';
