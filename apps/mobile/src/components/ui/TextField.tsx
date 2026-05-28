import { useState } from 'react';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { fonts, glowShadow, radii, spacing, type as typeScale } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';

// On web, drop the browser's default focus outline — the field container shows
// a themed accent ring + glow on focus, which is the (more on-brand) indicator.
// `outlineStyle` is a web-only style prop not present in RN's types.
const WEB_OUTLINE_RESET = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as unknown as StyleProp<TextStyle>;

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

  // The focus glow lives on an absolutely-positioned sibling, not on the
  // TextInput's parent View. On Android, adding `elevation` to a TextInput's
  // ancestor during the focus commit creates a new native render layer in the
  // same frame as focus and eats the focus event — keyboard flashes open then
  // dismisses immediately. Keeping the parent's layout stable (only swapping
  // borderColor, which is paint-only) avoids that.
  return (
    <View
      style={[
        styles.wrapper,
        multiline ? { minHeight: minHeight ?? 72 } : null,
        containerStyle,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.glowLayer,
          { backgroundColor: colors.paperAlt },
          focused ? glowShadow(colors.glow, 0.2, 12) : null,
        ]}
      />
      <View
        style={[
          styles.field,
          multiline ? { alignItems: 'flex-start' } : null,
          { borderColor: focused ? colors.accentBorder : colors.lineSoft },
        ]}
      >
        {leadingIcon ? (
          <Icon name={leadingIcon} size={16} color={focused ? colors.accent : colors.inkMuted} />
        ) : null}
        <TextInput
          {...rest}
          multiline={multiline}
          placeholderTextColor={colors.inkMuted}
          // Android's TextInput otherwise inherits the OS `textColorPrimary`
          // for the cursor/selection — invisible against the dark paperAlt in
          // dark mode and off-brand in light mode.
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          underlineColorAndroid="transparent"
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          // Keep `color` LAST in the array: on Android, any earlier `color`
          // (e.g. from `styles.input` / `styles.sans`) wins under the native
          // style flattener, which made typed text render as the OS default
          // and disappear against the paperAlt fill in dark mode.
          style={[styles.input, mono ? styles.mono : styles.sans, multiline && styles.multiline, WEB_OUTLINE_RESET, { color: colors.ink }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    minHeight: spacing.controlMinHeight,
  },
  glowLayer: {
    borderRadius: radii.md,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: spacing.controlMinHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: 'transparent',
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
