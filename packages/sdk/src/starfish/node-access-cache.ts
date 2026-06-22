/**
 * In-flight / result cache for {@link buildNodeAccess} (the non-owner, soft path).
 *
 * Without this, every concurrent room/doc/notification/automation open for an enc
 * node fires its own `spaces/{spaceId}/_keyring` pull. At startup, with ~6
 * always-mounted surfaces and render-churn before deps stabilise, the same space's
 * keyring can be pulled 20+ times concurrently — tripping the server's rate limiter
 * (HTTP 429) and producing a self-amplifying retry storm.
 *
 * This module wraps `buildNodeAccess` with:
 *  - An **in-flight** Map: concurrent callers with the same key share one Promise
 *    (only the first call fires a network request; the rest join it).
 *  - A **resolved result** cache: subsequent calls in the same session return
 *    immediately without any network hop.
 *
 * Cache key strategy:
 *  - `enc: false` (plaintext): not cached. `buildNodeAccess` resolves synchronously
 *    with no keyring pull, so de-dup adds no value.
 *  - `enc: true, access !== 'invite'`: keyed by `{userId}:{spaceId}`. The underlying
 *    `_keyring` pull is space-wide (octospaces-sdk `buildNodeAccess` always resolves
 *    `getSpaceAccessEntry(spaceId)` for regular members — no per-node content entry
 *    exists for non-invite nodes), so all non-invite enc nodes in a space share the
 *    identical client + encryptor. Collapsing M nodes to 1 key → 1 keyring pull/space
 *    (vs. up to 1 pull per enc node per concurrent open without caching).
 *  - `enc: true, access === 'invite'`: keyed by `{userId}:{spaceId}:{nodeId}:invite`.
 *    Each invite+enc node has its own per-node keyring, so de-dup is per-node.
 *
 * `null` results (no keyring access) are NOT cached: the access state may change
 * within a session (e.g. the owner grants access). In-flight de-dup still applies
 * while a null-returning call is in progress.
 *
 * Call {@link clearBuildNodeAccessCache} on account switch / sign-out alongside
 * {@link clearNodeAccessCache} and `clearPseudoCache`.
 */
import { buildNodeAccess } from '@drakkar.software/starfish-spaces';
import type { NodeAccess, Session } from '@drakkar.software/octospaces-sdk';

type NodeAccessResult = Awaited<ReturnType<typeof buildNodeAccess>>;

const inflight = new Map<string, Promise<NodeAccessResult>>();
const resolved = new Map<string, NonNullable<NodeAccessResult>>();

function cacheKey(
  userId: string,
  spaceId: string,
  nodeId: string,
  node: { access?: NodeAccess; enc?: boolean },
): string | null {
  if (!node.enc) return null; // plaintext — no keyring pull, nothing to de-dup
  if (node.access === 'invite') return `${userId}:${spaceId}:${nodeId}:invite`; // per-node nodekeyring — KEEP per-node
  return `${userId}:${spaceId}`; // space-wide keyring: all non-invite enc nodes share one entry per space
}

/**
 * Deduplicating wrapper around {@link buildNodeAccess}.
 *
 * Concurrent calls with the same cache key share one in-flight Promise. Resolved
 * non-null handles are cached for the session and returned synchronously on
 * subsequent calls. Drop-in replacement for `buildNodeAccess` at every call site.
 */
export async function buildNodeAccessShared(
  session: Session,
  spaceId: string,
  nodeId: string,
  node: { access?: NodeAccess; enc?: boolean },
): Promise<NodeAccessResult> {
  const key = cacheKey(session.userId, spaceId, nodeId, node);
  if (key === null) {
    return buildNodeAccess(session, spaceId, nodeId, node);
  }

  const hit = resolved.get(key);
  if (hit !== undefined) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = buildNodeAccess(session, spaceId, nodeId, node)
    .then((result) => {
      // Cache successful opens only; null ("no access") is not cached so a later
      // attempt (e.g. after access is granted) retries normally.
      if (result !== null) resolved.set(key, result);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}

/** Drop every cached handle and in-flight entry. Call on account switch / sign-out. */
export function clearBuildNodeAccessCache(): void {
  inflight.clear();
  resolved.clear();
}
