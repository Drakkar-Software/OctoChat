import { useState } from 'react';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { fonts, glowShadow, radii, spacing, type as typeScale } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';

// On web, drop the browser's default focus outline — the field container shows
// a themed accent ring + glow on focus, which is the (more on-brand) indicator.
// `outlineStyle` is a web-only style prop not present in RN's types.
const WEB_OUTLINE_RESET = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as StyleProp<ViewStyle>;

interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  /** Optional leading icon (tints to accent on focus). */
  leadingIcon?: IconName;
  /** Render the value in JetBrains Mono (caps, codes, fingerprints). */
  mono?: boolean;
  /** Height for multiline textareas. */
  minHeight?: number;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * The app's single text input. A theme-aware field that lifts to an accent
 * border + soft glow on focus, with optional leading icon and a multiline /
 * mono mode. Every form input renders through here so focus states and metrics
 * stay consistent (see the Composer for the chat-bar variant).
 */
export function TextField({
  leadingIcon,
  mono = false,
  minHeight,
  multiline = false,
  containerStyle,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.field,
        multiline ? { minHeight: minHeight ?? 72, alignItems: 'flex-start' } : null,
        { backgroundColor: colors.paperAlt, borderColor: focused ? colors.accentBorder : colors.lineSoft },
        focused ? glowShadow(colors.glow, 0.2, 12) : null,
        containerStyle,
      ]}
    >
      {leadingIcon ? (
        <Icon name={leadingIcon} size={16} color={focused ? colors.accent : colors.inkMuted} />
      ) : null}
      <TextInput
        {...rest}
        multiline={multiline}
        placeholderTextColor={colors.inkMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, mono ? styles.mono : styles.sans, { color: colors.ink }, multiline && styles.multiline, WEB_OUTLINE_RESET]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.controlMinHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
    includeFontPadding: false,
  },
  sans: { fontFamily: fonts.body, fontSize: typeScale.body.fontSize },
  mono: { fontFamily: fonts.mono, fontSize: typeScale.caption.fontSize },
  multiline: { textAlignVertical: 'top', paddingTop: spacing.sm },
});
