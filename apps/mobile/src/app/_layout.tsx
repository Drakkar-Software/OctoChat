import 'react-native-gesture-handler';

import { configureStarfishPlatform } from '@/lib/starfish/platform';
import { registerServiceWorker } from '@/lib/pwa';
import { registerBackgroundPushHandler } from '@/lib/push/fcm';
import { SessionProvider } from '@/lib/session-context';
import { ThreadDigestProvider } from '@/lib/thread-digest-context';
import { UnreadProvider } from '@/lib/unread-context';

import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme';
import { useAppFonts } from '@/lib/use-app-fonts';
import { AppFrame } from '@/components/ui/AppFrame';

// Install platform crypto (no-op on web; quick-crypto install() on native).
configureStarfishPlatform();

// Register the PWA service worker (web production only; no-op elsewhere).
registerServiceWorker();

// Register the FCM background-message handler (native only; no-op on web). Must
// run at module scope so it's installed before the first push arrives.
registerBackgroundPushHandler();

// Keep the native splash up until our fonts are ready (must run at module top).
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = colors[scheme];

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Block first paint until fonts resolve so we never flash a fallback face.
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <SessionProvider>
          <UnreadProvider>
            <ThreadDigestProvider>
              <AppFrame>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: palette.canvas },
                  }}
                />
              </AppFrame>
            </ThreadDigestProvider>
          </UnreadProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
