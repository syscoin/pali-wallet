const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { Buffer } = require('node:buffer');
const { createCommandRunner, describeQualificationFailure, COLD_BOOT_TIMEOUT_MS } = require('./command-runner.cjs');

test('only explicit cold-boot wait receives600s while ordinary commands keep180s', () => {
  const calls = [];
  const run = createCommandRunner((command, args, options) => {
    calls.push({ command, args, options }); return { status: 0, stdout: ' ready\n' };
  });
  assert.equal(run('xcrun', ['simctl', 'boot', 'public-device']), 'ready');
  run('xcrun', ['simctl', 'bootstatus', 'public-device', '-b'], false, COLD_BOOT_TIMEOUT_MS);
  run('adb', ['shell', 'getprop', 'sys.boot_completed']);
  assert.deepEqual(calls.map((call) => call.options.timeout), [180000, 600000, 180000]);
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  assert.match(source, /\['simctl', 'bootstatus', device, '-b'\], false, COLD_BOOT_TIMEOUT_MS/);
  assert.equal((source.match(/false, COLD_BOOT_TIMEOUT_MS/g) || []).length, 1);
});

test('primary timed-out command survives optional cleanup failure with bounded redacted diagnostics', () => {
  const run = createCommandRunner(() => ({
    status: null, signal: 'SIGTERM', error: Object.assign(Error('spawn timed out public-fixture'), { code: 'ETIMEDOUT' }),
    stdout: 'x'.repeat(20000), stderr: 'public-fixture ' + 'y'.repeat(20000),
  }), (text) => text.split('public-fixture').join('[redacted]'));
  let primary;
  try { run('xcrun', ['simctl', 'bootstatus', 'public-fixture', '-b'], false, 600000); }
  catch (error) { primary = error; }
  assert(primary);
  assert.equal(run('xcrun', ['simctl', 'shutdown', 'public-device'], true), null);
  const failure = describeQualificationFailure(primary);
  assert.equal(failure.command, 'xcrun');
  assert.deepEqual(failure.args, ['simctl', 'bootstatus', '[redacted]', '-b']);
  assert.equal(failure.timeoutMs, 600000);
  assert.equal(failure.timedOut, true);
  assert.equal(failure.errorCode, 'ETIMEDOUT');
  assert.equal(failure.signal, 'SIGTERM');
  assert.equal(failure.stdoutTail.length, 2000);
  assert.equal(failure.stderrTail.length, 2000);
  assert(JSON.stringify(failure).length < 12000);
  assert(!JSON.stringify(failure).includes('public-fixture'));
});

test('nonzero and thrown errors retain their original status/code without pretending timeout', () => {
  const exit = createCommandRunner(() => ({ status: 7, stderr: 'public tool error' }));
  assert.throws(() => exit('adb', ['install', 'public.apk']), (error) => {
    const failure = describeQualificationFailure(error);
    assert.equal(failure.status, 7); assert.equal(failure.timedOut, false);
    assert.equal(failure.stderrTail, 'public tool error'); return true;
  });
  const spawn = createCommandRunner(() => { throw Object.assign(Error('not found'), { code: 'ENOENT' }); });
  assert.throws(() => spawn('missing', []), (error) => {
    assert.equal(describeQualificationFailure(error).errorCode, 'ENOENT'); return true;
  });
  assert.equal(spawn('missing', [], true), null);
  assert.deepEqual(describeQualificationFailure(Error('native report missing')), { kind: 'qualification', message: 'native report missing' });
});

test('the real runner writes the original boot failure artifact after cleanup also fails', async () => {
  const { runInNewContext } = require('node:vm');
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const writes = [], calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, timeout: options.timeout });
    const ok = (stdout) => ({ status: 0, stdout });
    if (command === 'plutil') return ok(args.includes('CFBundleIdentifier') ? 'com.paliwallet.qualification' : 'PaliQualification');
    if (args.includes('runtimes')) return ok(JSON.stringify({ runtimes: [{ isAvailable: true, identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', version: '26.5' }] }));
    if (args.includes('devicetypes')) return ok(JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] }));
    if (args.includes('create')) return ok('public-device');
    if (args.includes('boot')) return ok('');
    if (args.includes('bootstatus')) return { status: null, signal: 'SIGTERM', error: Object.assign(Error('boot deadline'), { code: 'ETIMEDOUT' }), stderr: 'public boot still pending' };
    return { status: 9, stderr: 'cleanup failure must not replace boot deadline' };
  };
  const fakeProcess = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', QUALIFICATION_ARTIFACTS: '/public-output' }, argv: ['node', 'runner', 'ios', '/public-app'], exitCode: 0 };
  await runInNewContext(source, {
    require(name) {
      if (name === 'fs') return { existsSync: () => true, mkdirSync() {}, writeFileSync(file, data) { writes.push({ file, data }); } };
      if (name === 'child_process') return { spawnSync: spawn };
      if (name === './command-runner.cjs') return require('./command-runner.cjs');
      return require(name);
    },
    process: fakeProcess, console: { error() {}, log() {} }, setTimeout,
  });
  assert.equal(fakeProcess.exitCode, 1);
  assert(calls.some((call) => call.args.includes('delete')));
  const artifact = writes.find((write) => write.file.endsWith('/ios-failure.json'));
  assert(artifact);
  const report = JSON.parse(artifact.data);
  assert.equal(report.failure.command, 'xcrun');
  assert.deepEqual(report.failure.args, ['simctl', 'bootstatus', 'public-device', '-b']);
  assert.equal(report.failure.timeoutMs, 600000);
  assert.equal(report.failure.timedOut, true);
  assert.equal(report.failure.stderrTail, 'public boot still pending');
  assert(!artifact.data.includes('cleanup failure'));
});

test('binary commands use180s and diagnostics never expose database stdout', () => {
  let options;
  const secret = Buffer.from('synthetic database must not be copied to an artifact');
  const run = createCommandRunner((_command, _args, config) => {
    options = config;
    return { status: 1, stdout: secret, stderr: Buffer.from('bounded public error') };
  });
  assert.throws(() => run.binary('adb', ['exec-out', 'cat', '/public/wallet.sqlite'], false, 64 * 1024 * 1024), (error) => {
    const failure = describeQualificationFailure(error);
    assert.equal(failure.timeoutMs, 180000);
    assert.equal(failure.stdoutBytes, secret.length);
    assert.equal(failure.stdoutTail, undefined);
    assert(!JSON.stringify(failure).includes(secret.toString()));
    return true;
  });
  assert.equal(options.encoding, undefined);
  assert.equal(options.maxBuffer, 64 * 1024 * 1024);
  assert.equal(options.timeout, 180000);
});

for (const diagnosticsAvailable of [true, false]) test(`Android cleanup preserves the database failure when diagnostics are ${diagnosticsAvailable ? 'available' : 'unavailable'}`, async () => {
  const { runInNewContext } = require('node:vm');
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const writes = [], calls = [];
  let screenshotWriteFailed = false;
  let pidReads = 0;
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const ok = (stdout) => ({ status: 0, stdout });
    if (command.endsWith('/aapt') && args[0] === 'dump') return ok("package: name='com.paliwallet.qualification'");
    if (command.endsWith('/aapt')) return ok(['arm64-v8a', 'x86_64'].flatMap((abi) => ['libQuickCrypto.so', 'libNitroModules.so', 'libexpo-sqlite.so'].map((file) => `lib/${abi}/${file}`)).join('\n'));
    if (args.includes('screencap')) return ok(Buffer.from('public PNG fixture'));
    if (args.includes('cat')) {
      if (args.some((value) => value.endsWith('pali-native-qualification-startup.json'))) return { status: 1, stderr: 'not present' };
      if (args[0] === 'exec-out') return { status: null, stdout: Buffer.from('PRIVATE_DATABASE_BYTES'), error: Object.assign(Error('database read timeout'), { code: 'ETIMEDOUT' }) };
      return ok(JSON.stringify({ version: 1, status: 'passed', phase: 'create', scenario: 'import', platform: 'android', networkCalls: 0, nativeBridgeExercised: true, fingerprint: 'a'.repeat(64), cryptoEvidence: { passed: true, productionIterations: 900000 }, mnemonicEntropyVerified: false }));
    }
    if (args.includes('pidof')) return ok(++pidReads === 1 ? '1234' : '');
    if (args.includes('logcat')) return diagnosticsAvailable ? ok('F/libc: SIGABRT libhermes.so synthetic_secret_token_42') : { status: 1, stderr: 'synthetic_secret_token_42' };
    if (args.includes('exit-info')) return diagnosticsAvailable ? ok('process=com.paliwallet.qualification reason=5 (APP CRASH(NATIVE))\n description=synthetic_secret_token_42') : { status: 1, stderr: 'synthetic_secret_token_42' };
    return ok('');
  };
  const fakeProcess = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', QUALIFICATION_ARTIFACTS: '/public-output', ANDROID_HOME: '/public-sdk' }, argv: ['node', 'runner', 'android', '/public.apk'], exitCode: 0 };
  await runInNewContext(source, {
    require(name) {
      if (name === 'fs') return {
        existsSync: () => true, mkdirSync() {}, readdirSync: () => ['37.0.0'],
        writeFileSync(file, data) {
          if (file.endsWith('.png')) { screenshotWriteFailed = true; throw Error('cleanup write failure'); }
          writes.push({ file, data });
        },
      };
      if (name === 'child_process') return { spawnSync: spawn };
      if (name === './command-runner.cjs') return require('./command-runner.cjs');
      return require(name);
    },
    process: fakeProcess, console: { error() {}, log() {} }, setTimeout,
  });
  const launch = calls.find((call) => call.args.includes('start'));
  const quotedUrl = launch.args[launch.args.indexOf('-d') + 1];
  const shell = require('node:child_process').spawnSync('bash', ['-c', `printf '%s' ${quotedUrl}`], { encoding: 'utf8' });
  assert.equal(shell.status, 0);
  assert.equal(shell.stdout, 'pali-wallet-qualification://run?phase=create&scenario=import');
  assert(writes.some((write) => write.file.endsWith('/android-import-create-launch.log')));
  const logcat = calls.find((call) => call.args.includes('logcat'));
  assert.deepEqual(Array.from(logcat.args), ['logcat', '-b', 'main', '-b', 'system', '-b', 'crash', '-d', '-t', '300', '-v', 'brief', '*:E']);
  assert(calls.some((call) => JSON.stringify(call.args) === JSON.stringify(['shell', 'dumpsys', 'activity', 'exit-info', 'com.paliwallet.qualification'])));
  const runtime = writes.find((write) => write.file.endsWith('/android-import-runtime-diagnostics.json'));
  assert.deepEqual(JSON.parse(runtime.data), { processRunning: false, logcatAvailable: diagnosticsAvailable, exitInfoAvailable: diagnosticsAvailable, codes: diagnosticsAvailable ? ['SIGABRT'] : [], modules: [], libraries: diagnosticsAvailable ? ['libhermes.so'] : [], exitReasons: diagnosticsAvailable ? ['CRASH_NATIVE'] : [] });
  assert(!runtime.data.includes('synthetic_secret_token_42'));
  assert(screenshotWriteFailed);
  const artifact = writes.find((write) => write.file.endsWith('/android-failure.json'));
  assert(artifact);
  const report = JSON.parse(artifact.data);
  assert.deepEqual(report.failure.args, ['exec-out', 'cat', '/data/user/0/com.paliwallet.qualification/no_backup/PaliWallet/wallet.sqlite']);
  assert.equal(report.failure.errorCode, 'ETIMEDOUT');
  assert.equal(report.failure.timeoutMs, 180000);
  assert.equal(report.failure.stdoutBytes, Buffer.byteLength('PRIVATE_DATABASE_BYTES'));
  assert(!artifact.data.includes('PRIVATE_DATABASE_BYTES'));
  assert(!artifact.data.includes('cleanup write failure'));
  assert(calls.every((call) => call.options.timeout === 180000));
});

test('the real iOS runner launches the isolated app directly with its public argument', async () => {
  const { runInNewContext } = require('node:vm');
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const calls = [];
  const spawn = (command, args) => {
    calls.push({ command, args });
    const ok = (stdout) => ({ status: 0, stdout });
    if (command === 'plutil') return ok(args.includes('CFBundleIdentifier') ? 'com.paliwallet.qualification' : 'PaliQualification');
    if (args.includes('runtimes')) return ok(JSON.stringify({ runtimes: [{ isAvailable: true, identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', version: '26.5' }] }));
    if (args.includes('devicetypes')) return ok(JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] }));
    if (args.includes('create')) return ok('public-device');
    if (args.includes('get_app_container')) return ok('/public-container');
    if (args.includes('launch')) return { status: 7, stderr: 'stop fixture after observing launch arguments' };
    return ok('');
  };
  await runInNewContext(source, {
    require(name) {
      if (name === 'fs') return { existsSync: () => true, mkdirSync() {}, writeFileSync() {} };
      if (name === 'child_process') return { spawnSync: spawn };
      if (name === './command-runner.cjs') return require('./command-runner.cjs');
      return require(name);
    },
    process: { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1' }, argv: ['node', 'runner', 'ios', '/public-app'] },
    console: { error() {}, log() {} }, setTimeout,
  });
  assert.deepEqual(Array.from(calls.find((call) => call.args.includes('launch')).args), ['simctl', 'launch', 'public-device', 'com.paliwallet.qualification', '-PaliQualificationURL', 'pali-wallet-qualification://run?phase=create&scenario=import']);
  assert(!calls.some((call) => call.args.includes('openurl')));
});

function reportWaitFixture() {
  const { runInNewContext } = require('node:vm');
  const { isCryptoDiagnostic } = require('../src/crypto/diagnostics.ts');
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const start = source.indexOf('const validateReport =');
  const end = source.indexOf('const databaseEvidence =', start);
  let now = 0;
  const wait = runInNewContext(source.slice(start, end) + '\nwaitReport;', {
    isCryptoDiagnostic, PUBLIC_PHRASE: 'public fixture', PUBLIC_PASSWORD: 'public password', platform: 'android',
    fs: { writeFileSync() {} }, path: { join: () => 'unused' }, output: 'unused',
    Date: { now: () => now }, sleep: async (milliseconds) => { now += milliseconds; },
  });
  const report = JSON.stringify({ version: 1, status: 'passed', phase: 'create', scenario: 'import', platform: 'android',
    networkCalls: 0, nativeBridgeExercised: true, mnemonicEntropyVerified: false,
    fingerprint: 'a'.repeat(64), cryptoEvidence: { passed: true, productionIterations: 900000 } });
  return { wait, report, now: () => now };
}

test('Android liveness maps only pidof exit one to absence and preserves transport or command failure', () => {
  const { runInNewContext } = require('node:vm');
  const { spawnSync } = require('node:child_process');
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const start = source.indexOf('const androidProcessRunning =');
  const end = source.indexOf('const sleep =', start);
  const probe = (spawn) => runInNewContext(source.slice(start, end) + '\nandroidProcessRunning;', {
    PACKAGE: 'com.paliwallet.qualification', run: createCommandRunner(spawn),
  });
  for (const [exit, expected] of [[0, true], [1, false], [2, 'error']]) {
    const isRunning = probe((_command, args, options) => spawnSync('bash', ['-c',
      `pidof() { if [ ${exit} -eq 0 ]; then printf 1234; fi; return ${exit}; }; ${args[1]}`,
    ], options));
    if (expected === 'error') assert.throws(isRunning, (error) => error.failure.status === 2);
    else assert.equal(isRunning(), expected);
  }
  const offline = probe(() => ({ status: 1, stderr: 'device offline' }));
  assert.throws(offline, (error) => error.failure.status === 1);
  const timedOut = probe(() => ({ status: null, error: { code: 'ETIMEDOUT' } }));
  assert.throws(timedOut, (error) => error.failure.timedOut === true);
});

test('Android report waiting grants startup five seconds before checking process liveness', async () => {
  const fixture = reportWaitFixture();
  const checks = [];
  const report = await fixture.wait(() => fixture.now() === 7000 ? fixture.report : null, 'create', 'import', undefined, () => {
    checks.push(fixture.now());
    return fixture.now() >= 5000;
  });
  assert.equal(report.status, 'passed');
  assert.deepEqual(checks, [5000, 6000]);
});

test('Android report waiting detects process exit after startup grace without consuming the deadline', async () => {
  const fixture = reportWaitFixture();
  await assert.rejects(fixture.wait(() => null, 'create', 'import', undefined, () => false), /process exited before report/);
  assert.equal(fixture.now(), 5000);
});

test('a final report written during process exit takes precedence over liveness failure', async () => {
  const fixture = reportWaitFixture();
  let written = false;
  const report = await fixture.wait(() => written ? fixture.report : null, 'create', 'import', undefined, () => {
    written = true;
    return false;
  });
  assert.equal(report.status, 'passed');
  assert.equal(fixture.now(), 5000);
});

test('report waiting keeps the five-minute deadline with or without Android liveness checks', async () => {
  for (const isRunning of [undefined, () => true]) {
    const fixture = reportWaitFixture();
    await assert.rejects(fixture.wait(() => null, 'create', 'import', undefined, isRunning), /timed out/);
    assert.equal(fixture.now(), 300000);
  }
});
