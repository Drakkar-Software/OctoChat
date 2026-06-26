const { VARIANTS } = require('./src/lib/variants-config');

/** @type {import('@expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const variantId = process.env.EXPO_PUBLIC_VARIANT ?? 'octochat';
  const variant = VARIANTS[variantId] ?? VARIANTS['octochat'];

  return {
    ...config,
    name: variant.name,
    slug: variant.slug,
    scheme: variant.scheme,
    android: {
      ...config.android,
      package: variant.bundleId,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            { scheme: 'https', host: variant.linkHost, pathPrefix: '/join' },
            { scheme: 'https', host: variant.linkHost, pathPrefix: '/dm' },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    ios: {
      ...config.ios,
      bundleIdentifier: variant.bundleId,
      associatedDomains: [`applinks:${variant.linkHost}`],
    },
    extra: {
      ...config.extra,
      eas: { projectId: variant.easProjectId },
    },
    updates: {
      url: `https://u.expo.dev/${variant.easProjectId}`,
    },
    plugins: [
      ...(config.plugins ?? []),
      // 'posthog-react-native/expo',
      // Disabled: this plugin injects a Gradle task (posthog-cli) + an Xcode build phase
      // to upload JS source maps and dSYMs to PostHog cloud for crash symbolication.
      // Since suppressPostHogSend: true routes all events to SunGlasses/Starfish (nothing
      // ever reaches PostHog), the upload step is pointless and breaks the build when
      // posthog-cli is absent. Re-enable only if you drop suppressPostHogSend and start
      // sending events directly to a PostHog project.
    ],
  };
};
