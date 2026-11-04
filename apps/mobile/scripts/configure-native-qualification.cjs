const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// This mutates an isolated CI checkout only. Never use the fixture identifier or
// entrypoint for production builds, upgrades, or a user's installed wallet.
if (process.env.CI !== 'true' || process.env.PALI_NATIVE_QUALIFICATION !== '1')
  throw Error('Native qualification requires an explicit isolated CI checkout');
const root = path.resolve(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const appPath = path.join(root, 'app.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
if (
  pkg.main !== 'index.ts' ||
  app.expo.ios.bundleIdentifier !== 'com.paliwallet.mobile' ||
  app.expo.android.package !== 'com.paliwallet.mobile'
)
  throw Error('Expected an untouched production configuration');
if (
  app.expo.updates.enabled !== false ||
  app.expo.android.allowBackup !== false
)
  throw Error('Qualification must preserve backup/update restrictions');
if (pkg.dependencies['@sidhujag/sysweb3-keyring'] !== '1.0.628')
  throw Error('Unexpected shared keyring version');
const productionEntry = fs.readFileSync(path.join(root, 'index.ts'));
const receipt = {
  version: 1,
  productionEntrySha256: crypto
    .createHash('sha256')
    .update(productionEntry)
    .digest('hex'),
  originalMain: pkg.main,
  identifier: 'com.paliwallet.qualification',
  qualificationEntry: 'qualification/index.tsx',
  keyringVersion: '1.0.628',
};
pkg.main = receipt.qualificationEntry;
app.expo.name = 'PaliQualification';
app.expo.slug = 'pali-native-qualification';
app.expo.scheme = 'pali-wallet-qualification';
app.expo.ios.bundleIdentifier = receipt.identifier;
app.expo.android.package = receipt.identifier;
const write = (file, value) => {
  fs.writeFileSync(
    `${file}.qualification.tmp`,
    `${JSON.stringify(value, null, 2)}\n`,
    { flag: 'wx' }
  );
  fs.renameSync(`${file}.qualification.tmp`, file);
};
write(packagePath, pkg);
write(appPath, app);
write(path.join(root, '.native-qualification.json'), receipt);
console.log('Configured isolated com.paliwallet.qualification entrypoint');
