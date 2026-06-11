/** Domain model for OctoChat — the chat-domain types shared by the SDK and any UI. */

import type { SealedBlob } from '../starfish/account-seal';
import type { AttachmentRef } from '../starfish/attachments';

export type ID = string;

/** A user's presence indicator. The theme maps each to a color (app-side). */
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

/** A security item's verification state. The theme maps each to a color (app-side). */
export type VerificationLevel = 'verified' | 'pending' | 'unverified';

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

/** The set of DM-space ids the user has archived (hidden from the DM list). Keyed by
 *  DM-space id (`dm-…`) — a set-as-map like `mutes.spaces`. Synced via the `_spaces`
 *  doc so an archive on one device propagates cross-device. A new incoming message
 *  removes a space from this set (auto-resurface). See `messaging/archived-dms.ts`. */
export type ArchivedDms = Record<string, true>;

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

/** EVERY room is an APPEND-ONLY log: writers append `{t,e}` envelopes (no
 *  pull/merge/hash), so bots/integrations can post without the sync protocol. The
 *  old merge-doc `channel` and append-only `stream` kinds were MERGED — `channel`
 *  is now the single normal room kind, and a legacy persisted `stream` (or the
 *  retired `private`) subtype reads back as `channel` (see {@link subtypeToRoomKind}).
 *  Whether a room is end-to-end encrypted follows the SPACE (E2EE private space →
 *  `streamchat` / plaintext public space → `pubstream`), not the room kind. `dm` is a
 *  1:1 private room; `automated` is a room with a built-in integration attached: a bot
 *  posts scheduled fetches into it and the user drives it with `/<command>` msgs. */
export type RoomKind = 'channel' | 'dm' | 'automated';

/** A scheduled-fetch cadence. The additive successor to `intervalMin`/`onOpen`: when
 *  an automation sets `schedule`, it OVERRIDES `intervalMin` for the timing gate;
 *  absent → the cadence is derived from `intervalMin` (every pre-existing room). The
 *  discriminated `kind` keeps the daily/weekly/cron sub-fields disjoint and validatable.
 *  Calendar kinds are evaluated in **UTC** (`hour`/`minute`/`weekday` and cron fields are
 *  UTC) to match the scheduler engine's recurrence math bit-for-bit — see
 *  `automations/schedule.ts`. `weekday`: 0 = Sunday. `cron`: 3 fields `minute hour dayOfWeek`. */
export type AutomationSchedule =
  | { kind: 'interval'; everyMin: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'cron'; expression: string };

/** Stored, synced configuration of an `automated` room — kept on the per-Room
 *  registry entry so every device sees status / can take over the runner.
 *  Secret provider params (API keys etc.) live in device-local kv instead — see
 *  `src/lib/automations/secrets.ts`. */
export interface AutomationMeta {
  /** FK into the built-in provider catalog (e.g. 'rss' / 'http'). */
  providerId: string;
  /** Non-secret provider params (URLs, locations, etc.). */
  params: Record<string, unknown>;
  /** Scheduled-fetch cadence in minutes; `0` = commands-only (no scheduled run).
   *  Legacy baseline: when `schedule` is set it overrides this for the timing gate,
   *  but `intervalMin` is kept written so an older client still reads a usable cadence
   *  (a calendar `schedule` degrades to commands-only on a client that predates it). */
  intervalMin: number;
  /** Calendar / interval cadence (introduced with the 0.2.0 scheduler). Present →
   *  overrides `intervalMin`; absent → the legacy interval path. Optional → absent on
   *  every pre-existing room. See {@link AutomationSchedule}. */
  schedule?: AutomationSchedule;
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
  /** PRIVATE spaces only: the enrolled bot's userId. A private automation's bot is a real
   *  keyring + roster member (that's what authorizes its encrypted post — see
   *  `provisionPrivateBot`), so it lands in the space's `members` roster. Recording its userId
   *  here — in the clear, like the roster itself — lets the member-list/count UIs subtract it
   *  so the bot doesn't show as a phantom, profile-less member. Absent for a PUBLIC automation
   *  (its bot is an ephemeral audience-cap subject, never a roster member). */
  botUserId?: string;
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
 *  `channel`/`private`→`channel`, `dm`→`dm`, `automated`→`automation`. A legacy
 *  persisted `stream` subtype reads back as `channel` (handled by the `default`
 *  branch in {@link subtypeToRoomKind} / `roomSubtypeIcon`). */
export type RoomSubtype = 'channel' | 'dm' | 'automation';

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
