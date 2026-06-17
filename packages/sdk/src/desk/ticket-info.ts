/**
 * Sealed ticket-info for E2EE tickets.
 *
 * For an E2EE ticket the human-readable subject + requester are STRIPPED from the
 * all-member plaintext index (see `ticketMetaForIndex`) and instead sealed with the
 * ticket's per-node keyring. They are stored as a single typed header entry in the ticket's
 * invite stream (`objinvlog`) — the only per-node location that BOTH the desk side
 * (owner/bot/assigned agents, via `space:member`) AND the isolated requester (via their
 * per-node stream cap) can reach. Only node-keyring recipients can DECRYPT it, so a
 * non-participant (e.g. an unassigned agent) sees ciphertext → renders a placeholder.
 *
 * Plaintext tickets do NOT use this — their title/requester live in the index `meta.ticket`.
 */
import { buildNodeAccess, getNodeStreamClient, objInvLogPull, objInvLogPush } from '@drakkar.software/octospaces-sdk';

import type { Session } from '../starfish/identity';
import { clampField, TICKET_TITLE_MAX, TICKET_REQUESTER_MAX } from './ticket';
import type { TicketInfo } from './ticket';

/** The typed stream entry that carries the sealed ticket header. */
const TICKET_INFO_TYPE = 'ticket-info';

type Encryptor = { encrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>>; decrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>> };

/**
 * Seal `{title, requester}` with the ticket's per-node keyring and append it as the header
 * entry of the ticket's invite stream. Call once at E2EE ticket creation (the caller — the
 * desk owner/bot — is already a keyring recipient).
 */
export async function writeSealedTicketInfo(
  session: Session,
  spaceId: string,
  ticketId: string,
  info: TicketInfo,
): Promise<void> {
  const access = await buildNodeAccess(session, spaceId, ticketId, { access: 'invite', enc: true });
  if (!access?.encryptor) throw new Error('No node keyring to seal ticket info');
  const clean: TicketInfo = {
    title: clampField(info.title, TICKET_TITLE_MAX),
    requester: clampField(info.requester, TICKET_REQUESTER_MAX),
  };
  const body = await (access.encryptor as unknown as Encryptor).encrypt({ t: TICKET_INFO_TYPE, e: clean });
  await getNodeStreamClient(spaceId, ticketId, session).append(objInvLogPush(spaceId, ticketId), body);
}

/**
 * Pull the ticket's invite stream, find the sealed `ticket-info` header, and decrypt it.
 * Returns null when there is no header or the caller cannot decrypt it (not a keyring
 * recipient) — callers render a placeholder in that case.
 */
export async function readSealedTicketInfo(
  session: Session,
  spaceId: string,
  ticketId: string,
): Promise<TicketInfo | null> {
  const access = await buildNodeAccess(session, spaceId, ticketId, { access: 'invite', enc: true });
  if (!access?.encryptor) return null;
  const client = getNodeStreamClient(spaceId, ticketId, session);
  const res = await client.pull(objInvLogPull(spaceId, ticketId)).catch(() => null);
  const items = (res?.data as { items?: unknown[] } | undefined)?.items;
  if (!Array.isArray(items)) return null;
  for (const raw of items) {
    try {
      const dec = await (access.encryptor as unknown as Encryptor).decrypt(raw as Record<string, unknown>);
      if ((dec as { t?: string }).t === TICKET_INFO_TYPE) {
        const e = (dec as { e?: TicketInfo }).e;
        if (e && typeof e.title === 'string' && typeof e.requester === 'string') return e;
      }
    } catch {
      // Not decryptable by us (or not a ticket-info entry) — skip.
    }
  }
  return null;
}
