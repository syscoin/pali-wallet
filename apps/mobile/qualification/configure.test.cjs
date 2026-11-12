const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readQualificationSdkPin } = require('../scripts/qualification-sdk.cjs');

test('qualification configuration is explicit, isolated, and preserves the production entry bytes', () => {
  const keyringVersion = '3.9.7'; // Arbitrary exact fixture version, not an SDK release assumption.
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pali-qualification-config-')
  );
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: keyringVersion }));
    for (const script of ['configure-native-qualification.cjs', 'qualification-sdk.cjs', 'qualificationSdkIdentity.ts'])
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
    // This fixture configures the ordinary app regardless of the hosted lane.
    const env = { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0' };
    const run = (overrides) => spawnSync(process.execPath, [command], {
      env: { ...env, ...overrides },
    });
    assert.notEqual(run({ CI: 'false' }).status, 0);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).main,
      'index.ts'
    );
    fs.writeFileSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: '3.9.6' }));
    assert.notEqual(run().status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).main, 'index.ts');
    fs.writeFileSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: keyringVersion }));
    assert.equal(run().status, 0);
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
    assert.notEqual(run().status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('qualification refuses unpinned archives and ranged SDK versions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-qualification-pin-'));
  const name = '@sidhujag/sysweb3-keyring';
  try {
    for (const version of [
      'file:vendor/sysweb3-keyring-3.9.7-reviewed-1234567.tgz',
      'file:../keyring.tgz', '^3.9.7', 'latest',
    ]) {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { [name]: version } }));
      assert.throws(() => readQualificationSdkPin(root), /Expected an exact shared keyring pin/);
    }
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { [name]: '3.9.7' } }));
    assert.deepEqual(readQualificationSdkPin(root), { version: '3.9.7', identity: '3.9.7' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('private proof build mode binds immutable source and lock metadata without baking a launch token', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-private-proof-config-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    const sdk = path.join(root, 'node_modules/@sidhujag/sysweb3-keyring');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: '3.9.7' }));
    for (const script of ['configure-native-qualification.cjs', 'qualification-sdk.cjs', 'qualificationSdkIdentity.ts'])
      fs.copyFileSync(require.resolve(`../scripts/${script}`), path.join(root, 'scripts', script));
    const pkg = { main: 'index.ts', dependencies: { '@sidhujag/sysweb3-keyring': '3.9.7' } };
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(root, 'index.ts'), 'PUBLIC fixture entry\n');
    fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: {
      ios: { bundleIdentifier: 'com.paliwallet.mobile' },
      android: { package: 'com.paliwallet.mobile', allowBackup: false }, updates: { enabled: false },
    } }));
    const env = { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION: '1', GITHUB_SHA: 'a'.repeat(40) };
    const run = (overrides = {}) => spawnSync(process.execPath, [path.join(root, 'scripts/configure-native-qualification.cjs')], { env: { ...env, ...overrides } });
    for (const overrides of [{ GITHUB_SHA: '' }, { PALI_NATIVE_HTTP_QUALIFICATION: '1' },
      { PALI_NATIVE_PUBLIC_POOL_QUALIFICATION: '1' }, { PALI_PHYSICAL_QUALIFICATION: 'import' }]) {
      assert.notEqual(run(overrides).status, 0);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))), pkg);
    }
    assert.equal(run().status, 0);
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'))).expo;
    const build = app.extra.paliPrivateProofQualification;
    assert.deepEqual(build, { version: 1, sourceRevision: 'a'.repeat(40),
      lockfileSha256: require('node:crypto').createHash('sha256').update('{}').digest('hex') });
    assert.equal(app.extra.paliQualificationSdkVersion, '3.9.7');
    assert.equal(app.extra.paliQualificationSdkIdentity, '3.9.7');
    assert.equal(app.extra.paliHttpQualification, undefined);
    assert.equal(app.extra.paliPublicPoolQualification, undefined);
    assert.equal(build.token, undefined);
    assert.equal(app.android.allowBackup, false);
    assert.equal(app.updates.enabled, false);
    assert.equal(fs.readFileSync(path.join(root, 'index.ts'), 'utf8'), 'PUBLIC fixture entry\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('official SDK verification uses the explicitly selected working directory without changing installed files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-official-sdk-'));
  const name = '@sidhujag/sysweb3-keyring';
  const sdk = path.join(root, 'node_modules', name);
  try {
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { [name]: '3.9.7' } }));
    const file = path.join(sdk, 'package.json');
    const bytes = JSON.stringify({ name, version: '3.9.7' });
    fs.writeFileSync(file, bytes);
    const command = require.resolve('../scripts/qualification-sdk.cjs');
    const valid = spawnSync(process.execPath, [command], { cwd: root, encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /Verified shared keyring 3\.9\.7/);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    fs.writeFileSync(file, JSON.stringify({ name, version: '3.9.6' }));
    const invalid = spawnSync(process.execPath, [command], { cwd: root, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /exact manifest version/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('full SLH is manual, mutually exclusive, source/lock bound and never a production capability override', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-full-slh-config-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    const sdk = path.join(root, 'node_modules/@sidhujag/sysweb3-keyring'); fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: '3.9.7' }));
    for (const script of ['configure-native-qualification.cjs', 'qualification-sdk.cjs', 'qualificationSdkIdentity.ts']) fs.copyFileSync(require.resolve(`../scripts/${script}`), path.join(root, 'scripts', script));
    const pkg = { main: 'index.ts', dependencies: { '@sidhujag/sysweb3-keyring': '3.9.7' } };
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg)); fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(root, 'index.ts'), 'PUBLIC untouched production entry');
    fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: { ios: { bundleIdentifier: 'com.paliwallet.mobile' }, android: { package: 'com.paliwallet.mobile', allowBackup: false }, updates: { enabled: false } } }));
    const env = { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_FULL_SLH_QUALIFICATION: '1', GITHUB_SHA: 'a'.repeat(40) };
    const run = (overrides = {}) => spawnSync(process.execPath, [path.join(root, 'scripts/configure-native-qualification.cjs')], { env: { ...env, ...overrides } });
    for (const patch of [{ CI: 'false' }, { GITHUB_SHA: '' }, { PALI_NATIVE_HTTP_QUALIFICATION: '1' }, { PALI_NATIVE_PUBLIC_POOL_QUALIFICATION: '1' }, { PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION: '1' }, { PALI_PHYSICAL_QUALIFICATION: 'import' }, { PALI_NATIVE_FULL_SLH_QUALIFICATION: 'true' }]) {
      assert.notEqual(run(patch).status, 0); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))), pkg);
    }
    assert.equal(run().status, 0);
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'))).expo;
    const receipt = JSON.parse(fs.readFileSync(path.join(root, '.native-qualification.json')));
    assert.deepEqual(app.extra.paliFullSlhQualification, { version: 1, sourceRevision: 'a'.repeat(40), lockfileSha256: require('node:crypto').createHash('sha256').update('{}').digest('hex') });
    assert.deepEqual(receipt.fullSlh, app.extra.paliFullSlhQualification);
    assert.equal(app.extra.slhExecution, undefined); assert.equal(app.android.package, 'com.paliwallet.qualification');
    assert.equal(app.android.allowBackup, false); assert.equal(app.updates.enabled, false);
    assert.equal(fs.readFileSync(path.join(root, 'index.ts'), 'utf8'), 'PUBLIC untouched production entry');
    const workflow = fs.readFileSync(path.resolve(path.dirname(require.resolve('./configure.test.cjs')), '../../../.github/workflows/mobile-native-qualification.yml'), 'utf8');
    assert.match(workflow, /full_slh:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/);
    assert.match(workflow, /PALI_SLH_FULL_EQUIVALENCE: \$\{\{ inputs\.full_slh && '1' \|\| '0' \}\}/);
    assert.equal((workflow.match(/timeout-minutes: 90/g) || []).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
