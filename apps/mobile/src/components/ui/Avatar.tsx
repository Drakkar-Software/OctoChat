import { StyleSheet, View } from 'react-native';

import { presenceColor, type PresenceStatus } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Txt } from './Txt';

interface AvatarProps {
  label: string;
  size?: number;
  /** Accent ring (e.g. active DM). */
  ring?: boolean;
  presence?: PresenceStatus;
}

/** Monogram avatar with optional presence dot. */
export function Avatar({ label, size = 36, ring = false, presence }: AvatarProps) {
  const { colors } = useTheme();
  const dot = Math.max(8, size * 0.28);
  const glyph = Math.max(9, Math.round(size * 0.34));
  return (
    <View>
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.fillDeep,
            borderWidth: ring ? 2 : 1,
            borderColor: ring ? colors.accent : colors.lineSoft,
          },
        ]}
      >
        <Txt mono weight="semibold" color={colors.inkMuted} style={{ fontSize: glyph, lineHeight: glyph + 1 }}>
          {label}
        </Txt>
      </View>
      {presence ? (
        <View
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: presenceColor(colors, presence),
              borderColor: colors.paper,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2 },
});
