import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { groupBodyTokens, parseMessageBody } from '@drakkar.software/octochat-sdk';
import type { Room } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';

import { CopyButton } from '@/components/ui/CopyButton';
import { LinkText } from '@/components/ui/LinkText';
import { Txt, type TxtProps } from '@/components/ui/Txt';

interface MessageBodyProps {
  /** The raw message text — code spans/blocks are formatted, the rest keeps
   *  prose linkification (URLs + `#channel` / `@user` mentions). */
  body: string;
  /** Tone for the prose (plain-text + inline-code runs). Defaults to `inkSoft`,
   *  matching the message-list paragraph color. */
  tone?: TxtProps['tone'];
  /** Forwarded to {@link LinkText} so `#channel` mentions can link. */
  resolveRoom?: (name: string) => Room | undefined;
  /** Forwarded to {@link LinkText} so `@user` mentions can open a profile. */
  resolveUser?: (name: string) => string | undefined;
  /** Forwarded to {@link LinkText}: open a tapped `@user` mention's profile. */
  onPressUser?: (userId: string) => void;
  /** Forwarded to {@link LinkText}: the viewer's pseudo, for the self-mention chip. */
  currentUserName?: string;
}

/**
 * Renders a chat message body with code formatting layered over the existing
 * prose linkification. The parser ({@link parseMessageBody}) splits the body into
 * text / inline-code / fenced-block tokens; runs of inline tokens flow together
 * inside one wrapping `<Txt>` (text via {@link LinkText} so links + mentions stay
 * live, inline code as a monospace span), while fenced blocks break out into a
 * bordered, horizontally-scrollable monospace block with a copy button.
 */
export function MessageBody({
  body,
  tone = 'inkSoft',
  resolveRoom,
  resolveUser,
  onPressUser,
  currentUserName,
}: MessageBodyProps) {
  const { colors } = useTheme();
  // Parse into typed tokens, then group inline runs into paragraphs (each fenced
  // block stands alone) — both are pure helpers from `message-format`. Memoized:
  // the body string is stable per message, and the two chained pure calls aren't
  // reliably collapsed by React Compiler since they feed a .map() allocation.
  const blocks = useMemo(() => groupBodyTokens(parseMessageBody(body)), [body]);
  const codeSpan = { backgroundColor: colors.codeBg, color: colors.accentInk };

  return (
    <View style={styles.wrap}>
      {blocks.map((group, gi) => {
        const first = group[0];
        if (first.type === 'codeblock') {
          return (
            <View
              key={gi}
              style={[styles.block, { backgroundColor: colors.codeBg, borderColor: colors.codeBorder }]}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockScroll}>
                <Txt variant="caption" mono tone="inkSoft" selectable>
                  {first.value}
                </Txt>
              </ScrollView>
              <View style={styles.copy}>
                <CopyButton value={first.value} />
              </View>
            </View>
          );
        }
        // An inline paragraph: text via LinkText, inline code as a mono span,
        // all nested in one Txt so they wrap as a single flowing line.
        return (
          <Txt key={gi} variant="body" tone={tone} selectable>
            {group.map((token, ti) =>
              token.type === 'code' ? (
                <Txt key={ti} variant="body" mono style={codeSpan}>
                  {token.value}
                </Txt>
              ) : (
                <LinkText
                  key={ti}
                  variant="body"
                  tone={tone}
                  resolveRoom={resolveRoom}
                  resolveUser={resolveUser}
                  onPressUser={onPressUser}
                  currentUserName={currentUserName}
                >
                  {token.value}
                </LinkText>
              ),
            )}
          </Txt>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  block: {
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingVertical: spacing.sm,
  },
  // Extra right padding keeps a short one-line snippet from sliding under the
  // floating copy button in the corner.
  blockScroll: { paddingLeft: spacing.sm, paddingRight: spacing.xxl },
  // Float the copy affordance in the block's top-right corner.
  copy: { position: 'absolute', top: spacing.xs, right: spacing.xs },
});
