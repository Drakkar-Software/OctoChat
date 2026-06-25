import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { layout, motion, radii, spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useArgon2Progress } from '@/lib/use-argon2-progress';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Callout } from '@/components/ui/Callout';
import { Button } from '@/components/ui/Button';
import { HeroMark } from '@/components/brand/HeroMark';

const TIPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'shield',
    title: 'Memory-hard key derivation',
    body: 'Argon2id is hashing your seed — intentionally slow and memory-intensive so brute-force attacks remain infeasible even with powerful hardware.',
  },
  {
    icon: 'zap',
    title: 'Post-quantum ready',
    body: 'Your keys include Kyber, a post-quantum algorithm selected by NIST. Your messages stay safe even as quantum computers become more powerful.',
  },
  {
    icon: 'key',
    title: 'BIP-39 recovery phrase',
    body: 'Your 12 words follow the BIP-39 standard — the same used by Bitcoin wallets. They encode 128 bits of cryptographic entropy.',
  },
  {
    icon: 'lock',
    title: 'Zero-knowledge server',
    body: "Your private keys never leave your device. The server only ever sees your public key — even a full server breach can't expose your messages.",
  },
  {
    icon: 'layers',
    title: 'Per-space keyrings',
    body: "Each space has its own keyring. Exposing one room's keys has no effect on any other conversation you're part of.",
  },
  {
    icon: 'eye-off',
    title: 'End-to-end encrypted',
    body: 'Every message is sealed before it leaves your device. Not the server, not us, not your network provider — nobody else can read your conversations.',
  },
  {
    icon: 'clock',
    title: 'Why does this take a while?',
    body: 'The Argon2id derivation is deliberately slow. The harder your identity is to create, the harder it is for an attacker to brute-force your recovery phrase.',
  },
];

const TIP_DURATION = 6000;

export default function CreatingScreen() {
  const { signIn, pendingSeed } = useSession();
  const argon2 = useArgon2Progress();
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [tipIndex, setTipIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const calledRef = useRef(false);

  // Animated values
  const tipOpacity = useSharedValue(1);
  // 0→1 progress fraction animated via scaleX (GPU-composited, no layout recalc per frame).
  const progressFraction = useSharedValue(0);

  // Tip rotation: fade out → swap → fade in.
  // Reduced motion: swap instantly (no withTiming cross-fade).
  useEffect(() => {
    const id = setInterval(() => {
      if (reducedMotion) {
        tipOpacity.value = 0;
        setTimeout(() => {
          setTipIndex((i) => (i + 1) % TIPS.length);
          tipOpacity.value = 1;
        }, 0);
      } else {
        tipOpacity.set(withSequence(
          withTiming(0, { duration: 300, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 400, easing: Easing.in(Easing.ease) }),
        ));
        setTimeout(() => setTipIndex((i) => (i + 1) % TIPS.length), 300);
      }
    }, TIP_DURATION);
    return () => clearInterval(id);
  }, [tipOpacity, reducedMotion]);

  // Progress fraction (0→1) drives scaleX — no layout recalc per frame.
  // Reduced motion: jump directly to the target value (duration: 0).
  useEffect(() => {
    if (argon2 != null) {
      progressFraction.set(
        reducedMotion
          ? withTiming(argon2, { duration: 0 })
          : withTiming(argon2, { duration: 500 }),
      );
    }
  }, [argon2, progressFraction, reducedMotion]);

  // Trigger signIn exactly once on mount
  useEffect(() => {
    if (calledRef.current || !pendingSeed) return;
    calledRef.current = true;
    signIn(pendingSeed.words)
      .then(() => router.replace('/(tabs)/rooms'))
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)));
  }, [signIn, pendingSeed]);

  const tipStyle = useAnimatedStyle(() => ({ opacity: tipOpacity.get() }));
  // scaleX on a full-width bar is GPU-composited; transformOrigin: 'left' anchors the
  // scale to the leading edge so the bar grows left→right.
  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progressFraction.get() }],
  }));

  // Web onboarding uses the lock setup screen — this route is native-only.
  if (Platform.OS === 'web') return <Redirect href="/(onboarding)/welcome" />;
  if (!pendingSeed && !error) return <Redirect href="/(onboarding)/welcome" />;

  const tip = TIPS[tipIndex];
  const pct = argon2 != null ? Math.round(argon2 * 100) : null;

  return (
    <LinearGradient
      colors={[colors.depthTop, colors.canvas, colors.depthBottom]}
      style={styles.root}
    >
      {/* Hero */}
      <View style={styles.hero}>
        <HeroMark size={layout.onboardingMark} />
        <Txt variant="display" weight="bold" style={styles.centered}>
          Creating your identity
        </Txt>
        <Txt variant="body" tone="inkSoft" style={styles.centered}>
          {error ? 'Something went wrong.' : pct != null ? `${pct}% complete` : 'Starting…'}
        </Txt>
      </View>

      {/* Progress track — bar uses scaleX (GPU) from a full-width base */}
      {!error && (
        <View style={[styles.track, { backgroundColor: colors.fill }]}>
          <Animated.View style={[styles.bar, { backgroundColor: colors.accent }, barStyle]} />
        </View>
      )}

      {/* Tip card */}
      {!error && (
        <Animated.View style={[styles.tip, { backgroundColor: colors.paper }, tipStyle]}>
          <View style={styles.tipHeader}>
            <Icon name={tip.icon} size={15} color={colors.accent} />
            <Txt variant="callout" weight="bold" color={colors.accent}>
              {tip.title}
            </Txt>
          </View>
          <Txt variant="body" tone="inkSoft">
            {tip.body}
          </Txt>
        </Animated.View>
      )}

      {/* Error state */}
      {error && (
        <View style={styles.errorArea}>
          <Callout tone="danger" iconName="alert" title="Couldn't create identity">
            {error}
          </Callout>
          <Button label="Go back" variant="ghost" iconName="arrow-l" onPress={() => router.back()} />
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.screenX, justifyContent: 'center', gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.md },
  centered: { textAlign: 'center' },
  track: { height: 4, borderRadius: radii.pill, overflow: 'hidden' },
  // Full-width base; scaleX animation shrinks it — transformOrigin pins the anchor
  // to the leading edge so the bar fills left-to-right as progress advances.
  bar: { height: '100%', width: '100%', borderRadius: radii.pill, transformOrigin: 'left' },
  tip: { borderRadius: radii.card, padding: spacing.lg, gap: spacing.sm },
  tipHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorArea: { gap: spacing.md },
});
