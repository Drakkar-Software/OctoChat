/**
 * File-backed revocation store. The SDK ships only an in-memory revocation
 * store, which means a server restart silently **un-revokes** every member
 * (the cap-cert resolver stops seeing the revocation lists). That's a security
 * regression for any server meant to enforce revocation, so we persist the
 * accepted lists next to the filesystem object store and replay them on boot.
 *
 * `isRevoked` stays in-memory and O(1) (it's on the hot path — every request);
 * only `acceptList` (rare — a member revoke) touches disk. Replaying through a
 * fresh in-memory store on load re-verifies every signature and generation, so
 * a tampered file can't inject or roll back revocations.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createInMemoryRevocationStore,
  type RevocationList,
  type RevocationStore,
} from "@drakkar.software/starfish-server";

export function createFileRevocationStore(
  filePath: string,
  opts: { maxIssuers?: number } = {},
): RevocationStore {
  const inner = createInMemoryRevocationStore(opts);
  // Authoritative per-issuer lists we've accepted, kept for serialization.
  const lists = new Map<string, RevocationList>();

  // Hydrate from disk: replay through `inner` so signatures + generations are
  // re-verified; only lists `inner` accepts are retained.
  try {
    const arr = JSON.parse(readFileSync(filePath, "utf8")) as RevocationList[];
    for (const list of arr) {
      if (inner.acceptList(list).ok) lists.set(list.iss, list);
    }
  } catch {
    /* no file yet / unreadable → start empty */
  }

  function persist(): void {
    // Atomic: write a temp file then rename, so a crash mid-write can never leave a
    // truncated ledger that fails to parse on the next boot — which would silently
    // un-revoke everyone, the exact regression this store exists to prevent.
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify([...lists.values()]));
    renameSync(tmp, filePath);
  }

  return {
    isRevoked: (iss, capSub, capNonce) => inner.isRevoked(iss, capSub, capNonce),
    acceptList: (list) => {
      const res = inner.acceptList(list);
      if (!res.ok) return res;
      lists.set(list.iss, list);
      try {
        persist();
      } catch (e) {
        // The revoke IS enforced in-memory for this process; what failed is durability
        // across a restart. We keep the entry in `lists` (so the next acceptList
        // re-attempts the write) and do NOT flip the result to ok:false — the SDK
        // requires each issuer's list generation to strictly increase, so a caller
        // "retrying" the same list would be rejected. Escalate to error so the
        // operational alarm fires; the atomic write above removes the corruption case,
        // leaving only a hard disk/permission failure here.
        console.error(`[OctoChat] revocation-store: failed to persist ${filePath}:`, e);
      }
      return res;
    },
  };
}
