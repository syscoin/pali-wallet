const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const name = '@sidhujag/sysweb3-keyring';
const packageDirectory = `node_modules/${name}`;
const exactVersion =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const reviewedArchive =
  /^file:(vendor\/sysweb3-keyring-((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))-speedup-[0-9a-f]{7,40}\.tgz)$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readQualificationSdkPin(root) {
  const spec = readJson(path.join(root, 'package.json')).dependencies[name];
  if (typeof spec === 'string' && exactVersion.test(spec))
    return { version: spec, identity: spec };

  const local = typeof spec === 'string' && reviewedArchive.exec(spec);
  if (!local) throw Error('Expected an exact shared keyring pin');
  const [, relative, version] = local;
  const lock = readJson(path.join(root, 'package-lock.json'));
  const locked = lock.packages?.[packageDirectory];
  if (
    lock.lockfileVersion !== 3 ||
    lock.packages?.['']?.dependencies?.[name] !== spec ||
    locked?.resolved !== spec ||
    locked.version !== version
  )
    throw Error('Shared keyring archive must match the manifest and npm lock');

  const archive = path.join(root, relative);
  if (
    !fs.lstatSync(archive).isFile() ||
    fs.realpathSync(archive) !== path.join(fs.realpathSync(root), relative)
  )
    throw Error(
      'Expected a regular shared keyring archive in the mobile vendor directory'
    );
  const bytes = fs.readFileSync(archive);
  const integrity = `sha512-${crypto
    .createHash('sha512')
    .update(bytes)
    .digest('base64')}`;
  if (locked.integrity !== integrity)
    throw Error('Shared keyring archive does not match the npm lock integrity');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  return { version, identity: `${version}+archive.sha256.${digest}`, archive };
}

function samePackageTree(expected, installed, packageRoot = true) {
  const expectedStat = fs.lstatSync(expected);
  const actualStat = fs.lstatSync(installed);
  if (expectedStat.isFile())
    return (
      actualStat.isFile() &&
      fs.readFileSync(expected).equals(fs.readFileSync(installed))
    );
  if (!expectedStat.isDirectory() || !actualStat.isDirectory()) return false;
  const names = fs.readdirSync(expected).sort();
  const installedNames = fs
    .readdirSync(installed)
    .filter((entry) => !packageRoot || entry !== 'node_modules')
    .sort();
  return (
    names.length === installedNames.length &&
    names.every(
      (entry, index) =>
        entry === installedNames[index] &&
        samePackageTree(
          path.join(expected, entry),
          path.join(installed, entry),
          false
        )
    )
  );
}

function verifyInstalledQualificationSdk(root, pin) {
  const installed = path.join(root, packageDirectory);
  const metadata = readJson(path.join(installed, 'package.json'));
  if (metadata.name !== name || metadata.version !== pin.version)
    throw Error(
      'Installed shared keyring must match the exact manifest version'
    );
  if (!pin.archive) return;

  // npm ci already verifies this reviewed archive before installing it. Compare
  // the actual package tree too because the local archive shares npm's version.
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pali-qualification-sdk-')
  );
  try {
    execFileSync('tar', [
      '-xzf',
      pin.archive,
      '-C',
      scratch,
      '--no-same-owner',
      '--no-same-permissions',
    ]);
    if (!samePackageTree(path.join(scratch, 'package'), installed))
      throw Error('Installed shared keyring does not match the locked archive');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = { readQualificationSdkPin, verifyInstalledQualificationSdk };
