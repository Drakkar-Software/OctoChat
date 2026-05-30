/**
 * Offline-first cache for public profiles (pseudo + inline avatar).
 *
 * Profiles are PUBLIC plaintext — `readProfile` is a raw unauthenticated GET and
 * `readProfiles` fans in via `/batch/pull`, so neither flows through the SDK's
 * read-through pull cache. This tiny kv cache gives them the same offline-first
 * behavior: a successful read is persisted per user, and a read that fails because
 * the device is offline falls back to the last-known pseudo/avatar — so names and
 * avatars don't vanish from the UI offline. No E2EE concern (public data).
 */
import { kvGet, kvSet } from './kv';
import type { PublicProfile } from './client';

const key = (userId: string) => `octochat.profile.v1.${userId}`;

/** Persist a freshly-read profile (fire-and-forget). */
export function cacheProfile(userId: string, profile: PublicProfile): void {
  void kvSet(key(userId), JSON.stringify(profile)).catch(() => {});
}

/** Last-known profile for a user, or null if never cached / unparseable. */
export async function loadCachedProfile(userId: string): Promise<PublicProfile | null> {
  try {
    const raw = await kvGet(key(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PublicProfile>;
    return {
      pseudo: typeof d.pseudo === 'string' ? d.pseudo : null,
      avatar: typeof d.avatar === 'string' ? d.avatar : null,
      edPub: typeof d.edPub === 'string' ? d.edPub : null,
      kemPub: typeof d.kemPub === 'string' ? d.kemPub : null,
    };
  } catch {
    return null;
  }
}
