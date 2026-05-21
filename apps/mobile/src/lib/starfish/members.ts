/**
 * Member invite / revoke (owner) + join (invitee), ported from the satellite
 * chat example. Invite mints a member cap-cert for an invitee's public keys,
 * adds them to the room keyring (multi-recipient E2EE), and records them in the
 * member directory. Revoke rotates the keyring epoch + drops the directory entry.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { stableStringify } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';
import { addCollectionRecipient, removeRecipient } from '@drakkar.software/starfish-keyring';
import { addMemberEntry, mintMemberCap, removeMemberEntry } from '@drakkar.software/starfish-sharing';

import { buildEncryptor, makeClient, reSealRoomAtCurrentEpoch } from './client';
import type { Session } from './identity';
import { bytesToHex, keyringName, membersName, membersPull, memberScope, roomIdFromCap } from './paths';
import { SYNC_BASE } from './config';
import { kvGet, kvSet } from './kv';
import { getMemberCap, saveMemberCap } from './member-caps';

function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export interface JoinRequest {
  edPub: string;
  kemPub: string;
  userId: string;
}

/** The invitee shares this so an owner can mint them a member cap. */
export function makeJoinRequest(session: Session): string {
  const req: JoinRequest = { edPub: session.keys.edPub, kemPub: session.keys.kemPub, userId: session.userId };
  return JSON.stringify(req);
}

export interface MemberRow {
  userId: string;
  label: string;
  canWrite: boolean;
  sub: string;
  nonce: string;
  subKem: string;
  exp: number;
}

export async function readMembers(client: StarfishClient, roomId: string): Promise<MemberRow[]> {
  try {
    const res = await client.pull(membersPull(roomId));
    const entries = (res?.data as { entries?: unknown[] } | undefined)?.entries;
    if (!Array.isArray(entries)) return [];
    return entries
      .map((raw) => raw as Record<string, unknown>)
      .filter((e) => typeof (e.subUserId ?? e.sub) === 'string')
      .map((e) => {
        const userId = (e.subUserId ?? e.sub) as string;
        const scope = e.scope as { ops?: string[] } | undefined;
        return {
          userId,
          label: typeof e.label === 'string' ? e.label : userId.slice(0, 8),
          canWrite: Array.isArray(scope?.ops) && scope!.ops!.includes('write'),
          sub: typeof e.sub === 'string' ? e.sub : '',
          nonce: typeof e.nonce === 'string' ? e.nonce : '',
          subKem: typeof e.subKem === 'string' ? e.subKem : '',
          exp: typeof e.exp === 'number' ? e.exp : 0,
        };
      });
  } catch {
    return [];
  }
}

/** Owner: mint a member cap for a pasted join request + add them to the keyring. */
export async function inviteMember(
  session: Session,
  roomId: string,
  requestJson: string,
  canWrite = true,
): Promise<string> {
  const req = JSON.parse(requestJson) as JoinRequest;
  if (!req.edPub || !req.kemPub || !req.userId) throw new Error('That is not a valid join request.');
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: req.edPub, kemPubHex: req.kemPub, userIdHex: req.userId },
    'chat',
    memberScope(roomId, canWrite),
  );
  await addMemberEntry(session.chatClient, membersName(roomId), cap, {
    label: req.userId.slice(0, 8),
    addedBy: session.userId,
  });
  await addCollectionRecipient(
    session.chatClient,
    keyringName(roomId),
    { subKem: req.kemPub, userId: req.userId, label: req.userId.slice(0, 8) },
    { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
    { trustedAdders: [session.keys.edPub] },
  );
  await reSealRoomAtCurrentEpoch(session.chatClient, session.keys, roomId);
  return JSON.stringify(cap);
}

async function revokeCap(
  keys: Session['keys'],
  userId: string,
  target: { sub: string; nonce: string; exp: number },
): Promise<void> {
  const key = `octochat.revlist.${userId}`;
  let ledger: { generation: number; revoked: typeof target[] } = { generation: 0, revoked: [] };
  const raw = await kvGet(key);
  if (raw) {
    try {
      ledger = JSON.parse(raw);
    } catch {
      /* fresh */
    }
  }
  const revoked = ledger.revoked.filter((e) => !(e.sub === target.sub && e.nonce === target.nonce));
  revoked.push(target);
  const generation = ledger.generation + 1;
  const unsigned = { v: 1 as const, iss: keys.edPub, issUserId: userId, generation, revoked };
  const sig = ed25519.sign(new TextEncoder().encode(stableStringify(unsigned)), hexToBytes(keys.edPriv));
  try {
    await fetch(`${SYNC_BASE}/revocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...unsigned, sig: bytesToBase64(sig) }),
    });
    await kvSet(key, JSON.stringify({ generation, revoked }));
  } catch {
    /* best-effort; keyring epoch rotation below is the real lockout */
  }
}

/** Owner: revoke a member — rotate keyring epoch, drop directory entry, revoke cap. */
export async function revokeMember(session: Session, roomId: string, member: MemberRow): Promise<void> {
  await revokeCap(session.keys, session.userId, { sub: member.sub, nonce: member.nonce, exp: member.exp });
  if (member.subKem) {
    await removeRecipient(
      session.chatClient,
      keyringName(roomId),
      [member.subKem],
      { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
      { trustedAdders: [session.keys.edPub] },
    );
  }
  if (member.nonce) await removeMemberEntry(session.chatClient, membersName(roomId), member.nonce).catch(() => {});
}

/** Invitee: accept a member cap → store it + confirm keyring access. Returns roomId. */
export async function acceptInvite(session: Session, capJson: string): Promise<string> {
  const cap = JSON.parse(capJson) as { sub?: string; iss?: string; scope?: { paths?: string[] } };
  if (cap.sub && cap.sub !== session.keys.edPub) {
    throw new Error('This invite was issued for a different identity.');
  }
  if (!cap.iss) throw new Error('This invite is missing its issuer.');
  const roomId = roomIdFromCap(cap);
  if (!roomId) throw new Error('This invite is not scoped to a room.');
  const client = makeClient(cap, session.keys.edPriv);
  const enc = await buildEncryptor(client, session.keys, roomId, [cap.iss]);
  if (!enc) throw new Error("Accepted, but you're not in the room keyring yet — ask the owner to re-invite.");
  saveMemberCap(roomId, capJson);
  return roomId;
}

export { getMemberCap, bytesToHex };
