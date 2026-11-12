const { withInfoPlist, withDangerousMod } = require('expo/config-plugins');
const { parseBuildNumber } = require('../scripts/native-build-number.cjs');

const packageId = 'com.paliwallet.mobile';
const qualificationIds = new Set([
  'com.paliwallet.qualification',
  'com.paliwallet.qualification.physical.import',
  'com.paliwallet.qualification.physical.generate',
  'com.paliwallet.qualification.physical.slh',
]);

function requireReservedNumber(config, platform) {
  const identity = platform === 'ios' ? config.ios?.bundleIdentifier : config.android?.package;
  if (qualificationIds.has(identity) && config.slug === 'pali-native-qualification') return null;
  if (identity !== packageId) throw Error('Unrecognized Pali native build identity.');
  if (process.env.PALI_MOBILE_BUILD_NUMBER === undefined)
    throw Error('Use npm run ios, npm run android, or npm run native:prepare to reserve a Pali build number.');
  const number = parseBuildNumber(process.env.PALI_MOBILE_BUILD_NUMBER);
  if (config.ios?.buildNumber !== String(number) || config.android?.versionCode !== number)
    throw Error('Pali native build numbers must match the reserved number.');
  return number;
}

module.exports = function withNativeBuildNumber(config) {
  config = withInfoPlist(config, result => {
    const number = requireReservedNumber(result, 'ios');
    if (number !== null) result.modResults.CFBundleVersion = String(number);
    return result;
  });
  return withDangerousMod(config, ['android', async result => {
    requireReservedNumber(result, 'android');
    return result;
  }]);
};
