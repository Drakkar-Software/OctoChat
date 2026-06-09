const { withAndroidManifest } = require('@expo/config-plugins');

const FCM_CHANNEL_META = 'com.google.firebase.messaging.default_notification_channel_id';

// expo-notifications injects the default_notification_channel_id meta-data but
// react-native-firebase_messaging also declares it (value="messages"), causing
// a manifest merger conflict. Adding tools:replace="android:value" makes the
// merger use our value and ignore the library's.
module.exports = function withFcmChannelReplace(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;

    const metaData = application['meta-data'] ?? [];
    const entry = metaData.find((m) => m.$?.['android:name'] === FCM_CHANNEL_META);
    if (entry) {
      entry.$['tools:replace'] = 'android:value';
    }

    return config;
  });
};
