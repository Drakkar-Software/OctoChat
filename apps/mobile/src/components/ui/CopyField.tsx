import { Platform, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useCopy } from '@/lib/clipboard';
import { canShare, shareText } from '@/lib/share';
import { useTheme } from '@/lib/use-theme';

import { Button } from './Button';
import { Txt } from './Txt';

interface CopyFieldProps {
  /** The value shown in the block and copied to the clipboard. */
  value: string;
  /** Optional uppercase label above the token block. */
  label?: string;
  /** Idle copy-button text on web (defaults to "Copy"). Native always shows the
   *  compact "Copy" so it sits beside an optional Share button. */
  copyLabel?: string;
  /** Show a Share button beside Copy, opening the OS share sheet (where available). */
  share?: boolean;
  /** Title hint passed to the web share sheet. */
  shareTitle?: string;
  /** Max lines before the token clamps (keeps long tokens from growing tall). */
  lines?: number;
}

/**
 * A contained, monospace block for a long copyable token — a join request,
 * invite cap or fingerprint. The bordered, lit-edged surface reads as a "code
 * to copy" rather than stray text, the value is selectable, and a copy button
 * (native via `expo-clipboard`, web via the Clipboard API) confirms with a
 * check. Pass `share` to add a Share button beside Copy for handing the value
 * off through the OS share sheet.
 */
export function CopyField({ value, label, copyLabel = 'Copy', share = false, shareTitle, lines = 4 }: CopyFieldProps) {
  const { colors } = useTheme();
  const { copied, copy } = useCopy();
  // Native keeps the label compact ("Copy") so it pairs with Share; web can
  // afford the descriptive label.
  const idleLabel = Platform.OS === 'web' ? copyLabel : 'Copy';
  const showShare = share && canShare();

  return (
    <View style={styles.wrap}>
      {label ? (
        <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
          {label}
        </Txt>
      ) : null}
      <View
        style={[
          styles.block,
          { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft, borderTopColor: colors.hairlineHi },
        ]}
      >
        <Txt variant="caption" mono tone="inkSoft" numberOfLines={lines} selectable>
          {value}
        </Txt>
      </View>
      <View style={styles.actions}>
        <Button
          label={copied ? 'Copied' : idleLabel}
          variant="secondary"
          size="sm"
          iconName={copied ? 'check' : 'copy'}
          style={showShare ? styles.action : undefined}
          onPress={() => copy(value)}
        />
        {showShare ? (
          <Button
            label="Share"
            variant="secondary"
            size="sm"
            iconName="share"
            style={styles.action}
            onPress={() => void shareText(value, shareTitle)}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  block: {
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
