import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Thin cross-platform haptics wrapper. No-ops on web (where the native module
 * is absent) and never throws, so call sites can fire-and-forget.
 */
const enabled = Platform.OS !== 'web';

export function tapFeedback(): void {
  if (enabled) void Haptics.selectionAsync().catch(() => {});
}

export function impactFeedback(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
): void {
  if (enabled) void Haptics.impactAsync(style).catch(() => {});
}

export function successFeedback(): void {
  if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
