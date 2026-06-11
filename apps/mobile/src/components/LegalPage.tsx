import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import type { LegalDoc } from '@/lib/legal';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

interface LegalPageProps {
  doc: LegalDoc;
}

export function LegalPage({ doc }: LegalPageProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.canvas }]}
      contentContainerStyle={{ paddingBottom: spacing.xxxl + insets.bottom }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Nav bar ── */}
      <View
        style={[
          styles.nav,
          { paddingTop: insets.top + 8, borderBottomColor: colors.lineFaint, backgroundColor: colors.canvas },
        ]}
      >
        <View style={styles.navBrand}>
          <Image
            source={require('../../assets/images/logo-512.png')}
            style={styles.navLogo}
          />
          <Txt variant="callout" weight="semibold" color={colors.inkSoft}>
            Octo<Txt variant="callout" weight="semibold" color={colors.accent}>Chat</Txt>
          </Txt>
        </View>
        <IconButton name="arrow-l" size={20} color={colors.inkSoft} onPress={handleBack} accessibilityLabel="Back" />
      </View>

      {/* ── Hero ── */}
      <View style={styles.heroWrap}>
        <LinearGradient
          colors={[colors.accentBg, 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.heroInner, { borderBottomColor: colors.accentBorder }]}>
          <Txt variant="caption" mono uppercase color={colors.accent} style={styles.eyebrow}>
            Drakkar Software
          </Txt>
          <Txt variant="display" weight="bold" color={colors.ink} style={styles.heroTitle}>
            {doc.title}
          </Txt>
          <Txt variant="subhead" tone="inkSoft" style={styles.heroSub}>
            {doc.subtitle}
          </Txt>
          <Txt variant="caption" color={colors.inkMuted} style={styles.updated}>
            Last updated: {doc.updated}
          </Txt>
        </View>
      </View>

      {/* ── Sections ── */}
      <View style={styles.content}>
        {doc.sections.map((section, i) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Txt variant="footnote" mono color={colors.accent} style={styles.sectionNum}>
                {String(i + 1).padStart(2, '0')}
              </Txt>
              <View style={[styles.sectionRule, { backgroundColor: colors.accentBorder }]} />
            </View>
            <Txt variant="heading" weight="semibold" color={colors.ink} style={styles.sectionTitle}>
              {section.title}
            </Txt>
            {section.paragraphs.map((para, j) => (
              <Txt key={j} variant="body" tone="inkSoft" style={styles.para}>
                {para}
              </Txt>
            ))}
          </View>
        ))}

        {/* Back link */}
        <View style={[styles.backRow, { borderTopColor: colors.lineFaint }]}>
          <Txt variant="callout" color={colors.accent} onPress={handleBack}>
            ← Back to OctoChat
          </Txt>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },

  // Nav bar
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  navBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  navLogo: {
    width: 26,
    height: 26,
    borderRadius: 6,
    resizeMode: 'contain',
  },

  // Hero
  heroWrap: { position: 'relative', overflow: 'hidden' },
  heroInner: {
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.xl,
    paddingTop: 56,
    paddingBottom: 48,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  eyebrow: { letterSpacing: 2 },
  heroTitle: { marginTop: spacing.xs },
  heroSub: { maxWidth: 540 },
  updated: { marginTop: spacing.xs },

  // Content
  content: {
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },

  section: { marginBottom: spacing.xxl },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionNum: { letterSpacing: 1 },
  sectionRule: {
    flex: 1,
    height: 1,
    borderRadius: radii.sm,
  },

  sectionTitle: { marginBottom: spacing.md },

  para: {
    lineHeight: 26,
    marginBottom: spacing.md,
  },

  backRow: {
    paddingTop: spacing.xl,
    borderTopWidth: 1,
    marginTop: spacing.xl,
  },
});
