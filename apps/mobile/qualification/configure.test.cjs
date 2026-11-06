const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('qualification configuration is explicit, isolated, and preserves the production entry bytes', () => {
  const keyringVersion = '3.9.7'; // Arbitrary exact fixture version, not an SDK release assumption.
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pali-qualification-config-')
  );
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: keyringVersion }));
    fs.copyFileSync(
      require.resolve('../scripts/configure-native-qualification.cjs'),
      path.join(root, 'scripts/configure-native-qualification.cjs')
    );
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
