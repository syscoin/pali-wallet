const { parseBuildNumber } = require('../../scripts/build-number.cjs');
const { CANARY_BASE_VERSION } = require('../shared/extensionReleaseChannel.ts');

// Pure configuration: reserving a number belongs to the build wrapper, never
// to a Webpack/config read (which can happen repeatedly in one build).
function extensionBuildVersion(environment, packageVersion, buildNumber) {
  if (environment === 'development')
    return {
      version: packageVersion,
      version_name: `${packageVersion} Development`,
    };
  if (environment !== 'canary') return { version: packageVersion };
  const number = parseBuildNumber(buildNumber, 'canary');
  return {
    version: `${CANARY_BASE_VERSION}.${number}`,
    version_name: `${CANARY_BASE_VERSION} Canary (${number})`,
  };
}

module.exports = { extensionBuildVersion, CANARY_BASE_VERSION };
