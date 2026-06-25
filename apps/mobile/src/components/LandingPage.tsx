import { useEffect, useRef } from 'react';
import { Animated, Linking, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

import { fonts, radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { DepthBackdrop } from '@/components/ui/DepthBackdrop';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

const FEATURES: { icon: IconName; label: string; body: string }[] = [
  { icon: 'lock',     label: 'Lock it down',   body: 'BIP-39 seed → Ed25519/Kyber keys. End-to-end encrypted. The server never sees plaintext.' },
  { icon: 'hash',     label: 'Team channels',  body: 'Rooms, threads, pins and categories. Every project and team in its own organized space.' },
  { icon: 'dm',       label: 'Private DMs',    body: 'Sealed 1:1 conversations. Only you and one other person can ever read them.' },
  { icon: 'sparkles', label: 'AI automations', body: 'On-device LLM workflows that run locally. Powerful tools that never phone home.' },
  { icon: 'devices',  label: 'Every device',   body: 'iOS, Android and web. One seed, one identity — sync seamlessly across all your devices.' },
  { icon: 'key',      label: 'Your server',    body: 'Self-hosted on Starfish. Full control over your data — no corporate cloud required.' },
];

function useFloat(duration: number, delay = 0) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration, useNativeDriver: true }),
        ])
      ).start();
    }, delay);
    return () => clearTimeout(t);
  }, [anim, delay, duration]);
  return anim;
}

/** Apply CSS properties that only exist in the web style system. */
const webCss = (css: Record<string, string | number>) =>
  Platform.OS === 'web' ? (css as any) : undefined;

export function LandingPage() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const orb1  = useFloat(4200);
  const orb2  = useFloat(5600, 700);
  const orb3  = useFloat(3800, 1400);
  const pulse = useFloat(2800);

  const year = new Date().getFullYear();

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.canvas }]}
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
    >
      {/* ─────────────────────────── HERO ─────────────────────────── */}
      <View style={[styles.hero, desktop && styles.heroDesktop]}>
        <DepthBackdrop />

        {/* Bioluminescent ambient orbs */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.orb,
            {
              backgroundColor: colors.glow,
              opacity: orb1.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.22] }),
              transform: [{ scale: orb1.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
              width: 520, height: 520, top: -100, left: -80,
            },
            webCss({ filter: 'blur(90px)' }),
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.orb,
            {
              backgroundColor: colors.glow,
              opacity: orb2.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.15] }),
              transform: [{ scale: orb2.interpolate({ inputRange: [0, 1], outputRange: [1.1, 0.88] }) }],
              width: 400, height: 400, bottom: 20, right: -60,
            },
            webCss({ filter: 'blur(80px)' }),
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.orb,
            {
              backgroundColor: colors.glow,
              opacity: orb3.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.12] }),
              width: 280, height: 280, bottom: 100, left: '28%' as any,
            },
            webCss({ filter: 'blur(70px)' }),
          ]}
        />

        {/* Content */}
        <View style={[styles.heroInner, desktop && styles.heroInnerDesktop]}>
          {/* Mark with breathing glow */}
          <View style={styles.markWrap}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.markGlow,
                {
                  backgroundColor: colors.glow,
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.55] }),
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.45] }) }],
                },
                webCss({ filter: 'blur(30px)' }),
              ]}
            />
            <Image
              source={require('../../assets/images/logo-512.png')}
              contentFit="contain"
              style={[
                styles.logoImage,
                { width: desktop ? 160 : 120, height: desktop ? 160 : 120, borderRadius: desktop ? 40 : 30 },
              ]}
            />
          </View>

          {/* Giant wordmark */}
          <View style={styles.titleRow}>
            <Txt
              variant="displayLg"
              color={colors.ink}
              style={[styles.heroTitle, desktop && styles.heroTitleDesktop]}
            >
              Octo
            </Txt>
            <Txt
              variant="displayLg"
              color={colors.accent}
              style={[styles.heroTitle, desktop && styles.heroTitleDesktop]}
            >
              Chat
            </Txt>
          </View>

          {/* Tagline */}
          <Txt
            variant="title"
            weight="regular"
            color={colors.ink}
            center
            style={[styles.tagline, desktop && styles.taglineDesktop]}
          >
            The ocean knows how to keep a secret.
          </Txt>

          {/* Sub-tagline */}
          <Txt
            variant="subhead"
            tone="inkSoft"
            center
            style={[styles.subTagline, desktop && styles.subTaglineDesktop]}
          >
            End-to-end encrypted team chat.{'\n'}Your keys. Your server. Nobody else.
          </Txt>

          {/* CTAs */}
          <View style={[styles.ctaRow, desktop && styles.ctaRowDesktop]}>
            <Button
              label="Start Chatting"
              variant="primary"
              size="lg"
              shape="pill"
              iconName="send"
              onPress={() => router.replace('/(onboarding)/welcome')}
            />
          </View>

          {/* Trust strip */}
          <View style={styles.trustRow}>
            <Icon name="lock" size={11} color={colors.inkMuted} />
            <Txt variant="caption" color={colors.inkMuted}>
              <Txt
                variant="caption"
                color={colors.inkMuted}
                onPress={() => Linking.openURL('https://github.com/Drakkar-Software/OctoChat')}
              >
                Open source
              </Txt>
              {' · Self-hosted · E2E encrypted'}
            </Txt>
          </View>
        </View>

        {/* Scroll chevron */}
        <View style={styles.scrollHint} pointerEvents="none">
          <Icon name="chevron-down" size={18} color={colors.inkFaint} />
        </View>
      </View>

      {/* ───────────────────────── FEATURES ───────────────────────── */}
      <View style={[styles.featuresSection, { backgroundColor: colors.paper }, desktop && styles.featuresSectionDesktop]}>
        <Txt variant="caption" mono uppercase color={colors.accent} center style={styles.eyebrow}>
          Why OctoChat
        </Txt>
        <Txt
          variant="display"
          weight="bold"
          color={colors.ink}
          center
          style={[styles.sectionTitle, desktop && styles.sectionTitleDesktop]}
        >
          Built for teams that take{'\n'}privacy seriously.
        </Txt>
        <Txt
          variant="subhead"
          tone="inkSoft"
          center
          style={[styles.sectionSub, desktop && styles.sectionSubDesktop]}
        >
          Every message sealed. Every device verified. Every server yours to run.
        </Txt>

        <View style={[styles.grid, desktop && styles.gridDesktop]}>
          {FEATURES.map(({ icon, label, body }) => (
            <View
              key={label}
              style={[
                styles.featureCard,
                {
                  backgroundColor: colors.paperAlt,
                  borderColor: colors.lineFaint,
                  borderTopColor: colors.hairlineHi,
                },
                desktop && styles.featureCardDesktop,
              ]}
            >
              <View
                style={[
                  styles.featureIconWrap,
                  { backgroundColor: colors.accentBg, borderColor: colors.accentBorder },
                ]}
              >
                <Icon name={icon} size={20} color={colors.accent} />
              </View>
              <Txt variant="heading" weight="semibold" color={colors.ink} style={styles.featureLabel}>
                {label}
              </Txt>
              <Txt variant="callout" tone="inkSoft">
                {body}
              </Txt>
            </View>
          ))}
        </View>
      </View>

      {/* ──────────────────────── BOTTOM CTA ──────────────────────── */}
      <View style={[styles.ctaBannerSection, { backgroundColor: colors.canvas }, desktop && styles.ctaBannerSectionDesktop]}>
        <LinearGradient
          colors={[colors.accentBg, 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View
          style={[
            styles.ctaBannerCard,
            {
              backgroundColor: colors.paper,
              borderColor: colors.accentBorder,
              borderTopColor: colors.hairlineHi,
              ...shadows.lg,
            },
            desktop && styles.ctaBannerCardDesktop,
          ]}
        >
          <Image
            source={require('../../assets/images/logo-512.png')}
            contentFit="contain"
            style={[styles.logoImage, { width: 56, height: 56, borderRadius: 14 }]}
          />
          <Txt variant="display" weight="bold" color={colors.ink} center>
            Ready to dive in?
          </Txt>
          <Txt variant="subhead" tone="inkSoft" center>
            Get your team on OctoChat in minutes.
          </Txt>
          <View style={[styles.ctaRow, desktop && styles.ctaRowDesktop]}>
            <Button
              label="Get Started Free"
              variant="primary"
              size="lg"
              shape="pill"
              iconName="arrow-r"
              onPress={() => router.replace('/(onboarding)/welcome')}
            />
          </View>
        </View>
      </View>

      {/* ──────────────────────────── FOOTER ──────────────────────── */}
      <View style={[styles.footer, { backgroundColor: colors.canvas }]}>
        <View style={[styles.footerDivider, { backgroundColor: colors.lineFaint }]} />
        <View style={[styles.footerInner, desktop && styles.footerInnerDesktop]}>
          <View style={styles.footerBrand}>
            <Image
              source={require('../../assets/images/logo-512.png')}
              contentFit="contain"
              style={styles.footerLogo}
            />
            <Txt variant="callout" weight="semibold" color={colors.inkSoft}>
              Octo<Txt variant="callout" weight="semibold" color={colors.accent}>Chat</Txt>
            </Txt>
          </View>
          <View style={styles.footerLinks}>
            <Txt variant="caption" color={colors.inkMuted} onPress={() => router.push('/privacy')}>
              Privacy Policy
            </Txt>
            <Txt variant="caption" color={colors.inkFaint}>·</Txt>
            <Txt variant="caption" color={colors.inkMuted} onPress={() => router.push('/terms')}>
              Terms of Service
            </Txt>
            <Txt variant="caption" color={colors.inkFaint}>·</Txt>
            <Txt
              variant="caption"
              color={colors.inkMuted}
              onPress={() => Linking.openURL('https://github.com/Drakkar-Software/OctoChat')}
            >
              GitHub ↗
            </Txt>
            <Txt variant="caption" color={colors.inkFaint}>·</Txt>
            <Txt variant="caption" color={colors.inkFaint}>
              © {year} Drakkar Software
            </Txt>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  page: {},

  // ── Hero ─────────────────────────────────────────────────────────
  hero: {
    minHeight: 680,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  heroDesktop: { minHeight: 820 },

  heroInner: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
    zIndex: 1,
  },
  heroInnerDesktop: { paddingVertical: 96 },

  markWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    width: 200,
    height: 200,
  },
  markGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.xl,
  },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 64,
    lineHeight: 68,
    letterSpacing: -2,
    includeFontPadding: false,
  },
  heroTitleDesktop: {
    fontSize: 96,
    lineHeight: 100,
    letterSpacing: -3,
  },

  tagline: {
    maxWidth: 440,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  taglineDesktop: { maxWidth: 580 },

  subTagline: {
    maxWidth: 340,
    marginBottom: spacing.xxl,
    textAlign: 'center',
  },
  subTaglineDesktop: { maxWidth: 440 },

  ctaRow: {
    flexDirection: 'column',
    gap: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  ctaRowDesktop: { flexDirection: 'row' },

  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  scrollHint: {
    position: 'absolute',
    bottom: spacing.xl,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },

  orb: {
    position: 'absolute',
    borderRadius: radii.pill,
  },

  logoImage: {},

  // ── Features ─────────────────────────────────────────────────────
  featuresSection: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 64,
    alignItems: 'center',
  },
  featuresSectionDesktop: {
    paddingHorizontal: 80,
    paddingVertical: 96,
  },

  eyebrow: {
    letterSpacing: 2.5,
    marginBottom: spacing.lg,
  },

  sectionTitle: {
    marginBottom: spacing.md,
    maxWidth: 460,
    textAlign: 'center',
  },
  sectionTitleDesktop: { maxWidth: 560 },

  sectionSub: {
    maxWidth: 460,
    marginBottom: 48,
    textAlign: 'center',
  },
  sectionSubDesktop: {
    maxWidth: 560,
    marginBottom: 64,
  },

  grid: {
    width: '100%',
    maxWidth: 1060,
    gap: spacing.lg,
  },
  gridDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  featureCard: {
    padding: spacing.xl,
    borderRadius: radii.card,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  featureCardDesktop: {
    flexBasis: '30%' as any,
    flexGrow: 1,
    marginBottom: 0,
  },

  featureIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
  },

  featureLabel: { marginBottom: spacing.xs },

  // ── Bottom CTA ───────────────────────────────────────────────────
  ctaBannerSection: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 64,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  ctaBannerSectionDesktop: {
    paddingHorizontal: 80,
    paddingVertical: 96,
  },

  ctaBannerCard: {
    width: '100%',
    maxWidth: 580,
    alignItems: 'center',
    borderRadius: radii.xl,
    padding: spacing.xxl,
    borderWidth: 1,
    gap: spacing.lg,
  },
  ctaBannerCardDesktop: {
    maxWidth: 640,
    padding: 48,
  },

  // ── Footer ───────────────────────────────────────────────────────
  footer: { paddingBottom: spacing.xxl },

  footerDivider: {
    height: 1,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },

  footerInner: {
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  footerInnerDesktop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 80,
  },

  footerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerLogo: {
    width: 26,
    height: 26,
    borderRadius: 6,
  },
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
});
