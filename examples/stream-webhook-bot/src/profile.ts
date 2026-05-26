/**
 * Optional "give the bot a display name" half.
 *
 * By default the app shows a bot's posts under a truncated hex author id (the
 * bot has no profile). Set `BOT_NAME` and the bot publishes its PUBLIC PROFILE
 * `{ pseudo }`, which the app reads (readProfile, keyed by author id) to render
 * a friendly name everywhere that author appears.
 *
 * The `profile` collection is public-READ but write-gated on the `device:root`
 * role — granted ONLY to a self-signed device cap (`iss === sub`), see
 * apps/server config + the SDK cap-resolver. So the bot mints a device cap over
 * its OWN keypair (issuer === subject === the same key it already signs appends
 * with), which the server admits as `device:root`. The doc path
 * `user/{identity}/profile` binds `{identity}` to that key's user id — the same
 * `authorId` the bot stamps on its messages — so the profile lands on exactly
 * the author the app is resolving. Least-privilege scope: the cap can write this
 * one profile doc and nothing else.
 */
import { mintDeviceCap } from '@drakkar.software/starfish-identities';
import { signRequest, stableStringify } from '@drakkar.software/starfish-protocol';
import type { SignableMethod } from '@drakkar.software/starfish-protocol';

export interface ProfileOptions {
  /** Sync base URL (may include a mount path, e.g. `https://host/sync`). */
  serverUrl: string;
  /** Bare namespace (e.g. `octochat`) or '' for the root-mounted local dev server. */
  namespace: string;
  /** The bot's keypair — the SAME one it redeems the append token / derives `authorId` with. */
  edPubHex: string;
  edPrivHex: string;
  kemPubHex: string;
  /** The bot's `authorId` (SHA-256(edPub)[:32]) — must equal `{identity}` in the path. */
  userId: string;
}

/**
 * Publish `pseudo` as the bot's public profile display name. One signed POST to
 * `user/<userId>/profile` (a merge doc), authorized by a freshly-minted
 * self-signed device cap. Throws on a non-2xx response so the caller can
 * fail-fast — a bot the operator named should never silently fall back to a hex
 * id. Mirrors `StarfishClient.push`'s wire format (`{ data, baseHash }`); the
 * bot's per-run key means the doc never exists yet, so `baseHash: null` is a
 * first write.
 */
export async function writeBotProfile(opts: ProfileOptions, pseudo: string): Promise<void> {
  // Self-signed device cap (issuer === subject === the bot's key) → `device:root`.
  // Scoped to just this profile doc: a leaked cap can write nothing else.
  const cap = await mintDeviceCap(
    opts.edPrivHex,
    opts.edPubHex,
    { edPubHex: opts.edPubHex, kemPubHex: opts.kemPubHex },
    { ops: ['read', 'write', 'list'], collections: ['profile'], paths: [`user/${opts.userId}/profile`] },
  );

  // Namespace-prefixed action path the SERVER observes (the serverUrl mount, e.g.
  // `/sync`, is stripped by nginx before the signed path is verified) — same shape
  // as append.ts's `actionPathFor`.
  const actionPath = (opts.namespace ? `/v1/${opts.namespace}` : '') + `/push/user/${opts.userId}/profile`;
  const url = `${opts.serverUrl.replace(/\/+$/, '')}${actionPath}`;
  const host = new URL(opts.serverUrl).host;

  // Exact `StarfishClient.push` body: the full doc wrapped as `{ data, baseHash }`.
  const body = JSON.stringify({ data: { pseudo }, baseHash: null });

  // Cap-cert auth: sign the path AND body (POST folds sha256(body) into the
  // canonical input), then present the self-signed cap. Mirrors subscribe.ts's
  // `memberAuthHeaders`, but with a device cap and a signed body.
  const { alg, sig, ts, nonce } = await signRequest(
    { method: 'POST' as SignableMethod, pathAndQuery: actionPath, host, body },
    opts.edPrivHex,
  );
  const capB64 = Buffer.from(stableStringify(cap as unknown as Record<string, unknown>), 'utf-8').toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Cap ${capB64}`,
      'X-Starfish-Sig': sig,
      'X-Starfish-Ts': String(ts),
      'X-Starfish-Nonce': nonce,
      'X-Starfish-Alg': alg,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`profile write failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}
