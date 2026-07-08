import React from 'react';
import BottomSheetNative, { BottomSheetView } from '@expo/ui/community/bottom-sheet';

export interface OctoSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Snap points, bottom→top. Defaults to a single tall detent. */
  snapPoints?: (string | number)[];
  /** Sheet surface background (pass the paper token). */
  backgroundColor?: string;
  children: React.ReactNode;
}

/**
 * Controlled native bottom sheet — SwiftUI `.sheet` on iOS, Material 3
 * `ModalBottomSheet` on Android, via the `@expo/ui` community drop-in. Mounts
 * open (conditional on `visible`); pan-down / backdrop dismiss calls `onClose`.
 *
 * `enableDynamicSizing={false}` is REQUIRED: with dynamic sizing on, iOS
 * re-measures and re-parents the RNHostView after presentation, desyncing its
 * touch handler so inner `onPress` handlers silently never fire.
 */
export function Sheet({ visible, onClose, snapPoints = ['90%'], backgroundColor, children }: OctoSheetProps) {
  if (!visible) return null;
  return (
    <BottomSheetNative
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      onClose={onClose}
    >
      <BottomSheetView style={backgroundColor ? { backgroundColor } : undefined}>
        {children}
      </BottomSheetView>
    </BottomSheetNative>
  );
}

Sheet.displayName = 'OctoSheet';
