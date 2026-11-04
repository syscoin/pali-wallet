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
const keyringVersion = pkg.dependencies['@sidhujag/sysweb3-keyring'];
const installedKeyring = JSON.parse(fs.readFileSync(
  path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), 'utf8'
));
if (typeof keyringVersion !== 'string' ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(keyringVersion) ||
    installedKeyring.name !== '@sidhujag/sysweb3-keyring' || installedKeyring.version !== keyringVersion)
  throw Error('Installed shared keyring must match the exact manifest version');
const productionEntry = fs.readFileSync(path.join(root, 'index.ts'));
const physicalScenario = process.env.PALI_PHYSICAL_QUALIFICATION;
const httpEnabled = process.env.PALI_NATIVE_HTTP_QUALIFICATION === '1';
let http;
if (httpEnabled) {
  if (physicalScenario !== undefined || !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '') ||
      app.expo.extra?.paliHttpQualification)
    throw Error('HTTP qualification requires an immutable simulator/Android fixture');
  http = { version: 1, sourceRevision: process.env.GITHUB_SHA,
    lockfileSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex') };
}
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
  keyringVersion,
  ...(physical ? { physical } : {}),
  ...(http ? { http } : {}),
};
pkg.main = receipt.qualificationEntry;
app.expo.extra = { ...app.expo.extra, paliQualificationSdkVersion: keyringVersion };
app.expo.name = 'PaliQualification';
app.expo.slug = 'pali-native-qualification';
app.expo.scheme = 'pali-wallet-qualification';
app.expo.ios.bundleIdentifier = receipt.identifier;
app.expo.android.package = receipt.identifier;
if (http) {
  app.expo.extra = { ...app.expo.extra, paliHttpQualification: http };
  app.expo.plugins = [...(app.expo.plugins || []), './qualification/withHttpFixture.cjs'];
}
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
