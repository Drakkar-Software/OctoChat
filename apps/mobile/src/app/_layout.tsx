import 'react-native-gesture-handler';

import { configureStarfishPlatform } from '@/lib/starfish/platform';
import { registerServiceWorker } from '@/lib/pwa';
import { ensureNotificationChannel, registerBackgroundPushHandler } from '@/lib/push/fcm';
import { NotificationSettingsProvider } from '@/lib/notification-settings-context';
import { ProfileProvider } from '@/lib/profile-context';
import { RoomsRegistryProvider } from '@/lib/rooms-registry-context';
import { SessionProvider } from '@/lib/session-context';
import { SpacesProvider } from '@/lib/spaces-context';
import { ThreadDigestProvider } from '@/lib/thread-digest-context';
import { UnreadProvider } from '@/lib/unread-context';

import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
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

// Create the high-importance "Messages" Android channel (no-op on iOS/web). Must
// run on every cold start before any background push renders — `defaultChannel`
// routes channel-less pushes here, so the channel has to exist first.
void ensureNotificationChannel();

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
        {/* Drives react-native-keyboard-controller's keyboard-tracking on iOS/Android
            (no-op on web). Sits above the screens so any StackScreen with a Composer
            footer can hand off keyboard-avoiding to KAV from the same library, which
            handles Android edge-to-edge (RN 0.85 default) where RN's KAV is flaky. */}
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <SessionProvider>
          {/* NotificationSettingsProvider sits above UnreadProvider (which reads the
              master toggle to gate push + web toasts) and below the session it loads
              per-identity settings from. SpacesProvider sits above UnreadProvider too:
              the latter reads the space set from it. RoomsRegistryProvider sits between
              them — it reads the known-spaces snapshot (SpacesProvider) for its
              reconcile fast-path, and the live unread overlay is applied in the
              `useRooms` consumer, below UnreadProvider. ProfileProvider only needs the
              session. */}
          <NotificationSettingsProvider>
            <SpacesProvider>
              <RoomsRegistryProvider>
                <UnreadProvider>
                  <ProfileProvider>
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
                  </ProfileProvider>
                </UnreadProvider>
              </RoomsRegistryProvider>
            </SpacesProvider>
          </NotificationSettingsProvider>
        </SessionProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
