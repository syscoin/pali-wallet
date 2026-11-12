const fs = require('node:fs');
const path = require('node:path');

const name = '@sidhujag/sysweb3-keyring';
const exactVersion =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readQualificationSdkPin(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  const version = pkg.dependencies[name];
  if (typeof version !== 'string' || !exactVersion.test(version))
    throw Error('Expected an exact shared keyring pin');
  const quickCryptoIdentity = readQuickCryptoSentryIdentity(root);
  const feeRateIdentity = readKeyringFeeRateIdentity(root);
  return {
    version,
    identity: [version, quickCryptoIdentity, feeRateIdentity].filter(Boolean).join('.'),
    ...(feeRateIdentity ? { feeRateIdentity } : {}),
    ...(quickCryptoIdentity ? { quickCryptoIdentity } : {}),
  };
}

function verifyInstalledQualificationSdk(root, pin) {
  const metadata = readJson(path.join(root, 'node_modules', name, 'package.json'));
  if (metadata.name !== name || metadata.version !== pin.version)
    throw Error('Installed shared keyring must match the exact manifest version');
  if (readQualificationSdkPin(root).identity !== pin.identity)
    throw Error('Native qualification SDK identity mismatch');
  readWalletConnectSdkIdentity(root);
}

function readKeyringFeeRateIdentity(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg.paliKeyringFeeRatePatch === undefined) {
    if (pkg.scripts?.postinstall?.includes('apply-keyring-fee-rate'))
      throw Error('Keyring fee candidate requires qualification provenance');
    return undefined;
  }
  const { identity, verifyKeyringFeeRatePatch } = require(path.resolve(__dirname, '../../../scripts/apply-keyring-fee-rate.cjs'));
  if (pkg.paliKeyringFeeRatePatch !== identity) throw Error('Keyring fee candidate provenance mismatch');
  verifyKeyringFeeRatePatch(root);
  return identity;
}

function readQuickCryptoSentryIdentity(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg.paliQuickCryptoSentryPatch === undefined) {
    if (pkg.scripts?.postinstall?.includes('apply-quickcrypto-sentry'))
      throw Error('QuickCrypto candidate requires qualification provenance');
    return undefined;
  }
  const { identity, verifyQuickCryptoSentryPatch } = require(path.resolve(root, '../../scripts/apply-quickcrypto-sentry.cjs'));
  if (pkg.dependencies?.['react-native-quick-crypto'] !== '1.1.9' ||
      pkg.paliQuickCryptoSentryPatch !== identity)
    throw Error('QuickCrypto candidate provenance mismatch');
  verifyQuickCryptoSentryPatch(root);
  return identity;
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
