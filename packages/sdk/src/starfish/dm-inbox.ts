/**
 * The DM-invite delivery channels: the shared-space CARRIER (a reserved stream room
 * inside a space both users already share) and the per-recipient DM-LINK inbox (a
 * dedicated server collection a "DM me" link bearer can append to — the cross-space
 * path, see dm-link.ts). Both deliver the same sealed invite bundles and are
 * trial-unsealed by the same {@link unsealInviteElements} core.
 *
 * A user's own `_spaces` doc is owner-authenticated, so A cannot write into B's docs.
 * The only A→B channel that needs no server change is a doc inside a space they
 * ALREADY share. The carrier rides the append-only `streamchat` collection (member
 * read+write, opaque bodies — see apps/server/src/config.ts) at a RESERVED room id per
 * shared space, `${spaceId}-_dminbox`. A appends; B reads on its inbox reconcile.
 * The DM inbox (`dminbox/{ownerId}`) is the server-side alternative for peers with
 * NO shared space: an owner-read, anonymously-writable per-user log.
 *
 * Privacy: each element carries ONLY a {@link SealedBlob} (sealed to the recipient's
 * published KEM key) + a timestamp — no plaintext `to`/`from`. Every member of the
 * shared space TRIAL-unseals each element; only the intended recipient's key opens it,
 * so co-members can't tell who is being DM'd. (Residual: the seal's `entry.addedBy`
 * reveals that SOMEONE sealed an invite — full metadata privacy would need a dedicated
 * per-recipient server collection, out of scope.)
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { SealedBlob } from './account-seal';
import { sealToRecipient, unsealFromRecipient } from './account-seal';
import type { Session } from './identity';
import { dmInboxShards, dminboxPull, streamRoomPull, streamRoomPush } from './paths';

/** Reserved carrier room-id suffix. `spaceIdFromRoomId` still resolves the host space
 *  (`sp-x-_dminbox` → `sp-x`), and the room is never in any `_rooms` registry so it
 *  never renders as a list row. */
const DM_INBOX_SUFFIX = '-_dminbox';

/** The carrier (stream) room id for a shared space. */
export const dmInboxRoomId = (sharedSpaceId: string): string => `${sharedSpaceId}${DM_INBOX_SUFFIX}`;

/** True for the reserved DM-inbox carrier room. Used to keep its append events out of
 *  the host space's unread aggregation (see `unread-context.tsx`). */
export const isDmInboxRoomId = (roomId: string): boolean => roomId.endsWith(DM_INBOX_SUFFIX);

/** One carrier element: a DM invite sealed to its recipient + when it was appended. */
interface DmInviteElement {
  sealed: SealedBlob;
  ts: number;
}

/** A trial-unsealed invite this reader could open. `inviteJson` is the
 *  `acceptSpaceInvite` bundle; `spaceId` is parsed out for dedup; `senderEdPub` is the
 *  authenticated sealer (cross-checked against the cap issuer by the caller). */
export interface ScannedInvite {
  inviteJson: string;
  spaceId: string;
  senderEdPub: string;
}

/**
 * Append a DM invite to the carrier in `sharedSpaceId`, sealed to `recipientKemPub`.
 * `client` must be authorized for the shared space (its member-cap / owner client — the
 * carrier write is `space:member`-gated). One append; append-only ⇒ no conflict.
 */
export async function appendDmInvite(
  session: Session,
  client: StarfishClient,
  sharedSpaceId: string,
  recipientKemPub: string,
  inviteJson: string,
): Promise<void> {
  const sealed = await sealToRecipient(session, recipientKemPub, inviteJson);
  const body: DmInviteElement = { sealed, ts: Date.now() };
  await client.append(streamRoomPush(dmInboxRoomId(sharedSpaceId)), body as unknown as Record<string, unknown>);
}

/**
 * Trial-unseal a pulled list of carrier/inbox elements into the invites THIS session
 * can open, skipping any whose space is in `acceptedSpaceIds` (already joined) and
 * silently skipping malformed / not-for-us / undecryptable elements. Never throws on
 * a bad element — a single poisoned append must not blank the inbox. The shared core
 * of {@link scanDmInbox} (shared-space carrier) and {@link scanDmLinkInbox}
 * (per-recipient DM-link inbox) — both deliver the exact same sealed bundles.
 */
export async function unsealInviteElements(
  session: Session,
  items: { ts: number; data: Record<string, unknown> }[] | null | undefined,
  acceptedSpaceIds?: ReadonlySet<string>,
): Promise<ScannedInvite[]> {
  const out: ScannedInvite[] = [];
  for (const item of items ?? []) {
    const el = item?.data as Partial<DmInviteElement> | undefined;
    if (!el?.sealed) continue; // malformed element
    let inviteJson: string;
    try {
      inviteJson = await unsealFromRecipient(session, el.sealed);
    } catch {
      continue; // not sealed to us, or tampered — trial-unseal skip
    }
    let spaceId: string | undefined;
    try {
      spaceId = (JSON.parse(inviteJson) as { spaceId?: unknown }).spaceId as string | undefined;
    } catch {
      continue; // unsealed but not a valid invite bundle
    }
    if (!spaceId || acceptedSpaceIds?.has(spaceId)) continue;
    out.push({ inviteJson, spaceId, senderEdPub: el.sealed.entry.addedBy });
  }
  return out;
}

/**
 * Read the carrier in `sharedSpaceId` and return every invite THIS session can
 * trial-unseal (see {@link unsealInviteElements}). `client` must be authorized for
 * the shared space.
 */
export async function scanDmInbox(
  session: Session,
  client: StarfishClient,
  sharedSpaceId: string,
  acceptedSpaceIds?: ReadonlySet<string>,
): Promise<ScannedInvite[]> {
  const items = (await client
    .pull<{ ts: number; data: Record<string, unknown> }>(streamRoomPull(dmInboxRoomId(sharedSpaceId)), {
      appendField: 'items',
      full: true, // a19: append-only pulls must be bounded; scan the whole inbox log
    })
    .catch(() => [])) as { ts: number; data: Record<string, unknown> }[];
  return unsealInviteElements(session, items, acceptedSpaceIds);
}

/**
 * Read THIS session's own per-recipient DM inbox (where "DM me" link openers and
 * profile-initiated DMs deliver invites with no shared space, see dm-link.ts) and
 * trial-unseal it like a carrier. The inbox is month-sharded, so this scans the
 * CURRENT + PREVIOUS shard (an invite delivered near a month boundary is still
 * seen) — each shard is bounded by the collection's per-shard maxItems, so the
 * scanned set never grows without bound. Best-effort: an unreachable shard —
 * including the 403 a pre-feature paired device's stale cap gets, or a 404 for a
 * month with no invites — returns `[]` (the root device is the one that can
 * accept anyway, since invites seal to the published root keys).
 */
export async function scanDmLinkInbox(
  session: Session,
  acceptedSpaceIds?: ReadonlySet<string>,
): Promise<ScannedInvite[]> {
  const out: ScannedInvite[] = [];
  for (const shard of dmInboxShards()) {
    const items = (await session.accountClient
      .pull<{ ts: number; data: Record<string, unknown> }>(dminboxPull(session.userId, shard), {
        appendField: 'items',
        full: true, // bounded by the collection's per-shard maxItems
      })
      .catch(() => [])) as { ts: number; data: Record<string, unknown> }[];
    out.push(...(await unsealInviteElements(session, items, acceptedSpaceIds)));
  }
  return out;
}
