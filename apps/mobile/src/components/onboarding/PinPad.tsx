import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion, radii, spacing } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface PinPadProps {
  onDigit: (digit: string) => void;
  onDelete: () => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

function PinKey({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const isDelete = label === 'del';
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={isDelete ? 'Delete' : label}
      {...hoverProps}
      onPressIn={() => {
        scale.value = withTiming(0.93, { duration: motion.fast });
        tapFeedback();
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: motion.fast });
      }}
      onPress={onPress}
      style={[
        styles.key,
        styles.keyBtn,
        {
          backgroundColor: hovered ? colors.accentBg : colors.paper,
          borderColor: hovered ? colors.accentBorder : colors.lineSoft,
          borderTopColor: colors.hairlineHi,
        },
        animStyle,
      ]}
    >
      {isDelete ? (
        <Icon name="x" size={18} color={colors.inkSoft} />
      ) : (
        <Txt variant="title" weight="medium">
          {label}
        </Txt>
      )}
    </AnimatedPressable>
  );
}

/** Numeric keypad for device-PIN entry. */
export function PinPad({ onDigit, onDelete }: PinPadProps) {
  return (
    <View style={styles.grid}>
      {KEYS.map((k, i) =>
        k === '' ? (
          <View key={i} style={styles.key} />
        ) : (
          <PinKey key={i} label={k} onPress={() => (k === 'del' ? onDelete() : onDigit(k))} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  key: { flexBasis: '31%', aspectRatio: 1.7, alignItems: 'center', justifyContent: 'center' },
  keyBtn: { borderRadius: radii.md, borderWidth: 1 },
});
