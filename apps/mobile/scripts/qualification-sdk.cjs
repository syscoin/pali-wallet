const { createHash } = require('node:crypto');
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
  const requested = pkg.dependencies[name];
  let version = requested;
  let keyringIdentity = '';
  if (typeof requested === 'string' && requested.startsWith('file:')) {
    const candidate =
      /^file:(?:apps\/mobile\/)?vendor\/sysweb3-keyring-(\d+\.\d+\.\d+)\.tgz$/.exec(
        requested
      );
    if (!candidate) throw Error('Expected a repository keyring candidate');
    version = candidate[1];
    const archive = path.resolve(root, requested.slice(5));
    const mobileRoot = path.dirname(path.dirname(archive));
    const lock = readJson(path.join(mobileRoot, 'package-lock.json'));
    const localPin = `file:vendor/${path.basename(archive)}`;
    const entry = lock.packages?.[`node_modules/${name}`];
    const bytes = fs.readFileSync(archive);
    const integrity = `sha512-${createHash('sha512')
      .update(bytes)
      .digest('base64')}`;
    if (
      lock.packages?.['']?.dependencies?.[name] !== localPin ||
      entry?.resolved !== localPin ||
      entry?.version !== version ||
      entry?.integrity !== integrity
    )
      throw Error('Keyring candidate must match the exact locked archive');
    keyringIdentity = `.keyring.${createHash('sha256')
      .update(bytes)
      .digest('hex')}`;
  }
  if (typeof version !== 'string' || !exactVersion.test(version))
    throw Error('Expected an exact shared keyring pin');
  const quickCryptoIdentity = readQuickCryptoSentryIdentity(root);
  // Keep the semantic Keyring version separate from candidate provenance.
  // Existing app reports and host acceptance already compare this identity.
  return {
    version,
    identity: `${version}${keyringIdentity}${
      quickCryptoIdentity ? `.${quickCryptoIdentity}` : ''
    }`,
    ...(quickCryptoIdentity ? { quickCryptoIdentity } : {}),
  };
}

function verifyInstalledQualificationSdk(root, pin) {
  const metadata = readJson(
    path.join(root, 'node_modules', name, 'package.json')
  );
  if (metadata.name !== name || metadata.version !== pin.version)
    throw Error(
      'Installed shared keyring must match the exact manifest version'
    );
  if (readQualificationSdkPin(root).identity !== pin.identity)
    throw Error('Native qualification candidate identity mismatch');
  readWalletConnectSdkIdentity(root);
}

function readQuickCryptoSentryIdentity(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg.paliQuickCryptoSentryPatch === undefined) {
    if (pkg.scripts?.postinstall?.includes('apply-quickcrypto-sentry'))
      throw Error('QuickCrypto candidate requires qualification provenance');
    return undefined;
  }
  const { identity, verifyQuickCryptoSentryPatch } = require(path.resolve(
    root,
    '../../scripts/apply-quickcrypto-sentry.cjs'
  ));
  if (
    pkg.dependencies?.['react-native-quick-crypto'] !== '1.1.9' ||
    pkg.paliQuickCryptoSentryPatch !== identity
  )
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
  const { identity, verifyWalletConnectTerminalPatch } = require(path.resolve(
    root,
    '../../scripts/apply-walletconnect-terminal.cjs'
  ));
  if (pkg.paliWalletConnectPatch !== identity)
    throw Error('WalletConnect candidate provenance mismatch');
  verifyWalletConnectTerminalPatch(root);
  return identity;
}

module.exports = {
  readQualificationSdkPin,
  verifyInstalledQualificationSdk,
  readWalletConnectSdkIdentity,
};

if (require.main === module) {
  const root = process.cwd();
  const pin = readQualificationSdkPin(root);
  verifyInstalledQualificationSdk(root, pin);
  console.log(`Verified shared keyring ${pin.identity}`);
}
