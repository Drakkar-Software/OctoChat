import { Platform, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { openRoom, openUrl } from '@/lib/links';
import { parseInline, parseMarkdown, type InlineToken } from '@drakkar.software/octochat-sdk';
import type { Room } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';

import { CodeBlock } from './CodeBlock';
import { LinkText } from './LinkText';
import { Txt, type TxtProps } from './Txt';

interface MarkdownProps {
  /** Raw Markdown source. */
  source: string;
  /** Forwarded to {@link LinkText} so `#channel` mentions can link. */
  resolveRoom?: (name: string) => Room | undefined;
  /** Forwarded to {@link LinkText} so `@user` mentions can open a profile. */
  resolveUser?: (name: string) => string | undefined;
  /** Forwarded to {@link LinkText}: open a tapped `@user` mention's profile. */
  onPressUser?: (userId: string) => void;
  /** Forwarded to {@link LinkText}: the viewer's pseudo, for the self-mention chip. */
  currentUserName?: string;
}

type MentionProps = Pick<MarkdownProps, 'resolveRoom' | 'resolveUser' | 'onPressUser' | 'currentUserName'>;

// Heading level → type-scale variant. Bricolage display for H1/H2 makes a doc
// read like an editorial page rather than a flat block list.
const HEADING_VARIANT: Record<number, NonNullable<TxtProps['variant']>> = {
  1: 'display',
  2: 'title',
  3: 'heading',
  4: 'subhead',
  5: 'body',
  6: 'callout',
};

/** Render one block's inline tokens. Plain text flows through {@link LinkText}
 *  (URLs + `#`/`@` mentions); emphasis/code/links are leaf spans. */
function Inline({ tokens, mention }: { tokens: InlineToken[]; mention: MentionProps }) {
  const { colors } = useTheme();
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === 'code')
          return (
            <Txt key={i} variant="body" mono style={{ backgroundColor: colors.codeBg, color: colors.accentInk }}>
              {t.value}
            </Txt>
          );
        if (t.type === 'strong')
          return (
            <Txt key={i} variant="body" weight="bold">
              {t.value}
            </Txt>
          );
        if (t.type === 'em')
          return (
            <Txt key={i} variant="body" style={styles.em}>
              {t.value}
            </Txt>
          );
        if (t.type === 'link')
          return (
            <Txt key={i} variant="body" tone="accent" style={styles.link} accessibilityRole="link" onPress={() => openUrl(t.url)}>
              {t.label}
            </Txt>
          );
        return (
          <LinkText key={i} variant="body" {...mention}>
            {t.value}
          </LinkText>
        );
      })}
    </>
  );
}

/**
 * Renders Markdown through the app's `<Txt>` primitive + theme tokens only (no
 * hardcoded sizes/colors). Generic — docs render their block bodies with it, and
 * anything else needing Markdown can reuse it. Mentions stay live via
 * {@link LinkText}, fenced code via {@link CodeBlock}.
 */
export function Markdown({ source, ...mention }: MarkdownProps) {
  const { colors } = useTheme();
  const blocks = parseMarkdown(source);

  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        if (b.type === 'code') return <CodeBlock key={i} value={b.value} />;
        if (b.type === 'heading') {
          // A heading that names a known room becomes a link to it (used by the
          // AI catch-up summary, which heads each section with the room name).
          const room = mention.resolveRoom?.(b.text);
          return (
            <Txt
              key={i}
              variant={HEADING_VARIANT[b.level]}
              weight="bold"
              tone={room ? 'accent' : undefined}
              style={room ? styles.headingLink : undefined}
              accessibilityRole={room ? 'link' : 'header'}
              onPress={room ? () => openRoom(room) : undefined}
            >
              {b.text}
            </Txt>
          );
        }
        if (b.type === 'quote')
          return (
            <View key={i} style={[styles.quote, { borderLeftColor: colors.accentBorder, backgroundColor: colors.accentBg }]}>
              <Txt variant="body" tone="inkSoft">
                <Inline tokens={parseInline(b.text)} mention={mention} />
              </Txt>
            </View>
          );
        if (b.type === 'bullets' || b.type === 'ordered')
          return (
            <View key={i} style={styles.list}>
              {b.items.map((it, j) => (
                <View key={j} style={styles.listRow}>
                  <Txt variant="body" tone="inkFaint" style={styles.marker}>
                    {b.type === 'ordered' ? `${j + 1}.` : '•'}
                  </Txt>
                  <Txt variant="body" style={styles.itemText}>
                    <Inline tokens={parseInline(it)} mention={mention} />
                  </Txt>
                </View>
              ))}
            </View>
          );
        return (
          <Txt key={i} variant="body">
            <Inline tokens={parseInline(b.text)} mention={mention} />
          </Txt>
        );
      })}
    </View>
  );
}

export type { MarkdownProps };

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  em: { fontStyle: 'italic' },
  link: { textDecorationLine: 'underline' },
  headingLink: Platform.select({ web: { cursor: 'pointer' } as object, default: {} }),
  quote: { borderLeftWidth: 3, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  list: { gap: spacing.xs },
  listRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  marker: { minWidth: spacing.lg },
  itemText: { flex: 1 },
});
