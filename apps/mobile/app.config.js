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
  };
};
