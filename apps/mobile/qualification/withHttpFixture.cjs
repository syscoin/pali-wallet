const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

// This plugin is appended only by the isolated HTTP qualification configuration.
module.exports = function withHttpFixture(config) {
  if (config.ios?.bundleIdentifier !== 'com.paliwallet.qualification' ||
      config.android?.package !== 'com.paliwallet.qualification' || !config.extra?.paliHttpQualification)
    throw Error('HTTP fixture configuration requires the isolated qualification identity');
  config.ios.infoPlist = { ...config.ios.infoPlist, NSAppTransportSecurity: {
    NSExceptionDomains: { '127.0.0.1': { NSExceptionAllowsInsecureHTTPLoads: true } },
  } };
  config = withAndroidManifest(config, (result) => {
    const app = result.modResults.manifest.application?.[0];
    if (!app) throw Error('Expected one qualification application');
    app.$['android:usesCleartextTraffic'] = 'false';
    app.$['android:networkSecurityConfig'] = '@xml/pali_http_qualification';
    return result;
  });
  return withDangerousMod(config, ['android', async (result) => {
    const folder = path.join(result.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'pali_http_qualification.xml'),
      '<?xml version="1.0" encoding="utf-8"?><network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain></domain-config></network-security-config>\n');
    return result;
  }]);
};
