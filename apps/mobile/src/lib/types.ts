/** Domain model for OctoChat. Frontend-only — these describe placeholder data. */

import type { PresenceStatus, VerificationLevel } from '@/theme';
import type { SealedBlob } from './starfish/account-seal';
import type { AttachmentRef } from './starfish/attachments';

export type ID = string;

/** Maps a joined private space's id → its owner-issued member cap-cert (serialized
 *  JSON). Persisted both in device-local kv (`member-caps.ts`) and, for durability,
 *  in the user's own synced `_spaces` doc so a fresh device re-hydrates it. */
export type CapMap = Record<string, string>;

/** Maps a joined PUBLIC space's id → its invitation credential (the owner-signed cap
 *  plus the link's ephemeral private key) SEALED to the account's own key. Unlike a
 *  member cap (safe in the clear — see {@link CapMap}), a public-join credential
 *  embeds a bearer secret, so it is sealed before riding in the plaintext `_spaces`
 *  doc. Recovered on any device with the same seed. See `account-seal.ts` and
 *  `pubspace-caps.ts`. */
export type PubAccessMap = Record<string, SealedBlob>;

/** Maps a DM peer's userId → the private DM-space id shared with them. Lets the
 *  initiator dedup (one conversation per peer) and the non-initiator record the
 *  space their inbox reconciler accepted. Shares the `_spaces` doc like {@link CapMap}
 *  (the space's member cap rides `caps`; this is just the peer→space pointer). See
 *  `starfish/dm.ts`. */
export type DmMap = Record<string, string>;

/** A mute entry. `true` = muted indefinitely; a number = muted UNTIL that epoch-ms
 *  instant (the forward-compatible shape for a future "mute for 15 min" — read-
 *  supported now, but the current UI only ever writes `true` or deletes the key). */
export type MuteValue = true | number;

/** Per-user mute preferences: which rooms and which whole spaces are silenced.
 *  Synced across the user's devices (stored alongside `spaces`/`caps` in the
 *  `user/<userId>/_spaces` doc) and mirrored to device-local kv (`mutes.ts`). */
export interface MutePrefs {
  rooms: Record<string, MuteValue>;
  spaces: Record<string, MuteValue>;
}

/** A per-room read mark: the epoch-ms instant the viewer last read that room.
 *  Monotonic (only ever advances) so a merge across devices takes the MAX. */
export type ReadValue = number;

/** Per-user read marks — the timestamp each room was last read. Synced across the
 *  user's devices (a `reads` key alongside `spaces`/`caps`/`mutes` in the
 *  `user/<userId>/_spaces` doc) and mirrored to device-local kv (`reads.ts`) so the
 *  unread badge / divider clears on every device, not just the one that read. */
export interface ReadPrefs {
  rooms: Record<string, ReadValue>;
}

export interface User {
  id: ID;
  name: string;
  handle: string;
  initials: string;
  presence?: PresenceStatus;
  /** Uploaded avatar as a data URI; absent → render the monogram initials. */
  avatar?: string;
}

export interface Space {
  id: ID;
  name: string;
  /** 2-letter monogram used in the space rail. */
  short: string;
  /** Uploaded space image as a data URI; absent → render the `short` monogram.
   *  Owner-set + shared via the space's `_rooms` registry (plaintext, NOT E2EE). */
  image?: string;
  members: number;
  unread?: number;
  /** 'private' (E2EE keyring space, the default) or 'public' (plaintext, joined via
   *  a space-wide invitation link). Absent ⇒ treat as 'private' (back-compat). */
  type?: 'private' | 'public';
  /** Public spaces only: the owner's userId (the cap issuer + storage path owner). */
  ownerId?: string;
  /** Public spaces only (joiner side): whether this identity's invite link grants
   *  write. Owner always has write. */
  write?: boolean;
}

/** `stream` is an append-only room (a "Stream room"): writers append to a log —
 *  no pull/merge/hash — so bots/integrations can post without the sync protocol.
 *  Its encryption follows the space (E2EE private / plaintext public).
 *  `automated` is a stream room with a built-in integration attached: a bot posts
 *  scheduled fetches into it, and the user drives the bot with `/<command>` msgs.
 *  Storage-wise it's identical to a public `stream` (pubstream collection). */
export type RoomKind = 'channel' | 'private' | 'dm' | 'stream' | 'automated';

/** Stored, synced configuration of an `automated` room — kept on the per-Room
 *  registry entry so every device sees status / can take over the runner.
 *  Secret provider params (API keys etc.) live in device-local kv instead — see
 *  `src/lib/automations/secrets.ts`. */
export interface AutomationMeta {
  /** FK into the built-in provider catalog (e.g. 'rss' / 'http'). */
  providerId: string;
  /** Non-secret provider params (URLs, locations, etc.). */
  params: Record<string, unknown>;
  /** Scheduled-fetch cadence in minutes; `0` = commands-only (no scheduled run). */
  intervalMin: number;
  /** When set, the automation fires on every room open / background check,
   *  bypassing the `intervalMin` time gate (still single-runner + enabled-gated).
   *  Optional → absent on pre-existing rooms, read as `false`. */
  onOpen?: boolean;
  /** Off → ticker skips and `onCommand` ignores; the room itself still renders. */
  enabled: boolean;
  /** Bot write credential (`createStreamBotCredential`: token + endpoint + signPath),
   *  SEALED to the minting account key (see `account-seal.ts` `sealToSelf`) before it
   *  enters this synced PLAINTEXT registry doc. The token is a bearer audience cap;
   *  sealing keeps a space reader from lifting it to forge bot posts. Opened by the
   *  runner before posting + the settings sheet to display it. Like the `pubAccess` and
   *  DM-keyring seals, it binds to the SEED-derived key, so it opens on the minting
   *  device or a seed-restored device — NOT a QR-paired device (fresh keypair). Manage
   *  automations from the primary device; `rotateAutomatedRoomCredential` re-seals to
   *  whichever device rotates. A LEGACY pre-seal room stored this in the clear — see
   *  `openStreamBotCredential` for the back-compat read. */
  credential: SealedBlob;
  /** The deterministic id of the device elected to run this automation. Other
   *  devices see status but never fire — single-runner election avoids dup posts. */
  runOnDeviceId: string | null;
  /** Last successful tick (epoch ms) — synced for cross-device status display. */
  lastRunAt: number | null;
  /** Hash of the last text a scheduled fetch posted. The runner re-hashes each
   *  fetch and skips the post when it matches, so an unchanged feed/endpoint isn't
   *  reposted every interval. Optional → absent on pre-existing rooms (read null).
   *  Only scheduled fetches write it; slash-command posts never touch it. */
  lastFetchHash?: string | null;
  /** Last error message — set on throw, cleared on success. */
  lastError: string | null;
}

export interface Room {
  id: ID;
  spaceId: ID;
  /** Category bucket this room renders under (e.g. "DESIGN"). */
  category: string;
  name: string;
  kind: RoomKind;
  topic?: string;
  unread?: number;
  mention?: boolean;
  /** DM avatar monogram. */
  avatar?: string;
  /** Present only for `kind === 'automated'` — the runner config (synced via the
   *  `_rooms` registry doc; threaded through every writer for free since writers
   *  rewrite the whole `rooms[]`). */
  automation?: AutomationMeta;
}

/** The builtin object types. A space's contents — channels, DMs, stream/automation
 *  rooms, categories, docs, projects (and a project's tasks) — are all `Object`s of
 *  one `ObjectType`. A custom (user-defined) type rides the same `string` field, so
 *  the union stays open-ended; builtins are the ones the app ships renderers for. */
export type BuiltinObjectType = 'room' | 'category' | 'automation' | 'doc' | 'project' | 'task';
export type ObjectType = BuiltinObjectType | (string & {});

/** The builtin types, as a runtime set — so code can ask "is this one we ship a
 *  renderer for?" and fall back to the generic custom-type path otherwise. */
export const BUILTIN_OBJECT_TYPES: readonly BuiltinObjectType[] = ['room', 'category', 'automation', 'doc', 'project', 'task'];

/** How an object's CONTENT syncs — the one axis a custom type must declare so the app
 *  can pick a hook without hardcoding its `type`:
 *   - `merge`  → a merge-doc (pull→union-merge→push), like a doc or a channel.
 *   - `append` → an append-only `by_timestamp` event log, like a project or a stream.
 *   - `none`   → no content doc; the node is structure only, like a category.
 *  Builtins infer this (see `object-types.ts`); a custom type sets it on the node. */
export type ObjectContentKind = 'merge' | 'append' | 'none';

/** When `type === 'room'`, which flavour. Maps the legacy {@link RoomKind}:
 *  `channel`/`private`→`channel`, `dm`→`dm`, `stream`→`stream`, `automated`→`automation`. */
export type RoomSubtype = 'channel' | 'dm' | 'stream' | 'automation';

/** One entry in a space's object index (`spaces/{spaceId}/objects/_index`). This is
 *  IDENTITY + TREE POSITION + light metadata ONLY — the heavy content (messages, doc
 *  blocks, project event log) lives in a per-object content doc keyed by {@link id}.
 *  The tree is LOGICAL via {@link parentId} (category→room, doc→sub-doc), never path
 *  nesting, so a move is an O(1) reparent. Sibling order is `(order, id)` for a
 *  deterministic render across devices. The index is union-merged on `id` keyed by
 *  {@link updatedAt}, so concurrent member edits don't clobber. */
export interface ObjectNode {
  id: ID;
  type: ObjectType;
  /** Present when `type === 'room'`. */
  subtype?: RoomSubtype;
  /** Parent in the tree; `null` = root. category→room, doc→sub-doc, etc. */
  parentId: ID | null;
  /** Sibling sort key; ties broken by `id`. */
  order: number;
  title: string;
  emoji?: string;
  /** Epoch ms of the last edit to THIS node — the union-merge per-node winner. */
  updatedAt: number;
  /** Soft-delete; archiving a node cascade-archives its subtree. */
  archived?: boolean;
  /** Present when `subtype === 'automation'` — same config as legacy automated rooms. */
  automation?: AutomationMeta;
  /** Optional override of how this object's content syncs. Builtins leave it absent
   *  (inferred from {@link type}); a CUSTOM type sets it so the generic hook layer can
   *  open the right collection without knowing the type. */
  contentKind?: ObjectContentKind;
  /** Optional emoji/glyph already covers the icon; a custom type may also carry an
   *  arbitrary `meta` bag for type-specific fields the generic renderers ignore. */
  meta?: Record<string, unknown>;
}

/** The object-index doc: the union-merged list of every object in a space. */
export interface ObjectsIndex {
  v: 1;
  objects: ObjectNode[];
  updatedAt: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine?: boolean;
  /** Ids of the users currently reacting with this emoji (for the "who reacted"
   *  tooltip). Raw ids — names are resolved at render so they stay viewer-aware. */
  userIds: string[];
}

/** Append-only reaction event stored in the room doc; aggregated for display. */
export interface ReactionEvent {
  id: string;
  msgId: string;
  emoji: string;
  userId: string;
  kind: 'add' | 'remove';
  ts: number;
}

/** Append-only message-edit event stored in the room doc; the latest one (by `ts`)
 *  authored by the message's author wins at render — see `resolveEdit`. A `delete`
 *  tombstones the message; an `edit` carries the replacement `text`. */
export interface MessageEditEvent {
  id: string;
  msgId: string;
  userId: string;
  kind: 'edit' | 'delete';
  /** Replacement body for an `edit`; absent for a `delete`. */
  text?: string;
  ts: number;
}

/** Append-only pin event stored in the room doc; the latest one (by `ts`) authored
 *  by the SPACE OWNER wins at render — see `resolvePinned`. Only the owner may pin
 *  or unpin, so unlike edits/reactions the guard filters by the owner, not the
 *  message's author. A `pin` marks the message; an `unpin` clears it. */
export interface PinEvent {
  id: string;
  msgId: string;
  /** Who emitted it — only events where this equals the space owner count. */
  userId: string;
  kind: 'pin' | 'unpin';
  ts: number;
}

export interface Message {
  id: ID;
  roomId: ID;
  authorId: ID;
  time: string;
  text?: string;
  /** Real (encrypted) attachment reference rendered via AttachmentView. */
  attachmentRef?: AttachmentRef;
  reactions?: Reaction[];
  /** Number of replies if this message anchors a thread. */
  threadCount?: number;
  /** Whether this message @-mentions the current user. */
  mention?: boolean;
  /** Whether this message arrived since the viewer last read the room. Combined
   *  with {@link mention} it escalates the highlight (a wider, stronger bar). */
  unread?: boolean;
  /** Whether the author has edited this message's text (renders an "(edited)" mark). */
  edited?: boolean;
  /** Whether the author has deleted this message (renders a "deleted" tombstone). */
  deleted?: boolean;
  /** Whether the space owner has pinned this message (renders a "Pinned" mark). */
  pinned?: boolean;
  /** Unsent state for a message still in the offline outbox: `queued`/`sending`
   *  render as a muted "will send when online" bubble, `failed` offers a retry.
   *  Absent for a normal, server-confirmed message. See `src/lib/outbox.ts`. */
  pending?: 'queued' | 'sending' | 'failed';
}

export interface Thread {
  id: ID;
  roomId: ID;
  parentId: ID;
  replies: Message[];
}

export interface SecurityItem {
  id: ID;
  icon: 'shield' | 'devices' | 'key';
  title: string;
  detail: string;
  level: VerificationLevel;
  mono?: boolean;
}

export interface Profile {
  user: User;
  pronouns: string;
  description: string;
  status: string;
  fingerprint: string;
  security: SecurityItem[];
}
