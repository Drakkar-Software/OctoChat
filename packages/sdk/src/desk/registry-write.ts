/**
 * Low-level desk mutations on the unified object index.
 * Mirrors the `automations/registry-write.ts` pattern for ticket and shared-room nodes.
 */
import { saveNodeStreamAccessEntry, updateObjectIndex, ownerEnsureNodeKeyring } from '@drakkar.software/starfish-spaces';
import { nodeStreamScope } from '@drakkar.software/octospaces-sdk';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { addObject } from '../starfish/objects';
import type { Session } from '../starfish/identity';
import type { ObjectNode } from '../domain/types';
import { userIdFromEdPub } from '../starfish/paths';
import type { TicketMeta } from './ticket';
import { ticketMetaForIndex } from './ticket';

const asLocal = (nodes: import('@drakkar.software/octospaces-sdk').ObjectNode[]) =>
  nodes as unknown as ObjectNode[];

/**
 * Establish (or refresh) the desk session's read/write access to a desk node's per-node
 * `objinvlog` (invite-stream) log, so the desk can reconcile the conversation. Applies to
 * both ticket nodes and shared-room nodes (any `access:'invite'` node created via
 * `updateObjectIndex` rather than octospaces `createNode`).
 *
 * **Idempotent** — call again before reading a node whose per-node stream entry may have
 * been lost (e.g. a fresh desk process, or after an invitee's `acceptNodeInvite` overwrote
 * the shared `${spaceId}:${nodeId}:stream` entry).
 *
 * `objinvlog` admits ONLY caps that synthesize a `delegated:<ownerId>:objinvlog` role —
 * i.e. MEMBER caps ISSUED BY the owner — OR a member cap whose narrow `scope.paths` cover
 * the node. A broad `ownerScope` device cap is NOT honoured. The owner can't mint a member
 * cap to itself (`sub === iss` is rejected by `mintMemberCap`), so it mints one to a
 * throwaway ephemeral subject it controls and stores the ephemeral signing key — the same
 * per-node "link" access pattern `createNodeInviteLink` uses.
 */
export async function ensureDeskNodeStreamAccess(
  session: Session,
  spaceId: string,
  nodeId: string,
): Promise<void> {
  const ek = generateDeviceKeys();
  const ekUserId = await userIdFromEdPub(ek.edPub);
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: ek.edPub, kemPubHex: ek.kemPub, userIdHex: ekUserId },
    'objinvlog',
    nodeStreamScope(spaceId, nodeId, true),
  );
  saveNodeStreamAccessEntry(spaceId, nodeId, { kind: 'link', cap, key: ek.edPriv, write: true });
}

/**
 * @deprecated Renamed to {@link ensureDeskNodeStreamAccess} — applies to all desk invite
 * nodes, not just tickets. This alias is kept for callers that haven't migrated yet.
 */
export const ensureDeskTicketStreamAccess = ensureDeskNodeStreamAccess;

/**
 * Owner self-heal for a desk node's per-node keyring. Ensures the keyring exists (creating it
 * with the owner's own key as the first recipient if missing) and returns an Encryptor built
 * with `ownerTrustedAdders` — i.e. the owner's **edPub** — so the owner can always open the
 * keyring it created. Mirrors {@link ensureDeskNodeStreamAccess} (the `objinvlog` stream-cap
 * self-heal) for the keyring side.
 *
 * **Why this is required instead of {@link getNodeAccess}:** `getNodeAccess`'s `invite+enc`
 * branch resolves `trustedAdders` from `reg.owner`, which is a **userId** (`sha256(edPub)[0:32]`).
 * Keyring entries record `addedBy` as an **edPub** (64 hex). `userId !== edPub` → the trust
 * check always fails → the owner is told "You're not a recipient of this node's keyring". This
 * function bypasses that path and uses `ownerEnsureNodeKeyring` directly, which uses the correct
 * `ownerTrustedAdders(session)` = `[ownerEdPub, selfEdPub]`.
 */
export function ensureDeskNodeKeyring(
  session: Session,
  spaceId: string,
  nodeId: string,
): ReturnType<typeof ownerEnsureNodeKeyring> {
  return ownerEnsureNodeKeyring(session, spaceId, nodeId);
}

/**
 * Append a new ticket node to the object index.
 * `access: 'invite'` is always set (per-node cap gated).
 * `enc` follows whether the requester is a space member.
 */
export async function createTicketNode(
  session: Session,
  spaceId: string,
  ticketId: string,
  ticketMeta: TicketMeta,
  enc: boolean,
): Promise<void> {
  // For E2EE tickets, strip title + requester (PII) from the all-member plaintext index —
  // they are sealed into the per-node stream instead (see writeSealedTicketInfo). `node.title`
  // is always stripped by the SDK's serializeForIndex for invite nodes, so the visible title
  // lives in meta.ticket.title (plaintext tickets only).
  const indexMeta = ticketMetaForIndex(ticketMeta, enc);
  await updateObjectIndex(session, spaceId, (raw, now) => {
    const next = asLocal(raw);
    return addObject(
      next,
      {
        type: 'ticket',
        id: ticketId,
        title: indexMeta.title,
        access: 'invite',
        enc,
        meta: { ticket: indexMeta },
      },
      now,
    ).nodes as unknown as import('@drakkar.software/octospaces-sdk').ObjectNode[];
  });
  await ensureDeskNodeStreamAccess(session, spaceId, ticketId);
}

/**
 * Append a new ticket node and stamp `meta.reqId` for dedup.
 * Used by `makeTicketCreateHandler` so `scanResourceRequests` can skip
 * re-delivered requests (checks `node.meta?.reqId === req.reqId`).
 */
export async function createTicketNodeWithReqId(
  session: Session,
  spaceId: string,
  ticketId: string,
  ticketMeta: TicketMeta,
  enc: boolean,
  reqId: string,
): Promise<void> {
  const indexMeta = ticketMetaForIndex(ticketMeta, enc);
  await updateObjectIndex(session, spaceId, (raw, now) => {
    const next = asLocal(raw);
    return addObject(
      next,
      {
        type: 'ticket',
        id: ticketId,
        title: indexMeta.title,
        access: 'invite',
        enc,
        meta: { ticket: indexMeta, reqId },
      },
      now,
    ).nodes as unknown as import('@drakkar.software/octospaces-sdk').ObjectNode[];
  });
  await ensureDeskNodeStreamAccess(session, spaceId, ticketId);
}

/**
 * Append a new shared-room node (`type:'room' access:'invite'`) to the object index and
 * stamp `meta.reqId` for dedup. Used by `makeRoomCreateHandler` so `scanResourceRequests`
 * can skip re-delivered requests (checks `node.meta?.reqId === req.reqId`).
 *
 * Unlike normal channels (which default to `access:'space'`), a shared room is isolated to
 * its specific requester — the owner grants the requester a per-node cap, never a space cap.
 */
export async function createSharedRoomNodeWithReqId(
  session: Session,
  spaceId: string,
  roomId: string,
  title: string,
  enc: boolean,
  reqId: string,
): Promise<void> {
  await updateObjectIndex(session, spaceId, (raw, now) => {
    const next = asLocal(raw);
    return addObject(
      next,
      {
        type: 'room',
        id: roomId,
        title,
        access: 'invite',
        enc,
        meta: { reqId },
      },
      now,
    ).nodes as unknown as import('@drakkar.software/octospaces-sdk').ObjectNode[];
  });
  await ensureDeskNodeStreamAccess(session, spaceId, roomId);
}

/**
 * Merge a patch into `meta.ticket` on an existing ticket node.
 * No-op when the node is gone or is not a ticket node.
 */
export async function patchTicketMeta(
  session: Session,
  spaceId: string,
  ticketId: string,
  patch: Partial<TicketMeta>,
): Promise<void> {
  await updateObjectIndex(session, spaceId, (raw, now) => {
    const nodes = asLocal(raw);
    const node = nodes.find((n) => n.id === ticketId && n.type === 'ticket');
    if (!node) return null;
    const current = (node.meta?.ticket ?? {}) as TicketMeta;
    return nodes.map((n) =>
      n.id === ticketId
        ? { ...n, meta: { ...n.meta, ticket: { ...current, ...patch } }, updatedAt: now }
        : n,
    ) as unknown as import('@drakkar.software/octospaces-sdk').ObjectNode[];
  });
}
