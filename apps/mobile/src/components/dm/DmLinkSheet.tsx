import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { glowShadow, radii, shadows, spacing } from '@/theme';
import { useCopy } from '@/lib/clipboard';
import { useProfile } from '@/lib/profile-context';
import { canShare, shareText } from '@/lib/share';
import { useDmLink } from '@/lib/use-dm-link';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { LinkQrCode } from '@/components/ui/LinkQrCode';
import { Txt } from '@/components/ui/Txt';

interface DmLinkSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The DM-link "calling card" — the one dedicated screen for sharing your own
 * permanent "DM me" link. The QR *is* the artifact (someone scans it from their
 * DMs tab to open an E2EE DM with you, no space in common); copy/share hand off
 * the same link without ever surfacing the raw URL. Presented as a full-screen
 * sheet (RN `Modal`, like {@link MoveToCategorySheet}) so it's reachable from
 * anywhere — the DMs header share action AND the profile's About card — instead
 * of being inlined per screen. Pure display over {@link useDmLink} + the live
 * {@link useProfile} identity.
 */
export function DmLinkSheet({ visible, onClose }: DmLinkSheetProps) {
  const { colors } = useTheme();
  const { profile } = useProfile();
  const { loading, link } = useDmLink();
  const { copied, copy } = useCopy();
  const showShare = canShare();

  const name = profile?.name ?? 'You';
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={onClose} accessibilityLabel="Dismiss">
        {/* Inner press swallows taps so they don't fall through to the backdrop. */}
        <Pressable style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.accentBorder }, shadows.lg]} onPress={() => undefined}>
          {/* A faint depth band gives the card subaquatic atmosphere behind the identity. */}
          <LinearGradient colors={[colors.depthTop, colors.paper]} style={[StyleSheet.absoluteFill, styles.fill]} />

          <View style={styles.head}>
            <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
              DM me
            </Txt>
            <IconButton name="x" accessibilityLabel="Close" onPress={onClose} />
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.identity}>
              <Avatar label={initials} image={profile?.avatar} size={52} ring />
              <Txt variant="heading" weight="bold" center numberOfLines={1}>
                {name}
              </Txt>
              {profile?.handle ? (
                <Txt variant="caption" mono tone="inkMuted" center numberOfLines={1}>
                  {profile.handle}
                </Txt>
              ) : null}
            </View>

            {loading ? (
              <Txt variant="footnote" tone="inkMuted" center>
                Preparing your link…
              </Txt>
            ) : link ? (
              <>
                <View style={[styles.well, { backgroundColor: colors.accentBg }, glowShadow(colors.glow, 0.3, 18)]}>
                  <LinkQrCode value={link} size={216} />
                </View>
                <Txt variant="footnote" tone="inkSoft" center style={styles.caption}>
                  Anyone who scans this starts an end-to-end encrypted DM with you — even with no space in common.
                </Txt>
                <View style={styles.actions}>
                  <Button
                    label={copied ? 'Link copied' : 'Copy link'}
                    iconName={copied ? 'check' : 'copy'}
                    variant={showShare ? 'secondary' : 'primary'}
                    size="md"
                    style={styles.action}
                    onPress={() => copy(link)}
                  />
                  {showShare ? (
                    <Button
                      label="Share"
                      iconName="share"
                      variant="primary"
                      size="md"
                      style={styles.action}
                      onPress={() => void shareText(link, 'DM me on OctoChat')}
                    />
                  ) : null}
                </View>
              </>
            ) : (
              <Txt variant="footnote" tone="inkMuted" center style={styles.caption}>
                Your link will be available once this identity has synced its keys.
              </Txt>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '90%',
    borderRadius: radii.sheet,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    overflow: 'hidden',
  },
  // The gradient only dresses the top third — clip it short of the actions.
  fill: { bottom: '55%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  body: { alignItems: 'center', gap: spacing.lg },
  identity: { alignItems: 'center', gap: spacing.xs },
  well: { padding: spacing.sm, borderRadius: radii.xl },
  caption: { maxWidth: 280 },
  actions: { flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch' },
  action: { flex: 1 },
});
