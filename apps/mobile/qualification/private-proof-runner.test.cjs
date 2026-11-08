/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const test = require('node:test');
const { runInNewContext } = require('node:vm');

async function fixture(platform, fail = false) {
  const calls = [], writes = [];
  const device = '11111111-2222-4333-8444-555555555555';
  const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
  const serial = 'emulator-5554';
  const uri = `pali-wallet-qualification://run?phase=create&scenario=import&proofToken=${'b'.repeat(32)}`;
  const process = { argv: ['node', 'runner', platform, '/public-artifact', ...(platform === 'ios' ? ['--ios-simulator-contract'] : [])], exitCode: 0,
    env: { CI: 'true', GITHUB_ACTIONS: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION: '1',
      PALI_NATIVE_HTTP_QUALIFICATION: '0', PALI_NATIVE_PUBLIC_POOL_QUALIFICATION: '0', GITHUB_SHA: 'a'.repeat(40),
      QUALIFICATION_ARTIFACTS: '/public-output', ANDROID_HOME: '/sdk' } };
  const spawnSync = (command, args) => {
    calls.push({ command, args });
    const ok = stdout => ({ status: 0, stdout: stdout ?? '' });
    if (command === 'plutil') return ok(args.includes('CFBundleIdentifier') ? 'com.paliwallet.qualification' : args.includes('DTPlatformName') ? 'iphonesimulator' : 'PaliQualification');
    if (args.includes('runtimes')) return ok(JSON.stringify({ runtimes: [{ identifier: runtime, version: '26.5', isAvailable: true }] }));
    if (args.includes('devicetypes')) return ok(JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] }));
    if (args.includes('create')) return ok(device);
    if (args.includes('devices')) return ok(JSON.stringify({ devices: { [runtime]: [{ udid: device, state: 'Booted', isAvailable: true }] } }));
    if (args.includes('launchctl')) return ok('12\t0\tcom.apple.SpringBoard\n');
    if (args.includes('get_app_container')) return ok('/public-container');
    if (command.endsWith('/aapt')) return ok(args.includes('badging') ? "package: name='com.paliwallet.qualification'\nlaunchable-activity: name='com.paliwallet.qualification.MainActivity'" :
      ['arm64-v8a', 'x86_64'].flatMap(abi => ['libQuickCrypto.so', 'libNitroModules.so', 'libexpo-sqlite.so'].map(lib => `lib/${abi}/${lib}`)).join('\n'));
    if (command === 'adb') {
      if (args[0] === 'get-serialno') return ok(serial);
      assert.deepEqual(Array.from(args.slice(0, 2)), ['-s', serial]);
      if (args.includes('emu')) return ok('PaliQualification\nOK');
      if (args.includes('ro.boot.qemu')) return ok('1');
      if (args.includes('ro.build.version.sdk')) return ok('35');
      if (args.includes('sys.boot_completed')) return ok('1');
      if (args.includes('id')) return ok('0');
    }
    return ok();
  };
  await runInNewContext(fs.readFileSync(require.resolve('./run-native.cjs'), 'utf8'), {
    process, setTimeout, console: { log() {}, error() {} }, __dirname,
    require(name) {
      if (name === 'fs') return {
        existsSync: file => file === '/public-artifact', mkdirSync() {},
        readdirSync: file => file.endsWith('/build-tools') ? ['37.0.0'] : [],
        readFileSync: () => Buffer.from('public binary'),
        writeFileSync: (file, text) => writes.push({ file, text }),
      };
      if (name === 'child_process') return { spawnSync };
      if (name === './private-proof-ci.cjs') return {
        readPrivateProofCiBuild: env => { assert.equal(env.PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION, '1'); return { version: 1 }; },
        runPrivateProofQualification: async options => {
          assert.equal(options.platform, platform);
          assert.deepEqual(Array.from(options.list()), []);
          await options.launch(uri);
          if (fail) throw Error('PRIVATE_PROOF_REPORT_INVALID');
          return { version: 1, kind: 'native-private-proof' };
        },
      };
      return require(name);
    },
  });
  return { calls, writes, process, device, serial };
}

for (const platform of ['ios', 'android']) test(`real ${platform} runner reuses owned lifecycle and keeps proof output separate`, async () => {
  for (const fail of [false, true]) {
    const result = await fixture(platform, fail);
    assert.equal(result.process.exitCode, fail ? 1 : 0, JSON.stringify(result.writes));
    assert(result.calls.some(call => call.args.includes(platform === 'ios' ? 'launch' : 'start')));
    if (platform === 'ios') {
      assert(result.calls.some(call => call.args.includes('shutdown') && call.args.includes(result.device)));
      assert(result.calls.some(call => call.args.includes('delete') && call.args.includes(result.device)));
    } else {
      assert.equal(result.calls.filter(call => call.args.includes('install')).length, 1);
      assert(result.calls.some(call => call.args.includes('force-stop')));
      assert.equal(result.calls.filter(call => call.args.includes('uninstall')).length, 2);
    }
    assert(!result.writes.some(write => /(?:qualification|simulator-limited)\.json$/.test(write.file)));
    assert.equal(result.writes.filter(write => write.file.endsWith(`${platform}-private-proof.json`)).length, fail ? 0 : 1);
  }
});
