const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runNativeBuild } = require('./run-native-build.cjs');

// Explicit, offline integration check. Only this temporary app is prebuilt;
// the installed dependency graph is read, never installed or changed.
async function checkNativePrebuildPreservation() {
  const sourceApp = path.resolve(__dirname, '..');
  const sourceRepo = path.resolve(sourceApp, '../..');
  const appRequire = createRequire(path.join(sourceApp, 'package.json'));
  const expoPackage = appRequire.resolve('expo/package.json');
  const expoRequire = createRequire(expoPackage);
  const lock = JSON.parse(fs.readFileSync(path.join(sourceApp, 'package-lock.json'), 'utf8'));
  const expoVersion = expoRequire('./package.json').version;
  const cliPackage = expoRequire.resolve('@expo/cli/package.json');
  const cliVersion = JSON.parse(fs.readFileSync(cliPackage, 'utf8')).version;
  assert.equal(expoVersion, lock.packages['node_modules/expo'].version);
  assert.equal(cliVersion, lock.packages['node_modules/expo/node_modules/@expo/cli'].version);
  const template = path.join(path.dirname(expoPackage), 'template.tgz');
  assert(fs.statSync(template).isFile(), 'The pinned Expo package must include its local template.');
  const cli = path.join(path.dirname(expoPackage), 'bin/cli');
  const plist = expoRequire('@expo/plist').default;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-prebuild-preservation-'));
  const root = path.join(temporary, 'apps/mobile');
  try {
    fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(temporary, 'scripts'));
    fs.symlinkSync(fs.realpathSync(path.join(sourceApp, 'node_modules')), path.join(root, 'node_modules'), 'dir');
    const pkg = JSON.parse(fs.readFileSync(path.join(sourceApp, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'pali-prebuild-preservation', private: true, version: pkg.version,
      dependencies: { expo: expoVersion, react: pkg.dependencies.react, 'react-native': pkg.dependencies['react-native'] },
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: {
      name: 'PaliPreservation', slug: 'pali-prebuild-preservation', version: pkg.version,
      ios: { bundleIdentifier: 'com.paliwallet.mobile' }, android: { package: 'com.paliwallet.mobile' },
      plugins: ['./plugins/withNativeBuildNumber.cjs'],
    } }, null, 2) + '\n');
    for (const file of ['app.config.cjs', 'plugins/withNativeBuildNumber.cjs'])
      fs.copyFileSync(path.join(sourceApp, file), path.join(root, file));
    fs.copyFileSync(path.join(sourceRepo, 'scripts/build-number.cjs'), path.join(temporary, 'scripts/build-number.cjs'));
    const guarded = ['app.json', 'app.config.cjs', 'plugins/withNativeBuildNumber.cjs'];
    const sourceHashes = guarded.map(file => fs.readFileSync(path.join(root, file)));
    let allocated = 1, assertions = 0, executions = 0;
    const numbers = [];
    const ports = {
      appRoot: root,
      async reserve(options) {
        assert.deepEqual(options, { cwd: root, purpose: 'qa', channel: 'mobile' });
        const buildNumber = ++allocated;
        numbers.push(buildNumber);
        return { schemaVersion: 1, channel: 'mobile', buildNumber, sourceRevision: 'a'.repeat(40),
          allocationRevision: 'b'.repeat(40), requestId: '12345678-1234-4234-9234-123456789abc',
          purpose: 'qa', allocatedAt: '2026-11-12T00:00:00.000Z', sourceDirty: false };
      },
      async assertSource({ cwd, receipt }) {
        assert.equal(cwd, root); assert.equal(receipt.buildNumber, allocated);
        guarded.forEach((file, index) => assert(fs.readFileSync(path.join(root, file)).equals(sourceHashes[index])));
        assertions++;
      },
      async prepareAssets() {
        assert(fs.existsSync(path.join(root, '.pali-build/inflight/owner.json')));
        // This minimal app does not load Pali's proof plugins or compile code.
      },
      async execute(args, env) {
        assert.equal(args[0], 'prebuild', 'The preservation check must never compile or launch an app.');
        executions++;
        const result = spawnSync(process.execPath, [cli, ...args, '--template', template,
          '--skip-dependency-update', 'expo,react,react-native'], {
          cwd: root, env: { ...env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1',
            EXPO_HOME: path.join(temporary, '.expo') }, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
        });
        if (result.error || result.status !== 0)
          throw Error(`Pinned Expo prebuild failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
      },
    };
    await runNativeBuild(['all', '--prepare-only'], ports);
    const ios = path.join(root, 'ios/PaliPreservation/Info.plist');
    const android = path.join(root, 'android/app/build.gradle');
    const readIos = () => plist.parse(fs.readFileSync(ios, 'utf8'));
    const assertNumber = number => {
      assert.equal(readIos().CFBundleVersion, String(number));
      assert.match(fs.readFileSync(android, 'utf8'), new RegExp(`\\bversionCode\\s+${number}\\b`));
      const receipt = JSON.parse(fs.readFileSync(path.join(root, `.pali-build/build-${number}.json`), 'utf8'));
      assert.equal(receipt.buildNumber, number); assert.equal(receipt.preparedOnly, true);
      assert(!fs.existsSync(path.join(root, '.pali-build/inflight')));
    };
    assertNumber(2);
    const sentinel = 'Keep this native customization.\n';
    const sentinels = ['ios/pali-preservation.txt', 'android/pali-preservation.txt'];
    for (const file of sentinels) fs.writeFileSync(path.join(root, file), sentinel);
    fs.writeFileSync(ios, plist.build({ ...readIos(), PaliPreservationSetting: 'preserve-me' }));
    fs.appendFileSync(android, '\n// Pali native preservation setting\n');
    await runNativeBuild(['all', '--prepare-only'], ports);
    assertNumber(3);
    for (const file of sentinels) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), sentinel);
    assert.equal(readIos().PaliPreservationSetting, 'preserve-me');
    assert.match(fs.readFileSync(android, 'utf8'), /\/\/ Pali native preservation setting/);
    assert.deepEqual(numbers, [2, 3]); assert.equal(assertions, 6); assert.equal(executions, 2);
    return { expoVersion, cliVersion, templateSha256: createHash('sha256').update(fs.readFileSync(template)).digest('hex'),
      buildNumbers: numbers, nativeCustomizationsPreserved: true, compiled: false };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

module.exports = { checkNativePrebuildPreservation };
if (require.main === module) checkNativePrebuildPreservation().then(result => {
  console.log(JSON.stringify(result));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
