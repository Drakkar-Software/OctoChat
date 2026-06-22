import type { SpaceAccessEntry } from '@drakkar.software/starfish-spaces';

/**
 * Resolve BOTH the cap object AND the correct signing key from a
 * {@link SpaceAccessEntry}:
 *
 * - `member`-kind: parse the JSON-encoded cap string; sign with the account
 *   `edPriv` key (same as the account device key).
 * - `link`-kind: cap is already a parsed object; sign with `entry.key` (the
 *   ephemeral bearer key bound to the link cap — NOT the account key).
 * - absent / parse-error: fall back to the provided defaults.
 *
 * This is the correct resolver for callers that build a `capProvider` from
 * `capProviderFor(cap, signKey)`, because `capProviderFor` must be given the
 * key whose public half matches the cap's subject field.
 */
export function resolveMemberAuth(
  entry: SpaceAccessEntry | null | undefined,
  fallbackCap: unknown,
  fallbackSignKey: string,
): { cap: unknown; signKey: string } {
  if (!entry) return { cap: fallbackCap, signKey: fallbackSignKey };
  if (entry.kind === 'member') {
    try {
      return { cap: JSON.parse(entry.cap), signKey: fallbackSignKey };
    } catch {
      return { cap: fallbackCap, signKey: fallbackSignKey };
    }
  }
  // link-kind: cap is already a parsed object; entry.key is the ephemeral link
  // signing key whose public half is the cap's subject.
  return { cap: entry.cap, signKey: entry.key };
}
