/**
 * Low-level desk mutations on the unified object index.
 * Mirrors the `automations/registry-write.ts` pattern for ticket nodes.
 */
import { updateObjectIndex } from '@drakkar.software/octospaces-sdk';
import { addObject } from '../starfish/objects';
import type { Session } from '../starfish/identity';
import type { ObjectNode } from '../domain/types';
import type { TicketMeta } from './ticket';
import { ticketMetaForIndex } from './ticket';

const asLocal = (nodes: import('@drakkar.software/octospaces-sdk').ObjectNode[]) =>
  nodes as unknown as ObjectNode[];

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
