const { withAndroidManifest } = require('expo/config-plugins');
// Explicit in release manifests; debug tooling may provide its own local override.
module.exports = function withMobileSafety(config) {
  return withAndroidManifest(config, (result) => {
    const app = result.modResults.manifest.application?.[0];
    if (!app) throw new Error('Expected one Android application');
    app.$['android:usesCleartextTraffic'] = 'false';
    return result;
  });
};
