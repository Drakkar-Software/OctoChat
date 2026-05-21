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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify([...lists.values()]));
    } catch (e) {
      console.warn(`[OctoChat] revocation-store: failed to persist ${filePath}:`, e);
    }
  }

  return {
    isRevoked: (iss, capSub, capNonce) => inner.isRevoked(iss, capSub, capNonce),
    acceptList: (list) => {
      const res = inner.acceptList(list);
      if (res.ok) {
        lists.set(list.iss, list);
        persist();
      }
      return res;
    },
  };
}
