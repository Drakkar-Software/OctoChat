import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { avatarTint, glowShadow, presenceColor, type PresenceStatus } from '@/theme';
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
  /** Tint the monogram deterministically by `label` so a list of image-less
   *  avatars is distinguishable instead of a wall of grey. Opt-in. */
  tint?: boolean;
}

/** Avatar — an uploaded image clipped to a circle when present, else a softly
 *  dimensional monogram. Optional presence dot and accent glow ring. */
export function Avatar({ label, size = 36, ring = false, presence, image, tint = true }: AvatarProps) {
  const { colors } = useTheme();
  const t = tint ? avatarTint(colors, label) : null;
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
          colors={t ? [t.bg, colors.fillDeep] : [colors.fill, colors.fillDeep]}
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
          <Txt mono weight="semibold" color={t ? t.fg : colors.inkSoft} style={{ fontSize: glyph, lineHeight: glyph + 1 }}>
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

interface AvatarStackProps {
  /** Labels (monograms) for the members to show, in order. */
  labels: string[];
  size?: number;
  /** Cap the visible avatars; the remainder collapses into a "+N" disc. */
  max?: number;
  /** Tint each monogram deterministically by its label (passed to Avatar). */
  tint?: boolean;
}

/** Overlapping cluster of avatars with a paper hairline ring between each, and a
 *  trailing "+N" disc when the member count exceeds `max`. For member-count rows
 *  (space members, room participants). */
export function AvatarStack({ labels, size = 28, max = 4, tint = true }: AvatarStackProps) {
  const { colors } = useTheme();
  const overlap = Math.round(size * 0.36);
  const shown = labels.slice(0, max);
  const extra = labels.length - shown.length;
  const glyph = Math.max(9, Math.round(size * 0.34));
  return (
    <View style={styles.stack}>
      {shown.map((label, i) => (
        <View
          key={`${label}-${i}`}
          style={[
            styles.stackItem,
            { marginLeft: i === 0 ? 0 : -overlap, borderRadius: size / 2, borderColor: colors.paper },
          ]}
        >
          <Avatar label={label} size={size} tint={tint} />
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.stackItem,
            styles.circle,
            {
              width: size,
              height: size,
              marginLeft: shown.length === 0 ? 0 : -overlap,
              borderRadius: size / 2,
              borderColor: colors.paper,
              backgroundColor: colors.fillDeep,
            },
          ]}
        >
          <Txt mono weight="semibold" color={colors.inkSoft} style={{ fontSize: glyph, lineHeight: glyph + 1 }}>
            {`+${extra}`}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  // A paper ring separates each overlapping avatar from the one beneath it.
  stackItem: { borderWidth: 2 },
});
