const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('qualification configuration is explicit, isolated, and preserves the production entry bytes', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pali-qualification-config-')
  );
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(
      require.resolve('../scripts/configure-native-qualification.cjs'),
      path.join(root, 'scripts/configure-native-qualification.cjs')
    );
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        main: 'index.ts',
        dependencies: { '@sidhujag/sysweb3-keyring': '1.0.628' },
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
        env: { ...process.env, CI: 'false', PALI_NATIVE_QUALIFICATION: '1' },
      }).status,
      0
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).main,
      'index.ts'
    );
    assert.equal(
      spawnSync(process.execPath, [command], {
        env: { ...process.env, CI: 'true', PALI_NATIVE_QUALIFICATION: '1' },
      }).status,
      0
    );
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
    assert.notEqual(
      spawnSync(process.execPath, [command], {
        env: { ...process.env, CI: 'true', PALI_NATIVE_QUALIFICATION: '1' },
      }).status,
      0
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
