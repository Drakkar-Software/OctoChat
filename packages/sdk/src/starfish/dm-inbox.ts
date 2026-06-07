/**
 * The DM-invite carrier — the app-only delivery channel that lets an initiator hand a
 * peer the signed cap + space id for a new 1:1 DM, without a server inbox.
 *
 * A user's own `_spaces` doc is owner-authenticated, so A cannot write into B's docs.
 * The only A→B channel that needs no server change is a doc inside a space they
 * ALREADY share. The carrier rides the append-only `streamchat` collection (member
 * read+write, opaque bodies — see apps/server/src/config.ts) at a RESERVED room id per
 * shared space, `${spaceId}-_dminbox`. A appends; B reads on its inbox reconcile.
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
import { streamRoomPull, streamRoomPush } from './paths';

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
 * Read the carrier in `sharedSpaceId` and return every invite THIS session can
 * trial-unseal, skipping any whose space is in `acceptedSpaceIds` (already joined) and
 * silently skipping malformed / not-for-us / undecryptable elements. `client` must be
 * authorized for the shared space. Never throws on a bad element — a single poisoned
 * append must not blank the inbox.
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
