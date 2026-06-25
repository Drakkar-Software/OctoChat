import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { motion, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

// Rise distance in logical pixels for native spring.
const RISE_BOTTOM = 300;
const RISE_CENTER = 40;

export interface OverlayProps {
  visible: boolean;
  onClose: () => void;
  placement: 'bottom' | 'center' | 'anchor';
  /** Absolute-position style for placement="anchor" — positions the content. */
  anchorStyle?: ViewStyle;
  /** Accessibility label for the dismiss action. */
  dismissLabel?: string;
  children: ReactNode;
}

// ── Web implementation ────────────────────────────────────────────────────────

function WebOverlay({ visible, onClose, placement, anchorStyle, dismissLabel = 'Dismiss', children }: OverlayProps) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();

  // Flip `mounted` one frame after `visible` becomes true so CSS transitions fire.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (visible) {
      const id = setTimeout(() => setMounted(true), 0);
      return () => clearTimeout(id);
    } else {
      setMounted(false);
    }
  }, [visible]);

  // Web Escape key handler.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const RISE_PX = placement === 'bottom' ? RISE_BOTTOM : placement === 'center' ? RISE_CENTER : 0;
  const duration = reducedMotion ? 0 : motion.base;

  // Scrim transition style (web only).
  const scrimTransition = {
    opacity: mounted ? 1 : 0,
    transitionProperty: 'opacity',
    transitionDuration: `${duration}ms`,
    transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
  } as unknown as ViewStyle;

  // Content transition style (web only).
  const contentTransition = {
    opacity: placement === 'anchor' || mounted ? 1 : 0,
    transform: [{ translateY: mounted ? 0 : RISE_PX }],
    transitionProperty: 'opacity, transform',
    transitionDuration: `${duration}ms`,
    transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
  } as unknown as ViewStyle;

  const containerStyle: ViewStyle =
    placement === 'bottom'
      ? styles.containerBottom
      : placement === 'center'
        ? styles.containerCenter
        : styles.containerAnchor;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Scrim — full-screen dismiss backdrop */}
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimTransition]}
        onPress={onClose}
        accessibilityLabel={dismissLabel}
      />
      {/* Content container */}
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, containerStyle]}>
        <View style={[contentTransition, placement === 'anchor' ? anchorStyle : undefined]}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

// ── Native implementation ─────────────────────────────────────────────────────

function NativeOverlay({ visible, onClose, placement, anchorStyle, dismissLabel = 'Dismiss', children }: OverlayProps) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();

  const RISE = placement === 'bottom' ? RISE_BOTTOM : placement === 'center' ? RISE_CENTER : 0;

  const offset = useSharedValue(visible ? 0 : RISE);
  const scrimOpacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      scrimOpacity.set(withTiming(1, { duration: motion.fast }));
      offset.set(reducedMotion ? 0 : withSpring(0, motion.spring));
    } else {
      scrimOpacity.set(withTiming(0, { duration: motion.fast }));
      offset.set(reducedMotion ? RISE : withSpring(RISE, motion.spring));
    }
  }, [visible, reducedMotion, offset, scrimOpacity, RISE]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.get() }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: placement === 'anchor' ? [] : [{ translateY: offset.get() }],
    opacity: placement === 'anchor' ? scrimOpacity.get() : 1,
  }));

  const containerStyle: ViewStyle =
    placement === 'bottom'
      ? styles.containerBottom
      : placement === 'center'
        ? styles.containerCenter
        : styles.containerAnchor;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Animated scrim backdrop */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}
        pointerEvents="none"
      />
      {/* Dismiss pressable underneath content */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel={dismissLabel}
      />
      {/* Content container */}
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, containerStyle]}>
        <Animated.View
          style={[contentStyle, placement === 'anchor' ? anchorStyle : undefined]}
          pointerEvents="box-none"
        >
          {/* Swallow taps so they don't fall through to the dismiss pressable */}
          <Pressable onPress={() => undefined}>
            {children}
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

export const Overlay = Platform.OS === 'web' ? WebOverlay : NativeOverlay;

// ── Bottom-placement corner radii helper ─────────────────────────────────────

/** Apply to the direct child of an Overlay placement="bottom" to get sheet corners. */
export const sheetCorners: ViewStyle = {
  borderTopLeftRadius: radii.sheet,
  borderTopRightRadius: radii.sheet,
};

/** Apply to the direct child of an Overlay placement="center" to get card corners. */
export const centerCorners: ViewStyle = {
  borderRadius: radii.xl,
  marginHorizontal: spacing.xl,
};

const styles = StyleSheet.create({
  containerBottom: {
    justifyContent: 'flex-end',
  },
  containerCenter: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  containerAnchor: {
    // Anchor content is positioned via anchorStyle (absolute).
  },
});
