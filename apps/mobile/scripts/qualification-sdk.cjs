const fs = require('node:fs');
const path = require('node:path');

const name = '@sidhujag/sysweb3-keyring';
const exactVersion =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readQualificationSdkPin(root) {
  const version = readJson(path.join(root, 'package.json')).dependencies[name];
  if (typeof version !== 'string' || !exactVersion.test(version))
    throw Error('Expected an exact shared keyring pin');
  return { version, identity: version };
}

function verifyInstalledQualificationSdk(root, pin) {
  const metadata = readJson(path.join(root, 'node_modules', name, 'package.json'));
  if (metadata.name !== name || metadata.version !== pin.version)
    throw Error('Installed shared keyring must match the exact manifest version');
}

module.exports = { readQualificationSdkPin, verifyInstalledQualificationSdk };
