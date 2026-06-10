import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { Callout } from '@/components/ui/Callout';
import { QrCode } from '@/components/onboarding/QrCode';

interface LinkQrCodeProps {
  /** The link/credential to encode. */
  value: string;
  /** When set, values longer than this render a copy/paste fallback instead of an
   *  unreadable QR (react-native-qrcode-svg at ecl="L" tops out ~2953 bytes — a
   *  dense private-invite cap can sit on that edge). Omit for links that never
   *  approach the limit (the public-space / DM-link fragments). */
  maxBytes?: number;
}

/**
 * A scannable QR for a shareable link or invite — the one place the
 * "render big, drop the center mark, ecl='L'" recipe lives (used by the DM-link
 * card and both space-invite blocks). These payloads pack a cap / identity keys
 * into a URL fragment; at the pairing QR's defaults (small, ecl="M", center mark)
 * the modules go sub-2px and the logo blots the dense center, so no scanner reads
 * them. Bigger render + no mark + ecl="L" keeps the picked QR version low (bigger
 * modules) and scannable.
 */
export function LinkQrCode({ value, maxBytes }: LinkQrCodeProps) {
  if (maxBytes != null && value.length > maxBytes) {
    return (
      <Callout tone="warning" iconName="alert" title="Too large for a QR">
        Copy and paste it instead — scanners can’t read codes this dense.
      </Callout>
    );
  }
  return (
    <View style={styles.qr}>
      <QrCode value={value} size={280} ecl="L" hideMark />
    </View>
  );
}

const styles = StyleSheet.create({
  qr: { alignItems: 'center', paddingVertical: spacing.sm },
});
