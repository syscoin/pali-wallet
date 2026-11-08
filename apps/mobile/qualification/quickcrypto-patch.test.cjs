const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inflateRawSync } = require('node:zlib');
const manifest = require('../../../scripts/quickcrypto-sentry.json');
const {
  applyQuickCryptoSentryPatch,
  verifyQuickCryptoSentryPatch,
  identity,
} = require('../../../scripts/apply-quickcrypto-sentry.cjs');
const { readQualificationSdkPin } = require('../scripts/qualification-sdk.cjs');
const pkg = manifest.packages[0];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-quickcrypto-patch-'));
  const root = path.join(parent, 'apps/mobile');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(parent, 'scripts'));
  for (const file of ['apply-quickcrypto-sentry.cjs', 'quickcrypto-sentry.json'])
    fs.copyFileSync(require.resolve(`../../../scripts/${file}`), path.join(parent, 'scripts', file));
  for (const file of ['qualification-sdk.cjs', 'configure-native-qualification.cjs'])
    fs.copyFileSync(require.resolve(`../scripts/${file}`), path.join(root, 'scripts', file));
  const directory = path.join(root, 'node_modules', pkg.name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version }));
  for (const file of pkg.files) {
    const target = path.join(directory, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, inflateRawSync(Buffer.from(file.deflate, 'base64'), { maxOutputLength: file.bytes }));
  }
  const keyring = path.join(root, 'node_modules/@sidhujag/sysweb3-keyring');
  fs.mkdirSync(keyring, { recursive: true });
  fs.writeFileSync(path.join(keyring, 'package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: '3.9.7' }));
  const appPackage = {
    main: 'index.ts', dependencies: { '@sidhujag/sysweb3-keyring': '3.9.7', [pkg.name]: pkg.version },
    scripts: { postinstall: 'node ../../scripts/apply-quickcrypto-sentry.cjs' },
    paliQuickCryptoSentryPatch: identity,
  };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(appPackage));
  fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: {
    ios: { bundleIdentifier: 'com.paliwallet.mobile' },
    android: { package: 'com.paliwallet.mobile', allowBackup: false }, updates: { enabled: false },
  } }));
  fs.writeFileSync(path.join(root, 'index.ts'), '// untouched production entry\n');
  return { parent, root, directory, appPackage, target: (file) => path.join(directory, file.path) };
}

test('the adoption artifact has exactly the five reviewed production files and exact output hashes', () => {
  assert.equal(manifest.source, 'a470f8220db63b9d7c6deef72c403e69f8a89408');
  assert.equal(manifest.baseSource, '27ca9a067e4e7c5721fb0b213418b8e247d14967');
  assert.equal(pkg.version, '1.1.9');
  assert.deepEqual(pkg.files.map((file) => file.path), [
    'cpp/slhdsa/HybridSlhDsaKeyPair.cpp', 'cpp/slhdsa/HybridSlhDsaKeyPair.hpp',
    'cpp/slhdsa/SlhDsaRawPrivateKeyValidation.hpp', 'src/index.ts', 'src/slhdsa.ts',
  ]);
  for (const file of pkg.files) {
    const output = inflateRawSync(Buffer.from(file.deflate, 'base64'), { maxOutputLength: file.bytes });
    assert.equal(output.length, file.bytes);
    assert.equal(digest(output), file.after);
    assert(file.before === null || /^[0-9a-f]{64}$/.test(file.before));
  }
  assert(identity.includes(manifest.source));
  assert(identity.endsWith(digest(fs.readFileSync(require.resolve('../../../scripts/quickcrypto-sentry.json')))));
});

test('adoption installs the absent native header and is idempotent after interruption', () => {
  const f = fixture();
  try {
    const header = pkg.files.find((file) => file.before === null);
    fs.unlinkSync(f.target(header));
    assert.throws(() => verifyQuickCryptoSentryPatch(f.root), /unexpected bytes/);
    applyQuickCryptoSentryPatch(f.root);
    assert.equal(verifyQuickCryptoSentryPatch(f.root), identity);
    applyQuickCryptoSentryPatch(f.root);
    assert.equal(verifyQuickCryptoSentryPatch(f.root), identity);
  } finally { fs.rmSync(f.parent, { recursive: true, force: true }); }
});

test('unexpected bytes anywhere prevent all writes and mismatched versions fail closed', () => {
  const f = fixture();
  try {
    const header = pkg.files.find((file) => file.before === null);
    fs.unlinkSync(f.target(header));
    fs.writeFileSync(f.target(pkg.files.at(-1)), 'unexpected bytes');
    assert.throws(() => applyQuickCryptoSentryPatch(f.root), /unexpected bytes/);
    assert.equal(fs.existsSync(f.target(header)), false);
    assert.throws(() => verifyQuickCryptoSentryPatch(f.root), /unexpected bytes/);
    fs.writeFileSync(path.join(f.directory, 'package.json'), JSON.stringify({ name: pkg.name, version: '1.1.10' }));
    assert.throws(() => applyQuickCryptoSentryPatch(f.root), /requires react-native-quick-crypto@1\.1\.9/);
    assert.equal(fs.existsSync(f.target(header)), false);
  } finally { fs.rmSync(f.parent, { recursive: true, force: true }); }
});

test('linked node_modules, packages, metadata, and output files cannot mutate external targets', () => {
  for (const kind of ['node_modules', 'package', 'metadata', 'file']) {
    const f = fixture();
    try {
      const external = path.join(f.parent, 'outside');
      const target = kind === 'node_modules' ? path.join(f.root, 'node_modules')
        : kind === 'package' ? f.directory
          : kind === 'metadata' ? path.join(f.directory, 'package.json') : f.target(pkg.files[0]);
      fs.renameSync(target, external);
      const sentinel = ['node_modules', 'package'].includes(kind) ? path.join(external, 'sentinel') : external;
      if (sentinel !== external) fs.writeFileSync(sentinel, 'untouched');
      const before = fs.readFileSync(sentinel);
      fs.symlinkSync(external, target);
      assert.throws(() => applyQuickCryptoSentryPatch(f.root), /linked installation/);
      assert.throws(() => verifyQuickCryptoSentryPatch(f.root), /linked installation/);
      assert.deepEqual(fs.readFileSync(sentinel), before);
    } finally { fs.rmSync(f.parent, { recursive: true, force: true }); }
  }
});

test('qualification uses the existing candidate identity channel and preserves the package version', () => {
  const f = fixture();
  try {
    const pin = readQualificationSdkPin(f.root);
    assert.equal(pin.version, '3.9.7');
    assert.equal(pin.identity, `3.9.7.${identity}`);
    const result = spawnSync(process.execPath, [path.join(f.root, 'scripts/configure-native-qualification.cjs')], {
      env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0' },
    });
    assert.equal(result.status, 0, result.stderr.toString());
    const receipt = JSON.parse(fs.readFileSync(path.join(f.root, '.native-qualification.json')));
    assert.equal(receipt.keyringVersion, '3.9.7');
    assert.equal(receipt.quickCryptoIdentity, identity);
    const extra = JSON.parse(fs.readFileSync(path.join(f.root, 'app.json'))).expo.extra;
    assert.equal(extra.paliQualificationSdkVersion, '3.9.7');
    assert.equal(extra.paliQualificationSdkIdentity, pin.identity);
    assert.equal(extra.paliQuickCryptoSentryIdentity, identity);
  } finally { fs.rmSync(f.parent, { recursive: true, force: true }); }
});

test('qualification refuses missing provenance, changed identities, pins, and installed source bytes', () => {
  const f = fixture();
  try {
    const write = (pkg) => fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify(pkg));
    const { paliQuickCryptoSentryPatch, ...missing } = f.appPackage;
    assert.equal(paliQuickCryptoSentryPatch, identity);
    write(missing);
    assert.throws(() => readQualificationSdkPin(f.root), /requires qualification provenance/);
    write({ ...f.appPackage, paliQuickCryptoSentryPatch: `${identity}-unreviewed` });
    assert.throws(() => readQualificationSdkPin(f.root), /provenance mismatch/);
    write({ ...f.appPackage, dependencies: { ...f.appPackage.dependencies, [pkg.name]: '^1.1.9' } });
    assert.throws(() => readQualificationSdkPin(f.root), /provenance mismatch/);
    write(f.appPackage);
    fs.writeFileSync(f.target(pkg.files[0]), 'stock or unreviewed native source');
    assert.throws(() => readQualificationSdkPin(f.root), /unexpected bytes/);
  } finally { fs.rmSync(f.parent, { recursive: true, force: true }); }
});
