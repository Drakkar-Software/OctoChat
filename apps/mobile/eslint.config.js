// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // `react-hooks/immutability` (react-hooks v6 / React Compiler) reports
      // reanimated's `sharedValue.value = withTiming(...)` setter as mutating an
      // immutable value. That's reanimated's documented imperative API, used in
      // every animated press handler in this app, so the rule only ever
      // false-positives here — disable it rather than scatter inline disables.
      "react-hooks/immutability": "off",
    },
  },
]);
