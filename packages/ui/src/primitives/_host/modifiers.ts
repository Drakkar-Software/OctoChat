// Native (iOS/Android) SwiftUI modifiers we use, re-exported from @expo/ui.
//
// `@expo/ui/swift-ui/modifiers` eagerly runs `requireNativeModule('ExpoUI')` at
// import time (module top-level). That native module has no web binding, so a
// direct import crashes the WEB bundle at load with
// "Cannot find native module 'ExpoUI'". `modifiers.web.ts` provides no-op stubs
// (the @expo/ui universal web fallbacks ignore the `modifiers` prop anyway), and
// Metro resolves it for the web platform. All @octochat/ui code MUST import these
// modifiers from here, never from '@expo/ui/swift-ui/modifiers' directly.
//
// The ExpoUI native module IS present on Android (Jetpack Compose), so this base
// module is safe on both iOS and Android — only web needs the stub.
export { frame, foregroundStyle, labelsHidden } from '@expo/ui/swift-ui/modifiers';
