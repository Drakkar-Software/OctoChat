import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useDmLink } from '@/lib/use-dm-link';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { LinkQrCode } from '@/components/ui/LinkQrCode';
import { Txt } from '@/components/ui/Txt';

/**
 * The "DM me" link on the own-profile screen: copy/share/QR the account's
 * permanent link. The link is just the identity made portable (see the SDK's
 * `dm-link.ts`) — same on every device, nothing to generate, reset or expire —
 * so this card is pure display over {@link useDmLink}.
 */
export function DmLinkCard() {
  const { loading, link } = useDmLink();
  const [showQr, setShowQr] = useState(false);

  return (
    <Card title="DM LINK">
      <Txt variant="footnote" tone="inkSoft">
        Anyone who opens your link can start an end-to-end encrypted DM with you — even with no space in common.
      </Txt>
      {loading ? (
        <Txt variant="footnote" tone="inkMuted">
          Loading…
        </Txt>
      ) : link ? (
        <View style={styles.linkBox}>
          <CopyField label="Your DM link" value={link} copyLabel="Copy link" share shareTitle="DM me on OctoChat" lines={3} />
          <View style={styles.actionRow}>
            <Button
              label={showQr ? 'Hide QR' : 'Show QR'}
              variant="secondary"
              size="sm"
              iconName="qr-scan"
              onPress={() => setShowQr((s) => !s)}
            />
          </View>
          {showQr ? <LinkQrCode value={link} /> : null}
          <Txt variant="footnote" tone="inkMuted">
            The link is tied to your identity and never changes.
          </Txt>
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
  linkBox: { gap: spacing.sm },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
