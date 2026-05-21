import { Platform, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useCopy } from '@/lib/clipboard';
import { useTheme } from '@/lib/use-theme';

import { Button } from './Button';
import { Txt } from './Txt';

interface CopyFieldProps {
  /** The value shown in the block and copied to the clipboard. */
  value: string;
  /** Optional uppercase label above the token block. */
  label?: string;
  /** Idle copy-button text (defaults to "Copy"). */
  copyLabel?: string;
  /** Max lines before the token clamps (keeps long tokens from growing tall). */
  lines?: number;
}

/**
 * A contained, monospace block for a long copyable token — a join request,
 * invite cap or fingerprint. The bordered, lit-edged surface reads as a "code
 * to copy" rather than stray text, the value is selectable, and the copy button
 * confirms with a check. Web copies to the clipboard; native users select it.
 */
export function CopyField({ value, label, copyLabel = 'Copy', lines = 4 }: CopyFieldProps) {
  const { colors } = useTheme();
  const { copied, copy } = useCopy();

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
      {Platform.OS === 'web' ? (
        <Button
          label={copied ? 'Copied' : copyLabel}
          variant="secondary"
          size="sm"
          iconName={copied ? 'check' : 'copy'}
          onPress={() => copy(value)}
        />
      ) : null}
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
});
