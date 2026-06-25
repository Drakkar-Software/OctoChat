import type { User } from '@drakkar.software/octochat-sdk';
import { useAvatars, usePseudos } from './use-pseudos';

/**
 * Resolve one user's public profile (pseudo + avatar) into a display {@link User},
 * via the shared profile cache the message stream already fills — so navigating
 * from a chat author the screen has already seen shows instantly, with no extra
 * fetch. Unlike `authorFor`, this never substitutes "You": a profile names the
 * person even when it's yourself. Falls back to the hex-id prefix + monogram
 * until a pseudo/avatar arrives (or for users who never set one).
 */
export function useUserProfile(userId: string): User {
  const pseudo = usePseudos([userId]);
  const avatar = useAvatars([userId]);
  const named = pseudo(userId)?.trim();
  const display = named || userId.slice(0, 8);
  return {
    id: userId,
    name: display,
    handle: named ? `@${named}` : `@${userId.slice(0, 6)}`,
    initials: display.slice(0, 2).toUpperCase(),
    avatar: avatar(userId),
  };
}
