import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface PinPadProps {
  onDigit: (digit: string) => void;
  onDelete: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/** Numeric keypad for device-PIN entry. */
export function PinPad({ onDigit, onDelete }: PinPadProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {KEYS.map((k, i) => {
        if (k === '') return <View key={i} style={styles.key} />;
        const isDelete = k === 'del';
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={isDelete ? 'Delete' : k}
            onPress={() => {
              tapFeedback();
              isDelete ? onDelete() : onDigit(k);
            }}
            style={[styles.key, styles.keyBtn, { backgroundColor: colors.paper, borderColor: colors.lineSoft }]}
          >
            {isDelete ? (
              <Icon name="x" size={18} color={colors.inkSoft} />
            ) : (
              <Txt variant="title" weight="medium">
                {k}
              </Txt>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  key: { flexBasis: '31%', aspectRatio: 1.7, alignItems: 'center', justifyContent: 'center' },
  keyBtn: { borderRadius: radii.md, borderWidth: 1 },
});
