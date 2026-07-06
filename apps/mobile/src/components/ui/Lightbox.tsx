import type { ReactNode } from 'react';

import { Lightbox as LightboxOverlay } from '@drakkar.software/dk-spaces-ui';

import { useTheme } from '@/lib/use-theme';
import { IconButton } from './IconButton';

interface LightboxProps {
  visible: boolean;
  onClose: () => void;
  /** Centered content (e.g. a full-size image). */
  children: ReactNode;
  /** Close button label for screen readers. */
  closeLabel?: string;
  /** Optional save/share action rendered as a button in the bottom-right corner. */
  onDownload?: () => void;
  /** Accessible label for the download button. */
  downloadLabel?: string;
}

/** Full-screen scrim overlay that centers its content. Tapping the backdrop, the
 *  close button, the Escape key (web) or the hardware back (Android) dismisses it.
 *  Delegates to the shared `Lightbox` from @drakkar.software/dk-spaces-ui. */
export function Lightbox({
  visible,
  onClose,
  children,
  closeLabel = 'Close preview',
  onDownload,
  downloadLabel = 'Save / Share',
}: LightboxProps) {
  const { colors } = useTheme();

  return (
    <LightboxOverlay
      visible={visible}
      onClose={onClose}
      closeLabel={closeLabel}
      renderCloseButton={(close) => (
        <IconButton
          name="x"
          size={26}
          color={colors.onScrim}
          onPress={close}
          accessibilityLabel={closeLabel}
        />
      )}
      renderActions={
        onDownload
          ? () => (
              <IconButton
                name="share"
                size={26}
                color={colors.onScrim}
                onPress={onDownload}
                accessibilityLabel={downloadLabel}
              />
            )
          : undefined
      }
    >
      {children}
    </LightboxOverlay>
  );
}
