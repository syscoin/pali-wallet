const { parseBuildNumber } = require('../../scripts/build-number.cjs');

// Configuration is read repeatedly by Expo. Only the build entry point reserves a number.
module.exports = ({ config }) => {
  const value = process.env.PALI_MOBILE_BUILD_NUMBER;
  if (value === undefined) return config;
  const number = parseBuildNumber(value, 'mobile');
  return {
    ...config,
    ios: { ...config.ios, buildNumber: String(number) },
    android: { ...config.android, versionCode: number },
  };
};
