import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * Android hardware-back handler, scoped to screen focus. The callback returns
 * `true` to consume the event or `false` to let RN pop normally.
 *
 * Web is skipped entirely: react-native-web's `BackHandler` is a no-op stub that
 * logs "BackHandler is not supported on web and should not be used" the moment
 * `addEventListener` is touched, so we never reach for it there. iOS has no
 * hardware back, so the listener simply never fires.
 */
export function useHardwareBack(onBack: () => boolean) {
  // Keep the latest callback in a ref so the effect can subscribe once on focus
  // without re-running when an inline closure changes identity each render.
  const ref = useRef(onBack);
  ref.current = onBack;
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => ref.current());
      return () => sub.remove();
    }, []),
  );
}
