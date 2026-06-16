/** Domain model for OctoChat — the chat-domain types shared by the SDK and any UI. */

// Shared scaffolding re-exported from octospaces-sdk so downstream consumers get
// them from one place. OctoChat-specific types follow below.
export type {
  ID,
  PresenceStatus,
  VerificationLevel,
  CapMap,
  PubAccessMap,
  DmMap,
  ArchivedDms,
  MuteValue,
  MutePrefs,
  ReadValue,
  ReadPrefs,
  Space,
  ObjectContentKind,
} from '@drakkar.software/octospaces-sdk';

import type {
  ID,
  SealedBlob,
  AttachmentRef,
  NodeAccess,
  ObjectContentKind,
  PresenceStatus,
  VerificationLevel,
} from '@drakkar.software/octospaces-sdk';

export interface User {
  id: ID;
  name: string;
  handle: string;
  initials: string;
  presence?: PresenceStatus;
  /** Uploaded avatar as a data URI; absent → render the monogram initials. */
  avatar?: string;
}

/** EVERY room is an APPEND-ONLY log: writers append `{t,e}` envelopes (no
 *  pull/merge/hash), so bots/integrations can post without the sync protocol. The
 *  old merge-doc `channel` and append-only `stream` kinds were MERGED — `channel`
 *  is now the single normal room kind, and a legacy persisted `stream` (or the
 *  retired `private`) subtype reads back as `channel` (see {@link subtypeToRoomKind}).
 *  Whether a room is end-to-end encrypted follows the NODE (`ObjectNode.enc`), not the
 *  room kind: `enc:true` → `streamchat` (delegated), `access:'public'` → `streampub`
 *  (plaintext, world-readable), `access:'invite'` → `streaminv` (plaintext, cap-gated).
 *  `dm` is a 1:1 private room; `automated` is a room with a built-in integration
 *  attached: a bot posts scheduled fetches into it and the user drives it with `/<command>`
 *  msgs. */
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
  /** Bot write credential (token + endpoint + signPath), SEALED to the minting account
   *  key (see `account-seal.ts` `sealToSelf`) before it enters this synced PLAINTEXT
   *  registry doc. Sealing keeps a space reader from lifting it to forge bot posts.
   *  Opened by the runner before posting + the settings sheet to display it. Binds to
   *  the SEED-derived key — opens on the minting device or a seed-restored device, NOT
   *  a QR-paired device (fresh keypair). Manage automations from the primary device;
   *  `rotateAutomatedRoomCredential` re-seals to whichever device rotates.
   *  A LEGACY pre-seal room stored this in the clear — see `openStreamBotCredential`
   *  for the back-compat read. */
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
  /** Per-node access tier (projected from the unified object index).
   *  `'public'` → `streampub` (world-readable); `'invite'` → `streaminv` (cap-gated);
   *  absent/`'space'` → `streamchat` (space:member). */
  access?: NodeAccess;
  /** True when the room's log is E2EE (uses the space-wide keyring). */
  enc?: boolean;
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
 *  Builtins infer this (see `object-types.ts`); a custom type sets it on the node.
 *  Sourced from `@drakkar.software/octospaces-sdk` (re-exported above). */

/** When `type === 'room'`, which flavour. Maps the legacy {@link RoomKind}:
 *  `channel`/`private`→`channel`, `dm`→`dm`, `automated`→`automation`. A legacy
 *  persisted `stream` subtype reads back as `channel` (handled by the `default`
 *  branch in {@link subtypeToRoomKind} / `roomSubtypeIcon`). */
export type RoomSubtype = 'channel' | 'dm' | 'automation';

/** One entry in a space's object index (`spaces/{spaceId}/objects/_index`). This is
 *  IDENTITY + TREE POSITION + light metadata ONLY — the heavy content (messages,
 *  streams, etc.) lives in per-object collections keyed by {@link id}.
 *  The tree is LOGICAL via {@link parentId} (category→room, doc→sub-doc), never path
 *  nesting, so a move is an O(1) reparent. Sibling order is `(order, id)` for a
 *  deterministic render across devices. The index is union-merged on `id` keyed by
 *  {@link updatedAt}, so concurrent member edits don't clobber. */
export interface ObjectNode {
  id: ID;
  type: ObjectType;
  /** Present when `type === 'room'`. Stored in `meta.subtype` going forward. */
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
  /** Who may access this node's content. Absent ⇒ `'space'` (any space member).
   *  - `'public'`  — world-readable via `streampub`/`objpub`; listed in the global dir.
   *  - `'space'`   — any space member (default for new rooms/nodes).
   *  - `'invite'`  — only explicitly invited identities (per-node cap). */
  access?: NodeAccess;
  /** True ⇒ this node's content is E2EE under the SPACE-WIDE keyring at
   *  `spaces/{spaceId}/_keyring`. All `enc` nodes share one CEK. The combination
   *  `public + enc` is invalid. Defaults `false` when absent. */
  enc?: boolean;
  /** Automation runner config when `type === 'automation'`. Stored in `meta.automation`
   *  going forward; kept here for back-compat until the Phase-4 data sweep. */
  automation?: AutomationMeta;
  /** Optional override of how this object's content syncs. Builtins leave it absent
   *  (inferred from {@link type}); a CUSTOM type sets it so the generic hook layer can
   *  open the right collection without knowing the type. */
  contentKind?: ObjectContentKind;
  /** App-specific fields. OctoChat stores type-specific metadata here (e.g. automation
   *  config, room subtype). Generic renderers ignore fields they don't recognise. */
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
