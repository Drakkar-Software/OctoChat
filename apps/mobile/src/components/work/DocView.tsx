import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useDoc } from '@/lib/use-doc';
import { useTheme } from '@/lib/use-theme';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/**
 * Live doc body for one `doc` Object — renders the synced block list (merge-doc). The
 * rich block editor is a later milestone; this is the read view plus a minimal
 * "add paragraph" so the synced block model is exercised end-to-end. Title/emoji live
 * on the index node (shown in the screen header / breadcrumbs), not here.
 */
export function DocView({ spaceId, objectId, emoji, title }: { spaceId: string; objectId: string; emoji?: string; title?: string }) {
  const { colors } = useTheme();
  const { blocks, ready, offline, upsertBlock } = useDoc(spaceId, objectId);

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        {emoji ? <Txt style={styles.emoji}>{emoji}</Txt> : null}
        <Txt variant="display" weight="bold">
          {title || 'Untitled'}
        </Txt>
      </View>

      {offline ? (
        <Callout tone="info" iconName="info">
          Offline — showing the last synced version.
        </Callout>
      ) : null}

      {blocks.length === 0 ? (
        <Callout tone="info" iconName="info">
          Empty doc. The encrypted block editor lands here soon.
        </Callout>
      ) : (
        blocks.map((b) => {
          if (b.type === 'h2') return <Txt key={b.id} variant="title" weight="bold" style={styles.block}>{b.text}</Txt>;
          if (b.type === 'quote')
            return (
              <View key={b.id} style={[styles.quote, { borderLeftColor: colors.accentBorder, backgroundColor: colors.accentBg }]}>
                <Txt variant="body" tone="inkSoft">{b.text}</Txt>
              </View>
            );
          if (b.type === 'bullets')
            return (
              <View key={b.id} style={styles.block}>
                {(b.items ?? []).map((it, i) => (
                  <View key={i} style={styles.bullet}>
                    <Txt variant="body" tone="inkFaint">•</Txt>
                    <Txt variant="body" style={styles.bulletText}>{it}</Txt>
                  </View>
                ))}
              </View>
            );
          return <Txt key={b.id} variant="body" style={styles.block}>{b.text}</Txt>;
        })
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add paragraph"
        disabled={!ready}
        onPress={() => upsertBlock({ type: 'p', text: 'New paragraph' })}
        style={[styles.add, { borderColor: colors.lineFaint, opacity: ready ? 1 : 0.5 }]}
      >
        <Icon name="plus" size={13} color={colors.inkMuted} />
        <Txt variant="caption" tone="inkMuted">Add paragraph</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emoji: { fontSize: 34 },
  block: { gap: 4 },
  quote: { borderLeftWidth: 3, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  bullet: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bulletText: { flex: 1 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.md, borderWidth: 1 },
});
