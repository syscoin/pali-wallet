const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readQualificationSdkPin, verifyInstalledQualificationSdk, readWalletConnectSdkIdentity } = require('./qualification-sdk.cjs');

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
const sdk = readQualificationSdkPin(root);
verifyInstalledQualificationSdk(root, sdk);
const walletConnectIdentity = readWalletConnectSdkIdentity(root);
const productionEntry = fs.readFileSync(path.join(root, 'index.ts'));
const physicalScenario = process.env.PALI_PHYSICAL_QUALIFICATION;
const httpEnabled = process.env.PALI_NATIVE_HTTP_QUALIFICATION === '1';
const publicPoolEnabled = process.env.PALI_NATIVE_PUBLIC_POOL_QUALIFICATION === '1';
const privateProofEnabled = process.env.PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION === '1';
const fullSlhEnabled = process.env.PALI_NATIVE_FULL_SLH_QUALIFICATION === '1';
if (process.env.PALI_NATIVE_FULL_SLH_QUALIFICATION !== undefined && !['0', '1'].includes(process.env.PALI_NATIVE_FULL_SLH_QUALIFICATION))
  throw Error('Full SLH qualification requires an explicit boolean mode');
let fullSlh;
if (fullSlhEnabled) {
  if (httpEnabled || publicPoolEnabled || privateProofEnabled || physicalScenario !== undefined ||
      !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '') ||
      ['paliFullSlhQualification', 'paliPrivateProofQualification', 'paliPublicPoolQualification', 'paliHttpQualification', 'paliPhysicalQualification'].some(key => app.expo.extra?.[key] !== undefined))
    throw Error('Full SLH qualification requires a dedicated isolated build');
  fullSlh = { version: 1, sourceRevision: process.env.GITHUB_SHA,
    lockfileSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex') };
}
if (!fullSlhEnabled && app.expo.extra?.paliFullSlhQualification !== undefined)
  throw Error('Full SLH qualification requires a dedicated isolated build');
let privateProof;
if (privateProofEnabled) {
  if (httpEnabled || publicPoolEnabled || physicalScenario !== undefined ||
      !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '') ||
      app.expo.extra?.paliPrivateProofQualification !== undefined ||
      app.expo.extra?.paliPublicPoolQualification !== undefined || app.expo.extra?.paliHttpQualification !== undefined)
    throw Error('Private proof qualification requires a dedicated isolated build');
  privateProof = { version: 1, sourceRevision: process.env.GITHUB_SHA,
    lockfileSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex') };
}
if (!privateProofEnabled && app.expo.extra?.paliPrivateProofQualification !== undefined)
  throw Error('Private proof qualification requires a dedicated isolated build');
let publicPool;
if (publicPoolEnabled) {
  if (httpEnabled || physicalScenario !== undefined || !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '') ||
      app.expo.extra?.paliPublicPoolQualification || app.expo.extra?.paliHttpQualification)
    throw Error('Public pool qualification requires a dedicated isolated build');
  const { readPublicPoolCa } = require('../qualification/public-pool-ca.cjs');
  publicPool = {
    build: { version: 1, sourceRevision: process.env.GITHUB_SHA,
      lockfileSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex') },
    caSha256: readPublicPoolCa(process.env.PALI_PUBLIC_POOL_FIXTURE_CA).sha256,
  };
}
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
  keyringVersion: sdk.version,
  ...(sdk.quickCryptoIdentity ? { quickCryptoIdentity: sdk.quickCryptoIdentity } : {}),
  ...(walletConnectIdentity ? { walletConnectIdentity } : {}),
  ...(physical ? { physical } : {}),
  ...(http ? { http } : {}),
  ...(publicPool ? { publicPool } : {}),
  ...(privateProof ? { privateProof } : {}),
  ...(fullSlh ? { fullSlh } : {}),
};
pkg.main = receipt.qualificationEntry;
app.expo.extra = {
  ...app.expo.extra,
  paliQualificationSdkVersion: sdk.version,
  paliQualificationSdkIdentity: sdk.identity,
  paliQualificationSdkDigest: sdk.candidateDigest,
  ...(sdk.quickCryptoIdentity ? { paliQuickCryptoSentryIdentity: sdk.quickCryptoIdentity } : {}),
  ...(walletConnectIdentity ? { paliWalletConnectIdentity: walletConnectIdentity } : {}),
};
app.expo.name = 'PaliQualification';
app.expo.slug = 'pali-native-qualification';
app.expo.scheme = 'pali-wallet-qualification';
app.expo.ios.bundleIdentifier = receipt.identifier;
app.expo.android.package = receipt.identifier;
if (http) {
  app.expo.extra = { ...app.expo.extra, paliHttpQualification: http };
  app.expo.plugins = [...(app.expo.plugins || []), './qualification/withHttpFixture.cjs'];
}
if (publicPool) {
  app.expo.extra = { ...app.expo.extra, paliPublicPoolQualification: publicPool };
  app.expo.plugins = [...(app.expo.plugins || []), './qualification/withHttpFixture.cjs'];
}
if (privateProof) app.expo.extra = { ...app.expo.extra, paliPrivateProofQualification: privateProof };
if (fullSlh) app.expo.extra = { ...app.expo.extra, paliFullSlhQualification: fullSlh };
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
