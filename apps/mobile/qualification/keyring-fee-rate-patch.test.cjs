const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  applyKeyringFeeRatePatch,
  verifyKeyringFeeRatePatch,
  identity,
} = require('../../../scripts/apply-keyring-fee-rate.cjs');
const manifest = require('../../../scripts/keyring-fee-rate.json');
const digest = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-fee-patch-test-'));
  const pkg = path.join(root, 'node_modules/@sidhujag/sysweb3-keyring');
  for (const file of manifest.packages[0].files) {
    if (file.before === null) continue;
    const installed = path.join(
      path.dirname(require.resolve('@sidhujag/sysweb3-keyring/package.json')),
      file.path
    );
    let text = fs.readFileSync(installed, 'utf8');
    if (digest(text) === file.after)
      for (const edit of [...file.edits].reverse())
        text = text.replace(edit.after, () => edit.before);
    assert.equal(digest(text), file.before);
    fs.mkdirSync(path.dirname(path.join(pkg, file.path)), { recursive: true });
    fs.writeFileSync(path.join(pkg, file.path), text);
  }
  return {
    root,
    pkg,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
test('reviewed fee patch applies exactly once and verifies all output bytes', () => {
  const f = fixture();
  try {
    assert.throws(() => verifyKeyringFeeRatePatch(f.root));
    applyKeyringFeeRatePatch(f.root);
    assert.equal(verifyKeyringFeeRatePatch(f.root), identity);
    const core = fs.readFileSync(
      path.join(f.pkg, 'cjs/transactions/syscoin-core.js')
    );
    applyKeyringFeeRatePatch(f.root);
    assert.deepEqual(
      fs.readFileSync(path.join(f.pkg, 'cjs/transactions/syscoin-core.js')),
      core
    );
    assert.equal(
      require(path.join(f.pkg, 'cjs/utils/utxo-fee-rate.js')).utxoFeeRateUnits(
        7e-8
      ),
      7
    );
  } finally {
    f.close();
  }
});
test('unexpected bytes refuse every write before adoption', () => {
  const f = fixture();
  try {
    const metadata = fs.readFileSync(path.join(f.pkg, 'package.json'));
    fs.appendFileSync(
      path.join(f.pkg, 'esm/transactions/syscoin-core.js'),
      '\n// unexpected'
    );
    assert.throws(() => applyKeyringFeeRatePatch(f.root), /unexpected bytes/);
    assert.deepEqual(
      fs.readFileSync(path.join(f.pkg, 'package.json')),
      metadata
    );
    assert.equal(
      fs.existsSync(path.join(f.pkg, 'cjs/utils/utxo-fee-rate.js')),
      false
    );
  } finally {
    f.close();
  }
});
test('linked dependency trees are not mutated', () => {
  const f = fixture(),
    linked = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-fee-linked-'));
  try {
    fs.symlinkSync(
      path.join(f.root, 'node_modules'),
      path.join(linked, 'node_modules')
    );
    assert.throws(() => applyKeyringFeeRatePatch(linked), /linked/);
  } finally {
    f.close();
    fs.rmSync(linked, { recursive: true, force: true });
  }
});

test('a preexisting temporary symlink cannot be followed or deleted', () => {
  const f = fixture(),
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-fee-victim-'));
  try {
    const victim = path.join(outside, 'untouched');
    fs.writeFileSync(victim, 'original');
    const temporary = path.join(
      f.pkg,
      `cjs/transactions/syscoin-core.js.pali-fee-rate-${process.pid}`
    );
    fs.symlinkSync(victim, temporary);
    assert.throws(() => applyKeyringFeeRatePatch(f.root), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(victim, 'utf8'), 'original');
    assert.equal(fs.lstatSync(temporary).isSymbolicLink(), true);
  } finally {
    f.close();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
