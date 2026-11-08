const test = require('node:test');
const { Buffer } = require('node:buffer');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const manifest = require('../../../scripts/walletconnect-terminal.json');
const {
  applyWalletConnectTerminalPatch,
  verifyWalletConnectTerminalPatch,
  identity,
} = require('../../../scripts/apply-walletconnect-terminal.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-wc-patch-'));
  for (const pkg of manifest.packages) {
    const directory = path.join(root, 'node_modules', pkg.name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: pkg.name, version: pkg.version })
    );
    for (const file of pkg.files) {
      const target = path.join(directory, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        inflateRawSync(Buffer.from(file.deflate, 'base64'), {
          maxOutputLength: file.bytes,
        })
      );
    }
  }
  return root;
}

test('candidate identity includes both reviewed commits and exact artifact bytes', () => {
  const root = fixture();
  try {
    assert.equal(verifyWalletConnectTerminalPatch(root), identity);
    assert(identity.includes(manifest.coreSource));
    assert(identity.includes(manifest.utilsSource));
    applyWalletConnectTerminalPatch(root);
    assert.equal(verifyWalletConnectTerminalPatch(root), identity);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('candidate rejects unexpected bytes or package versions before modification', () => {
  const root = fixture();
  try {
    const pkg = manifest.packages[0];
    const target = path.join(root, 'node_modules', pkg.name, pkg.files[0].path);
    fs.writeFileSync(target, 'unreviewed bytes');
    assert.throws(
      () => applyWalletConnectTerminalPatch(root),
      /unexpected bytes/
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'unreviewed bytes');
    assert.throws(
      () => verifyWalletConnectTerminalPatch(root),
      /unexpected bytes/
    );
    fs.writeFileSync(
      path.join(root, 'node_modules', pkg.name, 'package.json'),
      JSON.stringify({ name: pkg.name, version: '999.0.0' })
    );
    assert.throws(() => applyWalletConnectTerminalPatch(root), /requires/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
