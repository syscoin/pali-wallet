const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readQualificationSdkPin, verifyInstalledQualificationSdk } = require('../scripts/qualification-sdk.cjs');

test('qualification configuration is explicit, isolated, and preserves the production entry bytes', () => {
  const keyringVersion = '3.9.7'; // Arbitrary exact fixture version, not an SDK release assumption.
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pali-qualification-config-')
  );
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: keyringVersion }));
    for (const script of ['configure-native-qualification.cjs', 'qualification-sdk.cjs'])
      fs.copyFileSync(require.resolve(`../scripts/${script}`), path.join(root, 'scripts', script));
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        main: 'index.ts',
        dependencies: { '@sidhujag/sysweb3-keyring': keyringVersion },
      })
    );
    fs.writeFileSync(
      path.join(root, 'app.json'),
      JSON.stringify({
        expo: {
          name: 'Pali',
          ios: { bundleIdentifier: 'com.paliwallet.mobile' },
          android: { package: 'com.paliwallet.mobile', allowBackup: false },
          updates: { enabled: false },
        },
      })
    );
    const original = "import App from './App'; // untouched production entry\n";
    fs.writeFileSync(path.join(root, 'index.ts'), original);
    const command = path.join(
      root,
      'scripts/configure-native-qualification.cjs'
    );
    assert.notEqual(
      spawnSync(process.execPath, [command], {
        env: { ...process.env, CI: 'false', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0' },
      }).status,
      0
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).main,
      'index.ts'
    );
    fs.writeFileSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: '3.9.6' }));
    assert.notEqual(spawnSync(process.execPath, [command], {
      env: { ...process.env, CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0' },
    }).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).main, 'index.ts');
    fs.writeFileSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: keyringVersion }));
    assert.equal(
      spawnSync(process.execPath, [command], {
        env: { ...process.env, CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0' },
      }).status,
      0
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.native-qualification.json'))).keyringVersion, keyringVersion);
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'))).expo;
    assert.equal(app.ios.bundleIdentifier, 'com.paliwallet.qualification');
    assert.equal(app.android.package, 'com.paliwallet.qualification');
    assert.equal(app.android.allowBackup, false);
    assert.equal(app.updates.enabled, false);
    assert.equal(app.extra.paliQualificationSdkIdentity, keyringVersion);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).main,
      'qualification/index.tsx'
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'index.ts'), 'utf8'),
      original
    );
    assert.notEqual(
      spawnSync(process.execPath, [command], {
        env: { ...process.env, CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0' },
      }).status,
      0
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local qualification binds the SDK report to the exact lock and installed archive bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-qualification-archive-'));
  const name = '@sidhujag/sysweb3-keyring';
  const installed = path.join(root, 'node_modules', name);
  const archiveRelative = 'vendor/sysweb3-keyring-3.9.7-speedup-1234567.tgz';
  const archive = path.join(root, archiveRelative);
  const spec = `file:${archiveRelative}`;
  const manifest = { dependencies: { [name]: spec } };
  const writeManifest = () => fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  const build = path.join(root, 'staging/package');
  const sdkFile = 'runtime.js';
  try {
    fs.mkdirSync(build, { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.writeFileSync(path.join(build, 'package.json'), JSON.stringify({ name, version: '3.9.7' }));
    fs.writeFileSync(path.join(build, sdkFile), 'patched sdk');
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', path.dirname(build), 'package']).status, 0);
    fs.cpSync(build, installed, { recursive: true });
    writeManifest();
    const bytes = fs.readFileSync(archive);
    const hash = (algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding);
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { [name]: spec } },
        [`node_modules/${name}`]: { version: '3.9.7', resolved: spec, integrity: `sha512-${hash('sha512', 'base64')}` },
      },
    };
    const writeLock = () => fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    writeLock();

    const pin = readQualificationSdkPin(root);
    assert.equal(pin.version, '3.9.7');
    assert.equal(pin.identity, `3.9.7+archive.sha256.${hash('sha256', 'hex')}`);
    verifyInstalledQualificationSdk(root, pin);

    fs.writeFileSync(path.join(installed, sdkFile), 'different sdk with identical package metadata');
    assert.throws(() => verifyInstalledQualificationSdk(root, pin), /does not match the locked archive/);
    lock.packages[''].dependencies[name] = '3.9.7';
    writeLock();
    assert.throws(() => readQualificationSdkPin(root), /must match the manifest and npm lock/);
    lock.packages[''].dependencies[name] = spec;
    writeLock();
    fs.appendFileSync(archive, 'altered bytes');
    assert.throws(() => readQualificationSdkPin(root), /does not match the npm lock integrity/);
    manifest.dependencies[name] = 'file:../sysweb3-keyring-3.9.7-speedup-1234567.tgz';
    writeManifest();
    assert.throws(() => readQualificationSdkPin(root), /Expected an exact shared keyring pin/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
