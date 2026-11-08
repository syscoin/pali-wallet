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

test('dependency patchers refuse external linked installation roots and package targets', () => {
  const {
    applyKeyringLedgerPatch,
  } = require('../../../scripts/apply-keyring-ledger.cjs');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-patch-links-'));
  try {
    const external = path.join(parent, 'external');
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, 'sentinel'), 'untouched');
    for (const name of ['ledger', 'walletconnect']) {
      const root = path.join(parent, name);
      fs.mkdirSync(root);
      fs.symlinkSync(external, path.join(root, 'node_modules'));
      const apply = () =>
        name === 'ledger'
          ? applyKeyringLedgerPatch(
              path.join(root, 'node_modules/@sidhujag/sysweb3-keyring')
            )
          : applyWalletConnectTerminalPatch(root);
      assert.throws(apply, /linked installation/);
      fs.unlinkSync(path.join(root, 'node_modules'));
      const scope = name === 'ledger' ? '@sidhujag' : '@walletconnect';
      const pkg = name === 'ledger' ? 'sysweb3-keyring' : 'jsonrpc-types';
      fs.mkdirSync(path.join(root, 'node_modules', scope), { recursive: true });
      fs.symlinkSync(external, path.join(root, 'node_modules', scope, pkg));
      assert.throws(apply, /linked installation/);
    }
    assert.equal(
      fs.readFileSync(path.join(external, 'sentinel'), 'utf8'),
      'untouched'
    );
    assert.deepEqual(fs.readdirSync(external), ['sentinel']);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('dependency patchers refuse symlinked output files inside a local package', () => {
  const {
    applyKeyringLedgerPatch,
    verifyKeyringLedgerPatch,
  } = require('../../../scripts/apply-keyring-ledger.cjs');
  const ledger = require('../../../scripts/keyring-ledger-2.1.7.json');
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pali-patch-file-link-')
  );
  const wcRoot = fixture();
  try {
    const external = path.join(parent, 'outside-file');
    fs.writeFileSync(external, 'untouched');
    const ledgerRoot = path.join(parent, 'node_modules', ledger.package);
    fs.mkdirSync(ledgerRoot, { recursive: true });
    fs.writeFileSync(
      path.join(ledgerRoot, 'package.json'),
      JSON.stringify({ name: ledger.package, version: ledger.version })
    );
    const ledgerTarget = path.join(ledgerRoot, ledger.files[0].path);
    fs.mkdirSync(path.dirname(ledgerTarget), { recursive: true });
    fs.symlinkSync(external, ledgerTarget);
    assert.throws(
      () => applyKeyringLedgerPatch(ledgerRoot),
      /linked installation/
    );
    assert.throws(
      () => verifyKeyringLedgerPatch(ledgerRoot),
      /linked installation/
    );
    const pkg = manifest.packages[0];
    const wcTarget = path.join(
      wcRoot,
      'node_modules',
      pkg.name,
      pkg.files[0].path
    );
    fs.unlinkSync(wcTarget);
    fs.symlinkSync(external, wcTarget);
    assert.throws(
      () => applyWalletConnectTerminalPatch(wcRoot),
      /linked installation/
    );
    assert.throws(
      () => verifyWalletConnectTerminalPatch(wcRoot),
      /linked installation/
    );
    assert.equal(fs.readFileSync(external, 'utf8'), 'untouched');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(wcRoot, { recursive: true, force: true });
  }
});
