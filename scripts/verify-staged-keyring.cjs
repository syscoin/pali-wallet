// Temporary package staging gate. Remove with the staged archives after release.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const digest = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);

function verifyPackage(root, directory, name, archiveName) {
  const staging = path.join(root, 'vendor', directory);
  const metadata = JSON.parse(
    fs.readFileSync(path.join(staging, 'provenance.json'))
  );
  assert.equal(metadata.name, name);
  assert.equal(metadata.archive, archiveName);
  assert.match(metadata.sourceCommit, /^[0-9a-f]{40}$/);
  const archive = fs.readFileSync(path.join(staging, metadata.archive));
  assert.equal(
    digest(archive),
    metadata.archiveSha256,
    'Staged archive changed'
  );
  assert.equal(digest(archive, 'sha1'), metadata.archiveSha1);
  assert.equal(
    `sha512-${digest(archive, 'sha512', 'base64')}`,
    metadata.integrity
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.equal(manifest.dependencies[metadata.name], metadata.version);
  const installed = path.dirname(
    require.resolve(`${metadata.name}/package.json`, { paths: [root] })
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(installed, 'package.json'))).version,
    metadata.version
  );
  const actual = {};
  function visit(relative = '') {
    for (const name of fs.readdirSync(path.join(installed, relative)).sort()) {
      if (!relative && name === 'node_modules') continue;
      const entry = path.posix.join(relative, name);
      const full = path.join(installed, entry);
      const stat = fs.lstatSync(full);
      assert(!stat.isSymbolicLink(), 'Staged package contains a symlink');
      if (stat.isDirectory()) visit(entry);
      else {
        assert(stat.isFile(), 'Staged package contains a non-file');
        actual[entry] = digest(fs.readFileSync(full));
      }
    }
  }
  visit();
  assert.deepEqual(
    actual,
    metadata.files,
    'Installed package differs from reviewed archive'
  );
  return {
    version: metadata.version,
    sourceCommit: metadata.sourceCommit,
    archiveSha256: metadata.archiveSha256,
    files: Object.keys(actual).length,
  };
}

function verify(root = path.resolve(__dirname, '..')) {
  const keyring = verifyPackage(
    root,
    'sysweb3-keyring',
    '@sidhujag/sysweb3-keyring',
    'keyring.tgz'
  );
  verifyPackage(root, 'syscoinjs-lib', 'syscoinjs-lib', 'library.tgz');
  // Preserve the original verifier's result for existing callers.
  return keyring;
}

if (require.main === module) console.log(JSON.stringify(verify()));
module.exports = { verify };
