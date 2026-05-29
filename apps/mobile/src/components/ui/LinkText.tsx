import { Platform, StyleSheet } from 'react-native';

import { linkify, matchesUser, openRoom, openUrl } from '@/lib/links';
import type { Room } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';

import { Txt, type TxtProps } from './Txt';

interface LinkTextProps extends Omit<TxtProps, 'children'> {
  /** The raw message text; URLs and `#channel` / `@user` mentions are styled. */
  children: string;
  /** Resolve a `#channel` mention to a room so it can link; unknown names stay
   *  plain text. Omit to render mentions as plain text. */
  resolveRoom?: (name: string) => Room | undefined;
  /** Resolve an `@user` mention to a user id so it can open that user's profile;
   *  unknown names stay plain text. Omit to render `@user` mentions inert. */
  resolveUser?: (name: string) => string | undefined;
  /** Open a resolved `@user` mention's profile — wired together with
   *  {@link resolveUser}, the `@`-mention twin of an author-name tap. */
  onPressUser?: (userId: string) => void;
  /** The viewer's pseudo — an `@mention` of it renders as a highlighted chip so
   *  you can spot where you were named. */
  currentUserName?: string;
}

/**
 * Renders text with inline links + mentions: external URLs open in the browser,
 * `#channel` mentions navigate to the room, `@user` mentions are styled (and the
 * viewer's own gets a highlight chip). Links stay inline (nested `<Txt>`) so they
 * wrap with the surrounding prose. Built on {@link Txt} so type scale, font and
 * tone match the paragraph they sit in.
 */
export function LinkText({
  children,
  resolveRoom,
  resolveUser,
  onPressUser,
  currentUserName,
  variant = 'body',
  weight,
  ...rest
}: LinkTextProps) {
  const { colors } = useTheme();
  const segments = linkify(children);
  return (
    <Txt variant={variant} weight={weight} {...rest}>
      {segments.map((seg, i) => {
        if (seg.url) {
          return (
            <Txt
              key={i}
              variant={variant}
              weight={weight}
              tone="accent"
              style={styles.url}
              accessibilityRole="link"
              onPress={() => openUrl(seg.url!)}
            >
              {seg.text}
            </Txt>
          );
        }
        const room = seg.room ? resolveRoom?.(seg.room) : undefined;
        if (room) {
          return (
            <Txt
              key={i}
              variant={variant}
              weight="medium"
              tone="accent"
              style={styles.link}
              accessibilityRole="link"
              onPress={() => openRoom(room)}
            >
              {seg.text}
            </Txt>
          );
        }
        if (seg.user) {
          const self = matchesUser(seg.user, currentUserName);
          // Resolve to a user id so the mention opens that profile, mirroring the
          // `#channel` path above. Unresolved (a non-poster) → inert styled text.
          const userId = resolveUser?.(seg.user);
          const press = userId && onPressUser ? () => onPressUser(userId) : undefined;
          return (
            <Txt
              key={i}
              variant={variant}
              weight={self ? 'semibold' : 'medium'}
              tone={self ? 'accentInk' : 'accent'}
              style={[self ? { backgroundColor: colors.accentSoft } : null, press ? styles.link : null]}
              accessibilityRole={press ? 'link' : undefined}
              onPress={press}
            >
              {seg.text}
            </Txt>
          );
        }
        return seg.text;
      })}
    </Txt>
  );
}

// `cursor` isn't in RN's style types but react-native-web honors it; without it
// a pressable `<Txt>` shows no pointer on hover (only Pressable gets one for free).
const link = Platform.select({ web: { cursor: 'pointer' } as object, default: {} });

const styles = StyleSheet.create({
  url: { textDecorationLine: 'underline', ...link },
  link,
});
