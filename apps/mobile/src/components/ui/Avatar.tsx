import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { glowShadow, presenceColor, type PresenceStatus } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Txt } from './Txt';

interface AvatarProps {
  label: string;
  size?: number;
  /** Accent ring + glow (e.g. active DM, the signed-in identity). */
  ring?: boolean;
  presence?: PresenceStatus;
  /** Uploaded avatar (a data URI / URL). Falls back to the monogram when absent
   *  or if the image fails to load. */
  image?: string | null;
}

/** Avatar — an uploaded image clipped to a circle when present, else a softly
 *  dimensional monogram. Optional presence dot and accent glow ring. */
export function Avatar({ label, size = 36, ring = false, presence, image }: AvatarProps) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  // A fresh image clears any prior load error so a re-pick can recover.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset the load-error flag when `image` changes
  useEffect(() => setFailed(false), [image]);
  const showImage = !!image && !failed;
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
            borderTopColor: ring ? colors.accent : colors.hairlineHi,
          },
          ring ? glowShadow(colors.glow, 0.32, 7) : null,
        ]}
      >
        <LinearGradient
          colors={[colors.fill, colors.fillDeep]}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        />
        {showImage ? (
          <Image
            source={{ uri: image! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            onError={() => setFailed(true)}
            accessibilityLabel={label}
          />
        ) : (
          <Txt mono weight="semibold" color={colors.inkSoft} style={{ fontSize: glyph, lineHeight: glyph + 1 }}>
            {label}
          </Txt>
        )}
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
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2 },
});
