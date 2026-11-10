const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const name = '@sidhujag/sysweb3-keyring';
const exactVersion =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readReviewedCandidate(root, dependency) {
  const directory = path.resolve(root, '../../vendor/sysweb3-operation');
  const marker = readJson(path.join(directory, 'REVIEWED-CANDIDATE.json'));
  const pkg = marker.package;
  if (marker.status !== 'unpublished-review-candidate' ||
      marker.repository !== 'https://github.com/sidhujag/sysweb3' ||
      !/^[0-9a-f]{40}$/.test(marker.head) ||
      pkg?.name !== name || !exactVersion.test(pkg.version) ||
      !/^[A-Za-z0-9.-]+\.tgz$/.test(pkg.filename) ||
      dependency !== `file:../../vendor/sysweb3-operation/${pkg.filename}` ||
      !/^[0-9a-f]{64}$/.test(pkg.sha256) ||
      createHash('sha256').update(fs.readFileSync(path.join(directory, pkg.filename))).digest('hex') !== pkg.sha256)
    throw Error('Reviewed shared keyring candidate identity mismatch');
  const files = marker.distFiles;
  if (!files || typeof files !== 'object' || Array.isArray(files) ||
      !['package.json', 'cjs/software.js', 'cjs/keyring-core.js', 'cjs/private-records.js', 'cjs/transactions/syscoin-core.js'].every(file => Object.hasOwn(files, file)) ||
      Object.entries(files).some(([file, hash]) => !/^(?:package\.json|(?:cjs|esm|types)\/[A-Za-z0-9_./-]+)$/.test(file) ||
        file.split('/').some(part => part === '..' || !part) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)))
    throw Error('Reviewed shared keyring file manifest is invalid');
  return { version: pkg.version, digest: pkg.sha256, files };
}

function readQualificationSdkPin(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  const dependency = pkg.dependencies[name];
  const candidate = typeof dependency === 'string' && dependency.startsWith('file:../../vendor/sysweb3-operation/')
    ? readReviewedCandidate(root, dependency) : null;
  const version = candidate?.version ?? dependency;
  if (typeof version !== 'string' || !exactVersion.test(version))
    throw Error('Expected an exact shared keyring pin');
  const quickCryptoIdentity = readQuickCryptoSentryIdentity(root);
  const sdkIdentity = candidate ? `${version}.sdk-${candidate.digest}` : version;
  return {
    version,
    identity: quickCryptoIdentity ? `${sdkIdentity}.${quickCryptoIdentity}` : sdkIdentity,
    ...(candidate ? { candidateDigest: candidate.digest } : {}),
    ...(quickCryptoIdentity ? { quickCryptoIdentity } : {}),
  };
}

function verifyInstalledQualificationSdk(root, pin) {
  const metadata = readJson(path.join(root, 'node_modules', name, 'package.json'));
  if (metadata.name !== name || metadata.version !== pin.version)
    throw Error('Installed shared keyring must match the exact manifest version');
  if (readQualificationSdkPin(root).identity !== pin.identity)
    throw Error('Native qualification candidate identity mismatch');
  if (pin.candidateDigest) {
    const candidate = readReviewedCandidate(root, readJson(path.join(root, 'package.json')).dependencies[name]);
    for (const [file, expected] of Object.entries(candidate.files)) {
      const actual = createHash('sha256').update(fs.readFileSync(path.join(root, 'node_modules', name, file))).digest('hex');
      if (actual !== expected) throw Error(`Installed shared keyring candidate differs: ${file}`);
    }
  }
  readWalletConnectSdkIdentity(root);
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
