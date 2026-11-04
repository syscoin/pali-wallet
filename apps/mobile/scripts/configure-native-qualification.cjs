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
if (pkg.dependencies['@sidhujag/sysweb3-keyring'] !== '2.0.0')
  throw Error('Unexpected shared keyring version');
const productionEntry = fs.readFileSync(path.join(root, 'index.ts'));
const physicalScenario = process.env.PALI_PHYSICAL_QUALIFICATION;
let physical;
if (physicalScenario !== undefined) {
  const { PHYSICAL_BUNDLES } = require('../qualification/physical-contract.ts');
  if (
    !Object.hasOwn(PHYSICAL_BUNDLES, physicalScenario) ||
    !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '') ||
    app.expo.extra?.paliPhysicalQualification
  )
    throw Error(
      'Expected a fixed physical scenario and immutable source revision'
    );
  physical = {
    version: 1,
    scenario: physicalScenario,
    bundleIdentifier: PHYSICAL_BUNDLES[physicalScenario],
    sourceRevision: process.env.GITHUB_SHA,
    lockfileSha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, 'package-lock.json')))
      .digest('hex'),
  };
}
const receipt = {
  version: 1,
  productionEntrySha256: crypto
    .createHash('sha256')
    .update(productionEntry)
    .digest('hex'),
  originalMain: pkg.main,
  identifier: 'com.paliwallet.qualification',
  qualificationEntry: 'qualification/index.tsx',
  keyringVersion: '2.0.0',
  ...(physical ? { physical } : {}),
};
pkg.main = receipt.qualificationEntry;
app.expo.name = 'PaliQualification';
app.expo.slug = 'pali-native-qualification';
app.expo.scheme = 'pali-wallet-qualification';
app.expo.ios.bundleIdentifier = receipt.identifier;
app.expo.android.package = receipt.identifier;
if (physical) {
  app.expo.name =
    physicalScenario === 'import'
      ? 'PaliPhysicalImport'
      : 'PaliPhysicalGenerate';
  app.expo.ios.bundleIdentifier = physical.bundleIdentifier;
  app.expo.extra = { ...app.expo.extra, paliPhysicalQualification: physical };
  app.expo.ios.infoPlist = {
    ...app.expo.ios.infoPlist,
    PaliQualificationMode: 'physical',
    PaliQualificationScenario: physical.scenario,
    PaliQualificationSourceRevision: physical.sourceRevision,
    PaliQualificationLockfileSHA256: physical.lockfileSha256,
  };
}
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
