import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { glowShadow, radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Avatar } from './Avatar';
import { PulseHalo } from './PulseHalo';
import { Txt } from './Txt';

interface ProfileHeroProps {
  name: string;
  handle?: string;
  avatarLabel: string;
  image?: string | null;
  /** The viewer's OWN identity → the accent ring breathes (bioluminescent). Other
   *  people's profiles get a calm hero — fixes the backwards self/other ring. */
  self?: boolean;
}

const AVATAR = 76;

/** Identity hero: the avatar floats over a subaquatic depth band; your own identity
 *  breathes inside a bioluminescent halo, others read calm. Shared by the You and
 *  public-profile screens so identity is the memorable thing, not chrome. */
export function ProfileHero({ name, handle, avatarLabel, image, self = false }: ProfileHeroProps) {
  const { colors } = useTheme();
  const avatar = <Avatar label={avatarLabel} image={image ?? undefined} size={AVATAR} />;
  return (
    <View style={[styles.hero, { borderColor: colors.lineSoft, borderTopColor: colors.hairlineHi }, shadows.sm]}>
      <LinearGradient colors={[colors.depthTop, colors.depthBottom]} style={[StyleSheet.absoluteFill, styles.fill]} />
      {self ? (
        <View style={glowShadow(colors.glow, 0.4, 22)}>
          <PulseHalo size={AVATAR + 16} color={colors.accent} rings={3}>
            {avatar}
          </PulseHalo>
        </View>
      ) : (
        avatar
      )}
      <Txt variant="display" weight="bold" center numberOfLines={1} style={styles.name}>
        {name}
      </Txt>
      {handle ? (
        <Txt variant="footnote" mono tone="inkMuted" center numberOfLines={1}>
          {handle}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1,
  },
  fill: { borderRadius: radii.card },
  name: { marginTop: spacing.sm },
});
