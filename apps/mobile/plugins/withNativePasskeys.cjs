const { withAndroidManifest, withStringsXml } = require('expo/config-plugins');

// This is the app's credential domain, never supplied by a dapp or QR code.
const domain = 'paliwallet.com';
const statements = JSON.stringify([{ include: `https://${domain}/.well-known/assetlinks.json` }]);
// Expo leaves nontranslatable strings untouched; AAPT still requires escaped quotes.
const resourceStatements = statements.replace(/"/g, '\\"');
module.exports = function withNativePasskeys(config) {
  config.ios = { ...config.ios, associatedDomains: [...new Set([...(config.ios?.associatedDomains ?? []), `webcredentials:${domain}`])] };
  config = withAndroidManifest(config, result => {
    const app = result.modResults.manifest.application?.[0];
    if (!app) throw Error('Passkeys require an Android application');
    const metadata = app['meta-data'] ??= [];
    const previous = metadata.find(item => item.$?.['android:name'] === 'asset_statements');
    if (previous && previous.$['android:resource'] !== '@string/pali_passkey_asset_statements')
      throw Error('Conflicting credential association');
    if (!previous) metadata.push({ $: { 'android:name': 'asset_statements', 'android:resource': '@string/pali_passkey_asset_statements' } });
    return result;
  });
  return withStringsXml(config, result => {
    const strings = result.modResults.resources.string ??= [];
    const previous = strings.find(item => item.$?.name === 'pali_passkey_asset_statements');
    if (previous && previous._ !== statements && previous._ !== resourceStatements) throw Error('Conflicting credential association');
    if (previous) { previous.$.translatable = 'false'; previous._ = resourceStatements; }
    else strings.push({ $: { name: 'pali_passkey_asset_statements', translatable: 'false' }, _: resourceStatements });
    return result;
  });
};
