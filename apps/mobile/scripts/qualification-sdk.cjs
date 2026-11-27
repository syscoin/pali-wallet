const fs = require('node:fs');
const path = require('node:path');
const { composeQualificationSdkIdentity, composeQuickCryptoReleaseIdentity } = require('./qualificationSdkIdentity.ts');

const name = '@sidhujag/sysweb3-keyring';
const quickCryptoName = 'react-native-quick-crypto';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readQualificationSdkPin(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  const version = pkg.dependencies[name];
  const quickCryptoVersion = pkg.dependencies[quickCryptoName];
  const quickCryptoIdentity = quickCryptoVersion === undefined && pkg.name !== '@pali/mobile'
    ? undefined
    : composeQuickCryptoReleaseIdentity(quickCryptoVersion);
  return {
    version,
    identity: composeQualificationSdkIdentity(version, quickCryptoIdentity),
    ...(quickCryptoIdentity ? { quickCryptoIdentity } : {}),
  };
}

function verifyInstalledQualificationSdk(root, pin) {
  const metadata = readJson(path.join(root, 'node_modules', name, 'package.json'));
  if (metadata.name !== name || metadata.version !== pin.version)
    throw Error('Installed shared keyring must match the exact manifest version');
  const expected = readQualificationSdkPin(root);
  if (expected.identity !== pin.identity)
    throw Error('Native qualification SDK identity mismatch');
  if (expected.quickCryptoIdentity) {
    const quickCrypto = readJson(path.join(root, 'node_modules', quickCryptoName, 'package.json'));
    if (quickCrypto.name !== quickCryptoName ||
        composeQuickCryptoReleaseIdentity(quickCrypto.version) !== expected.quickCryptoIdentity)
      throw Error('Installed QuickCrypto must match the exact manifest version');
  }
  readWalletConnectSdkIdentity(root);
}

function readWalletConnectSdkIdentity(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg.paliWalletConnectPatch === undefined) {
    if (pkg.scripts?.postinstall?.includes('apply-walletconnect-terminal'))
      throw Error('WalletConnect candidate requires qualification provenance');
    return undefined;
  }
  const { identity, verifyWalletConnectTerminalPatch } = require(path.resolve(root, '../../scripts/apply-walletconnect-terminal.cjs'));
  if (pkg.paliWalletConnectPatch !== identity)
    throw Error('WalletConnect candidate provenance mismatch');
  verifyWalletConnectTerminalPatch(root);
  return identity;
}

module.exports = { readQualificationSdkPin, verifyInstalledQualificationSdk, readWalletConnectSdkIdentity };

if (require.main === module) {
  const root = process.cwd();
  const pin = readQualificationSdkPin(root);
  verifyInstalledQualificationSdk(root, pin);
  console.log(`Verified shared keyring ${pin.identity}`);
}
