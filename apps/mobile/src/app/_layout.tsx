import 'react-native-gesture-handler';
// Side-effect imports: register the automation tick HANDLER (conductor-init) and, on
// native, the OS-wake bridge that drives it headlessly (conductor-background → a
// `TaskManager.defineTask`; no-op on web). Both run at module scope on EVERY launch,
// including a cold headless background launch where React never mounts — they must stay
// bare imports, since the register hook never runs on a background relaunch.
import '@/lib/automations/conductor-init';
import '@/lib/automations/conductor-background';

import { configureStarfishPlatform } from '@drakkar.software/octochat-sdk/platform';
import { initOctoChat } from '@/lib/octochat-init';
import { registerServiceWorker } from '@/lib/pwa';
import { ensureNotificationChannel, registerBackgroundPushHandler } from '@/lib/push/fcm';
import { MutesProvider } from '@/lib/mutes-context';
import { AiSettingsProvider } from '@/lib/ai-settings-context';
import { NotificationSettingsProvider } from '@/lib/notification-settings-context';
import { OutboxProvider } from '@/lib/outbox-context';
import { ProfileProvider } from '@/lib/profile-context';
import { QuickReactionsProvider } from '@/lib/quick-reactions-context';
import { RoomsRegistryProvider } from '@/lib/rooms-registry-context';
import { SessionProvider } from '@/lib/session-context';
import { useAutomationBackground } from '@/lib/automations/use-automation-background';
import { SpacesProvider } from '@/lib/spaces-context';
import { ThreadDigestProvider } from '@/lib/thread-digest-context';
import { RequestsProvider } from '@/lib/requests-context';
import { UnreadProvider } from '@/lib/unread-context';
import { ViewModeProvider } from '@/lib/view-mode';
import { BrandProvider } from '@/lib/brand-context';
import { analytics, initAnalytics } from '@/lib/analytics';
import { installDesktopErrorReporting } from '@/lib/desktop';
import { SunglassesProvider, SunglassesGlobalErrorBoundary, useExpoRouterScreenTracking } from '@drakkar.software/sunglasses-react-native';
import { AppErrorFallback } from '@/components/ui/AppErrorFallback';

import { useEffect, useMemo } from 'react';
import { AppState, InteractionManager, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { DKSpacesThemeProvider } from '@drakkar.software/dk-spaces-ui';
import { colors } from '@/theme';
import { toDKSpacesTheme } from '@/lib/dk-spaces-theme';
import { useAppFonts } from '@/lib/use-app-fonts';
import { AppFrame } from '@/components/ui/AppFrame';

// Install platform crypto (no-op on web; quick-crypto install() on native).
configureStarfishPlatform();

// Wire the headless octochat-sdk to this app's config + kv store (before any SDK API).
initOctoChat();

// Register the PWA service worker (web production only; no-op elsewhere).
registerServiceWorker();

// On desktop, wire renderer errors → IPC → terminal before the first render so
// a boot-time crash is captured (console.error is called before any useEffect).
// No-op off-desktop and on headless native launches where window is absent.
installDesktopErrorReporting();

// Register the FCM background-message handler (native only; no-op on web). RN-Firebase
// requires setBackgroundMessageHandler to be registered before a background message is
// processed — but that's only relevant on a headless/background wake, not a foreground
// launch. Gate on AppState so we don't load the Firebase+notifee+expo-notifications+SDK
// decryption graph during foreground boot-eval (inlineRequires cannot defer a module-
// scope call, and this call is the first reference to @/lib/push/fcm).
//   - foreground launch  (active)    → defer past first paint; handler installed before
//                                       the app can ever be backgrounded.
//   - headless/bg wake  (non-active) → register immediately (the requirement).
if (AppState.currentState === 'active') {
  InteractionManager.runAfterInteractions(() => registerBackgroundPushHandler());
} else {
  registerBackgroundPushHandler();
}

// Create the high-importance "Messages" Android channel (no-op on iOS/web). The
// channel must exist before a push RENDERS — not before first paint — and the
// topic-subscribe model guarantees the app runs before any space push arrives.
// Defer off the first frame so expo-notifications doesn't load during boot eval.
InteractionManager.runAfterInteractions(() => {
  void ensureNotificationChannel();
});

// Prevent the splash from auto-hiding before the first frame is painted.
void SplashScreen.preventAutoHideAsync();

/** Mount point for the background-automation task registration. Renders nothing —
 *  must sit under SessionProvider so the hook can read the active session. */
function AutomationBackgroundMount() {
  useAutomationBackground();
  return null;
}

export default function RootLayout() {
  // Initialize analytics once; the lazy client handles calls that arrive before resolve.
  useEffect(() => { initAnalytics().catch(console.error); }, []);
  // Track screen views via expo-router pathname changes → client.screen().
  useExpoRouterScreenTracking(analytics);

  // Start loading fonts in the background — they swap in when ready (FOUT accepted
  // for fastest TTI; previously this gated the entire tree on all 9 weights).
  useAppFonts();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = colors[scheme];
  // Memoize: avoids re-computing the ~40-token theme object and re-rendering the
  // entire DKSpacesThemeProvider subtree on every root render.
  const dkSpacesTheme = useMemo(() => toDKSpacesTheme(palette, scheme), [palette, scheme]);

  // Hide the splash after the first committed frame so there is no blank screen.
  // Fonts will swap in asynchronously once they decode (system fallback shows first).
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  // autoCaptureErrors: keep the global ErrorUtils/window handlers on (globalHandlers
  // default) AND patch the console so `console.error` is captured as a `$error`
  // event. `console.warn` is intentionally left out — RN/React deprecation warnings
  // would flood the analytics silo; pass `console: { levels: ['error', 'warn'] }` to opt in.
  return (
    <SunglassesProvider client={analytics} autoCaptureErrors={{ globalHandlers: true, console: true }}>
    <DKSpacesThemeProvider theme={dkSpacesTheme}>
    <BrandProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Catches render-phase crashes AND fatal non-render errors (uncaught JS
            exceptions, unhandled rejections) — both reported as `$error` events.
            Sits under the theme + safe-area + gesture providers so the fallback
            renders correctly. */}
        <SunglassesGlobalErrorBoundary fallback={<AppErrorFallback />} includeNonFatalGlobalErrors>
        {/* Drives react-native-keyboard-controller's keyboard-tracking on iOS/Android
            (no-op on web). Sits above the screens so any StackScreen with a Composer
            footer can hand off keyboard-avoiding to KAV from the same library, which
            handles Android edge-to-edge (RN 0.85 default) where RN's KAV is flaky. */}
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <SessionProvider>
          {/* Registers the OS background task that ticks due automations while the app
              is backgrounded/closed (native only). Sits directly under the session it
              reads; renders nothing. */}
          <AutomationBackgroundMount />
          {/* OutboxProvider only needs the session: it hydrates the per-identity
              offline send-queue and runs the background flusher that drains it on
              reconnect. Sits high so it keeps draining regardless of the open screen. */}
          <OutboxProvider>
          {/* NotificationSettingsProvider sits above UnreadProvider (which reads the
              master toggle to gate push + web toasts) and below the session it loads
              per-identity settings from. SpacesProvider sits above UnreadProvider too:
              the latter reads the space set from it. RoomsRegistryProvider sits between
              them — it reads the known-spaces snapshot (SpacesProvider) for its
              reconcile fast-path, and the live unread overlay is applied in the
              `useRooms` consumer, below UnreadProvider. ProfileProvider only needs the
              session. */}
          <AiSettingsProvider>
          <NotificationSettingsProvider>
            <QuickReactionsProvider>
            <MutesProvider>
            <SpacesProvider>
              <RoomsRegistryProvider>
                <UnreadProvider>
                  <RequestsProvider>
                  <ProfileProvider>
                    <ThreadDigestProvider>
                      {/* Workspace view mode (Chat/Agents/Work) — a global UI pref
                          read by the desktop sidebar and the mobile rooms screen. */}
                      <ViewModeProvider>
                        <AppFrame>
                          <Stack
                            screenOptions={{
                              headerShown: false,
                              contentStyle: { backgroundColor: palette.canvas },
                            }}
                          />
                        </AppFrame>
                      </ViewModeProvider>
                    </ThreadDigestProvider>
                  </ProfileProvider>
                  </RequestsProvider>
                </UnreadProvider>
              </RoomsRegistryProvider>
            </SpacesProvider>
            </MutesProvider>
            </QuickReactionsProvider>
          </NotificationSettingsProvider>
          </AiSettingsProvider>
          </OutboxProvider>
        </SessionProvider>
        </KeyboardProvider>
        </SunglassesGlobalErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </BrandProvider>
    </DKSpacesThemeProvider>
    </SunglassesProvider>
  );
}
