const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const { readPublicPoolCa } = require('./public-pool-ca.cjs');
const { publicPoolBuild } = require('./public-pool-contract.ts');

// This plugin is appended only by the isolated HTTP qualification configuration.
module.exports = function withHttpFixture(config) {
  const pool = config.extra?.paliPublicPoolQualification;
  const http = config.extra?.paliHttpQualification;
  if (config.ios?.bundleIdentifier !== 'com.paliwallet.qualification' ||
      config.android?.package !== 'com.paliwallet.qualification' || (!!pool === !!http))
    throw Error('HTTP fixture configuration requires the isolated qualification identity');
  const ca = pool ? readPublicPoolCa(process.env.PALI_PUBLIC_POOL_FIXTURE_CA) : undefined;
  if (ca && publicPoolBuild(pool).caSha256 !== ca.sha256)
    throw Error('PUBLIC_POOL_QUALIFICATION_CA_CHANGED');
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
    const trust = ca ? '<trust-anchors><certificates src="@raw/pali_public_pool_fixture_ca"/></trust-anchors>' : '';
    if (ca) {
      const raw = path.resolve(folder, '../raw');
      fs.mkdirSync(raw, { recursive: true });
      fs.writeFileSync(path.join(raw, 'pali_public_pool_fixture_ca.pem'), ca.pem);
    }
    fs.writeFileSync(path.join(folder, 'pali_http_qualification.xml'),
      '<?xml version="1.0" encoding="utf-8"?><network-security-config><base-config cleartextTrafficPermitted="false"/>' +
      '<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain>' +
      trust + '</domain-config></network-security-config>\n');
    return result;
  }]);
};
