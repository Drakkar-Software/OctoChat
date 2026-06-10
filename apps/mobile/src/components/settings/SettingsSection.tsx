import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { labelTracking, spacing } from '@/theme';

import { Txt } from '@/components/ui/Txt';

interface SettingsSectionProps {
  /** Uppercase mono cluster label (e.g. "IDENTITY"). */
  title: string;
  children: ReactNode;
}

/**
 * A labelled cluster of settings cards. Renders a quiet `mono`/`uppercase`
 * section heading above its grouped children so the long settings stack reads as
 * a few intentional zones (identity / preferences / device) instead of one flat
 * column of equal-weight cards. Keeps the route page thin — it only groups; the
 * cards inside still own their own framing.
 */
export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <View style={styles.section}>
      <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted" style={styles.heading}>
        {title}
      </Txt>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  heading: { letterSpacing: labelTracking, paddingHorizontal: spacing.xs },
  group: { gap: spacing.md },
});
