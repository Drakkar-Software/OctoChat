import type { StyleProp, ViewStyle } from 'react-native';

import { useCopy } from '@/lib/clipboard';

import { Button, type ButtonSize, type ButtonVariant } from './Button';

interface CopyButtonProps {
  /** The text written to the clipboard when pressed. */
  value: string;
  /** Idle label (defaults to "Copy"); the button swaps to "Copied" on success. */
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
}

/**
 * A copy-to-clipboard {@link Button} that confirms with a transient "Copied"
 * label + check icon (via {@link useCopy} — native `expo-clipboard`, web
 * Clipboard API). Reusable wherever a value should be one-tap copyable, e.g. the
 * corner of a fenced code block.
 */
export function CopyButton({ value, label = 'Copy', variant = 'ghost', size = 'sm', style }: CopyButtonProps) {
  const { copied, copy } = useCopy();
  return (
    <Button
      label={copied ? 'Copied' : label}
      variant={variant}
      size={size}
      iconName={copied ? 'check' : 'copy'}
      style={style}
      onPress={() => copy(value)}
    />
  );
}
