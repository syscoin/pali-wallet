const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
  const patch = pkg.paliKeyringPatch;
  if (patch === undefined) {
    if (pkg.scripts?.postinstall?.includes('apply-keyring-ledger'))
      throw Error('Patched SDK installation requires qualification provenance');
    return { version, identity: version };
  }
  const manifestFile = path.resolve(root, '../../scripts/keyring-ledger-2.1.7.json');
  const bytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (manifest.version !== version || patch.sourceCommit !== manifest.sourceCommit || patch.manifestSha256 !== sha256)
    throw Error('Qualification Ledger patch provenance mismatch');
  return { version, identity: `${version}+ledger.${manifest.sourceCommit}.sha256.${sha256}`, patch: true };
}

function verifyInstalledQualificationSdk(root, pin) {
  const metadata = readJson(path.join(root, 'node_modules', name, 'package.json'));
  if (metadata.name !== name || metadata.version !== pin.version)
    throw Error('Installed shared keyring must match the exact manifest version');
  if (pin.patch) {
    const { verifyKeyringLedgerPatch } = require(path.resolve(root, '../../scripts/apply-keyring-ledger.cjs'));
    verifyKeyringLedgerPatch(path.join(root, 'node_modules', name));
  }
}

module.exports = { readQualificationSdkPin, verifyInstalledQualificationSdk };
