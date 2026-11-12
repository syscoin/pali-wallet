const {
  parseBuildNumber,
  parseCanarySeries,
} = require('../../scripts/build-number.cjs');

// Pure configuration: reserving a number belongs to the build wrapper, never
// to a Webpack/config read (which can happen repeatedly in one build).
function extensionBuildVersion(environment, packageVersion, buildNumber) {
  if (environment === 'development')
    return {
      version: packageVersion,
      version_name: `${packageVersion} Development`,
    };
  if (environment !== 'canary') return { version: packageVersion };
  const series = parseCanarySeries(packageVersion);
  const number = parseBuildNumber(buildNumber, 'canary');
  return {
    version: `${series}.${number}`,
    version_name: `${series} Canary (${number})`,
  };
}

module.exports = { extensionBuildVersion };
