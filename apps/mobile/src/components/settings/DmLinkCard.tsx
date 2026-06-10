import { StyleSheet, View } from 'react-native';

import { glowShadow, radii, spacing } from '@/theme';
import { useCopy } from '@/lib/clipboard';
import { canShare, shareText } from '@/lib/share';
import { useDmLink } from '@/lib/use-dm-link';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LinkQrCode } from '@/components/ui/LinkQrCode';
import { Txt } from '@/components/ui/Txt';

/**
 * The "DM me" calling card on the own-profile screen. The link is the IDENTITY
 * made portable (SDK `dm-link.ts`) — permanent, the same on every device,
 * nothing to generate or revoke — so this is pure display over {@link useDmLink}.
 *
 * The raw URL is never shown: the QR *is* the shareable artifact (someone scans
 * it from the DMs tab to open an encrypted DM with you), and the two icon
 * actions hand the link off — copy, or the OS share sheet — without surfacing it.
 */
export function DmLinkCard() {
  const { colors } = useTheme();
  const { loading, link } = useDmLink();
  const { copied, copy } = useCopy();
  const showShare = canShare();

  return (
    <Card title="DM ME" tone="accent" elevation="md">
      {loading ? (
        <Txt variant="footnote" tone="inkMuted">
          Loading…
        </Txt>
      ) : link ? (
        <View style={styles.body}>
          <View style={[styles.halo, { backgroundColor: colors.accentBg }, glowShadow(colors.glow, 0.3, 16)]}>
            <LinkQrCode value={link} size={168} />
          </View>
          <Txt variant="footnote" tone="inkSoft" center style={styles.caption}>
            Scan or share to start an end-to-end encrypted DM — even with no space in common.
          </Txt>
          <View style={styles.actions}>
            <Button
              label={copied ? 'Link copied' : 'Copy link'}
              iconName={copied ? 'check' : 'copy'}
              iconOnly
              shape="pill"
              size="md"
              variant={showShare ? 'secondary' : 'primary'}
              onPress={() => copy(link)}
            />
            {showShare ? (
              <Button
                label="Share link"
                iconName="share"
                iconOnly
                shape="pill"
                size="md"
                variant="primary"
                onPress={() => void shareText(link, 'DM me on OctoChat')}
              />
            ) : null}
          </View>
        </View>
      ) : (
        <Txt variant="footnote" tone="inkMuted">
          Your link will be available once this identity has synced its keys.
        </Txt>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: spacing.md },
  // Glowing accent well that frames the QR as a bioluminescent calling card.
  halo: { padding: spacing.sm, borderRadius: radii.xl },
  caption: { maxWidth: 260 },
  actions: { flexDirection: 'row', gap: spacing.md },
});
