const { importedEvidence } = require('./imported-report-fixture.cjs');
const { matchesImportedRestartEvidence } = require('./imported-evm.ts');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { Buffer } = require('node:buffer');
const { expectedQualificationSdkVersion, expectedQuickCryptoIdentity } = require('./report-validation.cjs');
const { CHECKS } = require('./simulator-contract.cjs');
const cryptoCheckEvidence = () => ({ quickCryptoIdentity: expectedQuickCryptoIdentity, checks: CHECKS.map(name => ({ name, durationMs: 1 })) });
const { createCommandRunner, describeQualificationFailure, COLD_BOOT_TIMEOUT_MS } = require('./command-runner.cjs');
const { isErc20QualificationReport, matchesErc20RestartEvidence } = require('./erc20-transfer.ts');
const { matchesNevmRestartEvidence } = require('./nevm-transfer.ts');
const { matchesZksysRestartEvidence } = require('./zksys-transfer.ts');
const { matchesHdKeyRevealRestartEvidence } = require('./hd-key-reveal.ts');

const erc20Evidence = (phase = 'create') => ({
  nativeErc20Verified: true, erc20AccountId: 'hd:60:2', erc20AccountIndex: 2,
  erc20Address: '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
  erc20TransferHash: '0x' + 'd'.repeat(64), erc20IntentHash: '0x' + 'e'.repeat(64),
  erc20Signatures: phase === 'create' ? 1 : 0, erc20Authorizations: phase === 'restart' ? 1 : 0,
  erc20InjectedBroadcasts: 1, erc20RestoredFromJournal: phase === 'restart',
});
const nevmEvidence = (phase = 'create') => ({
  nativeNevmVerified: true, nevmAccountId: 'hd:60:3', nevmAccountIndex: 3,
  nevmAddress: '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E',
  nevmTransferHash: '0x' + '7'.repeat(64), nevmEthereumTransferHash: '0x' + '8'.repeat(64),
  nevmChainId: '5700', nevmJournalContainerVersion: 1,
  nevmRestoredFromJournal: phase === 'restart',
});
const zksysEvidence = (phase = 'create') => ({
  nativeZksysVerified: true, zksysAccountId: 'hd:60:4', zksysAccountIndex: 4,
  zksysAddress: '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA',
  zksysTransferHash: '0x' + '9'.repeat(64), zksysChainId: '57057', zksysJournalContainerVersion: 1,
  zksysSignatures: phase === 'create' ? 1 : 0, zksysAuthorizations: phase === 'create' ? 0 : 1,
  zksysInjectedBroadcasts: 1, zksysFeeEstimates: phase === 'create' ? 2 : 0,
  zksysRestoredFromJournal: phase === 'restart',
});

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
  assert.match(source, /\['simctl', 'bootstatus', device, '-b'\],\s*false,\s*COLD_BOOT_TIMEOUT_MS/);
  assert.equal((source.match(/false,\s*COLD_BOOT_TIMEOUT_MS/g) || []).length, 1);
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
    if (args.includes('create')) return ok('11111111-2222-3333-4444-555555555555');
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
  assert.deepEqual(report.failure.args, ['simctl', 'bootstatus', '11111111-2222-3333-4444-555555555555', '-b']);
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
    if (command.endsWith('/aapt') && args[0] === 'dump') return ok("package: name='com.paliwallet.qualification'\nlaunchable-activity: name='com.paliwallet.qualification.MainActivity'");
    if (command.endsWith('/aapt')) return ok([...['arm64-v8a', 'x86_64'].flatMap((abi) => ['libQuickCrypto.so', 'libNitroModules.so', 'libexpo-sqlite.so'].map((file) => `lib/${abi}/${file}`)), 'assets/index.android.bundle'].join('\n'));
    if (args[0] === 'shell' && args[1] === 'id') return ok('0');
    if (args.includes('screencap')) return ok(Buffer.from('public PNG fixture'));
    if (args.includes('cat')) {
      if (args.some((value) => value.endsWith('pali-native-qualification-startup.json'))) return { status: 1, stderr: 'not present' };
      if (args.some((value) => value.endsWith('pali-native-qualification-load-error.json'))) return { status: 1, stderr: 'not present' };
      if (args[0] === 'exec-out') return { status: null, stdout: Buffer.from('PRIVATE_DATABASE_BYTES'), error: Object.assign(Error('database read timeout'), { code: 'ETIMEDOUT' }) };
      return ok(JSON.stringify({ version: 1, status: 'passed', phase: 'create', scenario: 'import', platform: 'android', networkCalls: 0, nativeBridgeExercised: true, sdkVersion: expectedQualificationSdkVersion, ...cryptoCheckEvidence(), nativeSigningVerified: true, nativeHdAccountsVerified: true, nativeHdKeyRevealVerified: true, selectedAccountId: 'hd:60:1', selectedAccountIndex: 1, journalContainerVersion: 1, firstTransferHash: '0x' + 'c'.repeat(64), address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', transferHash: '0x' + 'b'.repeat(64), fingerprint: 'a'.repeat(64), cryptoEvidence: { passed: true, productionIterations: 900000 }, mnemonicEntropyVerified: false, storageDiagnostic: { stage: 'ready' }, ...erc20Evidence(), ...nevmEvidence(), ...zksysEvidence(), ...importedEvidence() }));
    }
    if (args.includes('pidof')) return ok(++pidReads === 1 ? '1234' : '');
    if (args.includes('logcat')) return diagnosticsAvailable ? ok('F/libc: SIGABRT libhermes.so synthetic_secret_token_42 PUBLIC native qualification password 2026!') : { status: 1, stderr: 'synthetic_secret_token_42' };
    if (args.includes('exit-info')) return diagnosticsAvailable ? ok('timestamp=public pid=1234\n process=com.paliwallet.qualification reason=5 (APP CRASH(NATIVE))\n description=synthetic_secret_token_42') : { status: 1, stderr: 'synthetic_secret_token_42' };
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
  assert.deepEqual(JSON.parse(runtime.data), { processRunning: false, logcatAvailable: diagnosticsAvailable, exitInfoAvailable: diagnosticsAvailable, crashLogAvailable: diagnosticsAvailable, processLogAvailable: diagnosticsAvailable, crashLogScoped: diagnosticsAvailable, codes: diagnosticsAvailable ? ['SIGABRT'] : [], modules: [], libraries: diagnosticsAvailable ? ['libhermes.so'] : [], exceptions: [], causes: [], frames: [], exitReasons: diagnosticsAvailable ? ['CRASH_NATIVE'] : [] });
  if (diagnosticsAvailable) {
    assert(calls.some((call) => call.args.includes('--pid') && call.args.includes('1234')));
    assert(writes.some((write) => write.file.endsWith('/android-import-fixture-crash.log')));
    assert(writes.some((write) => write.file.endsWith('/android-import-fixture-process.log')));
    assert(writes.filter((write) => write.file.endsWith('.log')).every((write) => !write.data.includes('PUBLIC native qualification password 2026!')));
  }
  const apk = writes.find((write) => write.file.endsWith('/android-apk-startup.json'));
  assert.deepEqual(JSON.parse(apk.data), { packageMatches: true, mainActivityMatches: true, mainBundlePresent: true });
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
  assert.deepEqual(calls.filter((call) => call.args[0] === 'wait-for-device' || call.args[0] === 'root' || call.args[1] === 'id').map((call) => call.options.timeout), [30000, 30000, 30000, 10000]);
  assert(calls.filter((call) => call.args[0] !== 'wait-for-device' && call.args[0] !== 'root' && call.args[1] !== 'id').every((call) => call.options.timeout === 180000));
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
    if (args.includes('create')) return ok('11111111-2222-3333-4444-555555555555');
    if (args.includes('devices')) return ok(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
      { udid: '11111111-2222-3333-4444-555555555555', isAvailable: true, state: 'Booted' },
    ] } }));
    if (args.includes('launchctl')) return ok('12\t0\tcom.apple.SpringBoard\n');
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
  assert.deepEqual(Array.from(calls.find((call) => call.args.includes('launch')).args), ['simctl', 'launch', '11111111-2222-3333-4444-555555555555', 'com.paliwallet.qualification', '-PaliQualificationURL', 'pali-wallet-qualification://run?phase=create&scenario=import']);
  assert(!calls.some((call) => call.args.includes('openurl')));
});

function reportWaitFixture() {
  const { runInNewContext } = require('node:vm');
  const { isCryptoDiagnostic } = require('../src/crypto/diagnostics.ts');
  const { isHdQualificationReport } = require('./hd-accounts.ts');
  const { isStorageQualificationDiagnostic } = require('./storage-diagnostics.ts');
  const { decodeNativeReport, assertFullNativeReport } = require('./report-validation.cjs');
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const start = source.indexOf('const validateReport =');
  const end = source.indexOf('const databaseEvidence =', start);
  let now = 0;
  const saved = [];
  const { waitReport: wait, validateReport: validate } = runInNewContext(source.slice(start, end) + '\n({ waitReport, validateReport });', {
    decodeNativeReport, assertFullNativeReport, simulatorVersion: undefined,
    isHdQualificationReport, isErc20QualificationReport, isCryptoDiagnostic, isStorageQualificationDiagnostic, simulatorContract: false, PUBLIC_PHRASE: 'public fixture', PUBLIC_PASSWORD: 'public password', platform: 'android',
    fs: { writeFileSync(_file, text) { saved.push(JSON.parse(text)); } }, path: { join: () => 'unused' }, output: 'unused',
    Date: { now: () => now }, sleep: async (milliseconds) => { now += milliseconds; },
  });
  const report = JSON.stringify({ version: 1, status: 'passed', phase: 'create', scenario: 'import', platform: 'android',
    networkCalls: 0, nativeBridgeExercised: true, sdkVersion: expectedQualificationSdkVersion, ...cryptoCheckEvidence(), nativeSigningVerified: true, nativeHdAccountsVerified: true, nativeHdKeyRevealVerified: true, selectedAccountId: 'hd:60:1', selectedAccountIndex: 1, journalContainerVersion: 1, firstTransferHash: '0x' + 'c'.repeat(64), address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', transferHash: '0x' + 'b'.repeat(64), mnemonicEntropyVerified: false,
    fingerprint: 'a'.repeat(64), cryptoEvidence: { passed: true, productionIterations: 900000 }, storageDiagnostic: { stage: 'ready' }, ...erc20Evidence(), ...nevmEvidence(), ...zksysEvidence(), ...importedEvidence() });
  return { wait, validate, saved, report, now: () => now };
}

test('the actual report parser preserves producer storage evidence and rejects unknown or inconsistent payloads before writing', () => {
  const { createStorageQualificationDiagnostic } = require('./storage-diagnostics.ts');
  const { WalletStorageError } = require('../src/storage/types.ts');
  const fixture = reportWaitFixture();
  const ready = createStorageQualificationDiagnostic();
  ready.observe('ready');
  const passed = { ...JSON.parse(fixture.report), storageDiagnostic: ready.report(), sdkVersion: expectedQualificationSdkVersion,
    osVersion: '26.5', sessionId: 'public-session', address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', ...cryptoCheckEvidence() };
  assert.equal(fixture.validate(JSON.stringify(passed), 'create', 'import').status, 'passed');
  const unqualifiedSdk = { ...passed, sdkVersion: `${expectedQualificationSdkVersion}-unqualified` };
  assert.throws(() => fixture.validate(JSON.stringify(unqualifiedSdk), 'create', 'import'), /Native qualification failed/);
  const stockCrypto = { ...passed, sdkVersion: expectedQualificationSdkVersion.split('.quickcrypto.')[0] };
  assert.throws(() => fixture.validate(JSON.stringify(stockCrypto), 'create', 'import'), /Native qualification failed/);
  for (const change of [
    value => { delete value.quickCryptoIdentity; },
    value => { value.quickCryptoIdentity = `${expectedQuickCryptoIdentity}-unreviewed`; },
    value => { value.checks.pop(); },
    value => { value.checks.splice(-2, 1); },
    value => { value.checks.at(-1).durationMs = -1; },
  ]) {
    const candidate = structuredClone(passed);
    change(candidate);
    assert.throws(() => fixture.validate(JSON.stringify(candidate), 'create', 'import'), /Native qualification failed/);
  }
  const failed = createStorageQualificationDiagnostic();
  failed.observe('sqlcipher-journal-readback');
  failed.capture(new WalletStorageError('STORAGE_UNAVAILABLE'));
  const failure = { ...passed, status: 'failed', failedStage: 'open SQLCipher and device key', storageDiagnostic: failed.report() };
  for (const key of ['nativeHdAccountsVerified', 'nativeHdKeyRevealVerified', 'selectedAccountId', 'selectedAccountIndex', 'journalContainerVersion', 'firstTransferHash', ...Object.keys(erc20Evidence()), ...Object.keys(nevmEvidence()), ...Object.keys(zksysEvidence()), ...Object.keys(importedEvidence())]) delete failure[key];
  assert.throws(() => fixture.validate(JSON.stringify(failure), 'create', 'import'), /sqlcipher-journal-readback/);
  assert.deepEqual(fixture.saved.at(-1).storageDiagnostic, failed.report());
  const beforeOpen = { ...failure, failedStage: 'native crypto bridge and full vectors', storageDiagnostic: {} };
  assert.throws(() => fixture.validate(JSON.stringify(beforeOpen), 'create', 'import'), /Native qualification failed/);
  const afterOpen = { ...failure, failedStage: 'load software SDK', storageDiagnostic: ready.report() };
  assert.throws(() => fixture.validate(JSON.stringify(afterOpen), 'create', 'import'), /Native qualification failed/);
  for (const candidate of [
    { ...passed, storageDiagnostic: undefined },
    { ...passed, storageDiagnostic: { stage: 'key-read' } },
    { ...passed, storageDiagnostic: { stage: 'ready', code: 'STORAGE_UNAVAILABLE' } },
    { ...failure, storageDiagnostic: { stage: 'SECRET path', code: 'STORAGE_UNAVAILABLE' } },
    { ...failure, storageDiagnostic: { stage: 'key-read', code: 'SECRET code' } },
    { ...failure, storageDiagnostic: { stage: 'key-read', message: 'SECRET error' } },
    { ...failure, storageDiagnostic: { stage: 'ready' } },
    { ...failure, storageDiagnostic: {} },
    { ...afterOpen, storageDiagnostic: failed.report() },
  ]) {
    const count = fixture.saved.length;
    assert.throws(() => fixture.validate(JSON.stringify(candidate), 'create', 'import'), /Unexpected qualification report schema/);
    assert.equal(fixture.saved.length, count);
  }
});

test('the actual report parser requires complete ERC20 evidence before accepting full custody', () => {
  const fixture = reportWaitFixture();
  const passed = JSON.parse(fixture.report);
  assert.equal(fixture.validate(JSON.stringify(passed), 'create', 'import').nativeErc20Verified, true);
  for (const key of Object.keys(erc20Evidence())) {
    const missing = { ...passed }; delete missing[key];
    const before = fixture.saved.length;
    assert.throws(() => fixture.validate(JSON.stringify(missing), 'create', 'import'), /Unexpected qualification report schema/);
    assert.equal(fixture.saved.length, before);
  }
  for (const mutation of [
    { nativeErc20Verified: false }, { erc20AccountId: 'hd:60:1' }, { erc20AccountIndex: 1 },
    { erc20Address: passed.address }, { erc20Address: 'invalid' },
    { erc20TransferHash: passed.transferHash }, { erc20TransferHash: passed.firstTransferHash },
    { erc20TransferHash: '0x123' }, { erc20IntentHash: 'invalid' },
    { erc20Signatures: 0 }, { erc20Authorizations: 1 },
    { erc20InjectedBroadcasts: 0 }, { erc20InjectedBroadcasts: 2 },
    { erc20RestoredFromJournal: true }, { networkCalls: 1 },
  ]) {
    const before = fixture.saved.length;
    assert.throws(() => fixture.validate(JSON.stringify({ ...passed, ...mutation }), 'create', 'import'));
    assert.equal(fixture.saved.length, before);
  }
  const oldReport = { ...passed };
  for (const key of Object.keys(erc20Evidence())) delete oldReport[key];
  assert.throws(() => fixture.validate(JSON.stringify(oldReport), 'create', 'import'), /Unexpected qualification report schema/);
});

test('ERC20 cold restart requires the same account, fingerprint, intent and transaction with no new signature', () => {
  const created = JSON.parse(reportWaitFixture().report);
  const restored = { ...created, phase: 'restart', ...erc20Evidence('restart') };
  assert.equal(matchesErc20RestartEvidence(created, restored), true);
  for (const mutation of [
    { erc20Address: '0x1111111111111111111111111111111111111111' },
    { fingerprint: 'f'.repeat(64) }, { erc20TransferHash: '0x' + 'f'.repeat(64) },
    { erc20IntentHash: '0x' + 'f'.repeat(64) }, { phase: 'create' },
    { scenario: 'generate' }, { erc20Signatures: 1 }, { erc20Authorizations: 0 },
    { erc20RestoredFromJournal: false }, { status: 'failed' },
  ]) assert.equal(matchesErc20RestartEvidence(created, { ...restored, ...mutation }), false);
  assert.equal(matchesErc20RestartEvidence({}, {}), false);
  assert.equal(matchesErc20RestartEvidence({ status: 'failed' }, { status: 'failed' }), false);
});

test('full custody reports require chain-scoped NEVM evidence and omit it on failure', () => {
  const fixture = reportWaitFixture();
  const passed = JSON.parse(fixture.report);
  assert.equal(fixture.validate(JSON.stringify(passed), 'create', 'import').nativeNevmVerified, true);
  for (const key of Object.keys(nevmEvidence())) {
    const missing = { ...passed }; delete missing[key];
    const before = fixture.saved.length;
    assert.throws(() => fixture.validate(JSON.stringify(missing), 'create', 'import'), /Unexpected qualification report schema/);
    assert.equal(fixture.saved.length, before);
  }
  for (const mutation of [
    { nativeNevmVerified: false }, { nevmAccountId: 'hd:60:2' }, { nevmAccountIndex: 2 },
    { nevmAddress: passed.address }, { nevmAddress: passed.erc20Address }, { nevmAddress: 'invalid' },
    { nevmTransferHash: passed.transferHash }, { nevmTransferHash: passed.firstTransferHash },
    { nevmTransferHash: passed.erc20TransferHash }, { nevmTransferHash: passed.nevmEthereumTransferHash },
    { nevmEthereumTransferHash: passed.transferHash }, { nevmEthereumTransferHash: '0x123' },
    { nevmChainId: '1' }, { nevmChainId: 5700 }, { nevmJournalContainerVersion: 2 },
    { nevmRestoredFromJournal: true },
  ]) assert.throws(() => fixture.validate(JSON.stringify({ ...passed, ...mutation }), 'create', 'import'));
  const failed = {
    version: 1, status: 'failed', phase: 'create', scenario: 'import', platform: 'android',
    failedStage: 'parameters', storageDiagnostic: {}, ...nevmEvidence(),
  };
  assert.throws(() => fixture.validate(JSON.stringify(failed), 'create', 'import'), /Unexpected qualification report schema/);
});

test('NEVM restart matches both chains and cannot reuse old Ethereum-only evidence', () => {
  const created = JSON.parse(reportWaitFixture().report);
  const restored = { ...created, phase: 'restart', ...erc20Evidence('restart'), ...nevmEvidence('restart') };
  assert.equal(matchesNevmRestartEvidence(created, restored), true);
  for (const mutation of [
    { nevmTransferHash: '0x' + 'f'.repeat(64) }, { nevmEthereumTransferHash: '0x' + 'f'.repeat(64) },
    { nevmAddress: '0x' + '11'.repeat(20) }, { fingerprint: 'f'.repeat(64) },
    { phase: 'create' }, { scenario: 'generate' }, { nevmRestoredFromJournal: false },
  ]) assert.equal(matchesNevmRestartEvidence(created, { ...restored, ...mutation }), false);
  assert.equal(matchesNevmRestartEvidence({}, {}), false);
});

test('full custody reports require zkSYS controller, exact-fee and restart counters', () => {
  const fixture = reportWaitFixture();
  const passed = JSON.parse(fixture.report);
  assert.equal(fixture.validate(JSON.stringify(passed), 'create', 'import').nativeZksysVerified, true);
  for (const key of Object.keys(zksysEvidence())) {
    const missing = { ...passed }; delete missing[key];
    assert.throws(() => fixture.validate(JSON.stringify(missing), 'create', 'import'), /Unexpected qualification report schema/);
  }
  for (const mutation of [
    { zksysAccountId: 'hd:60:3' }, { zksysAccountIndex: 3 }, { zksysAddress: passed.nevmAddress },
    { zksysTransferHash: passed.nevmTransferHash }, { zksysTransferHash: passed.nevmEthereumTransferHash },
    { zksysChainId: 57057 }, { zksysChainId: '5700' }, { zksysJournalContainerVersion: 2 },
    { zksysSignatures: 0 }, { zksysAuthorizations: 1 }, { zksysInjectedBroadcasts: 0 },
    { zksysFeeEstimates: 1 }, { zksysRestoredFromJournal: true },
  ]) assert.throws(() => fixture.validate(JSON.stringify({ ...passed, ...mutation }), 'create', 'import'));
  const restored = { ...passed, phase: 'restart', ...erc20Evidence('restart'), ...nevmEvidence('restart'), ...zksysEvidence('restart'), ...importedEvidence('restart') };
  assert(matchesZksysRestartEvidence(passed, restored));
  for (const mutation of [
    { zksysTransferHash: '0x' + 'f'.repeat(64) }, { zksysFeeEstimates: 2 },
    { zksysSignatures: 1 }, { zksysAuthorizations: 0 }, { fingerprint: 'f'.repeat(64) },
  ]) assert.equal(matchesZksysRestartEvidence(passed, { ...restored, ...mutation }), false);
  assert.equal(matchesZksysRestartEvidence({}, {}), false);
});

test('full custody reports require secret-free HD key reveal proof on both launches', () => {
  const fixture = reportWaitFixture();
  const created = JSON.parse(fixture.report);
  const restored = { ...created, phase: 'restart', ...erc20Evidence('restart'), ...nevmEvidence('restart'), ...zksysEvidence('restart'), ...importedEvidence('restart') };
  for (const report of [created, restored]) {
    assert.equal(fixture.validate(JSON.stringify(report), report.phase, 'import').nativeHdKeyRevealVerified, true);
    const missing = { ...report }; delete missing.nativeHdKeyRevealVerified;
    for (const changed of [missing, ...[false, 1, 'true', null, {}].map((value) => ({ ...report, nativeHdKeyRevealVerified: value })),
      { ...report, privateKey: 'forbidden' }, { ...report, keyHash: 'forbidden' }])
      assert.throws(() => fixture.validate(JSON.stringify(changed), report.phase, 'import'));
  }
  assert(matchesHdKeyRevealRestartEvidence(created, restored));
  assert.equal(matchesHdKeyRevealRestartEvidence(created, { ...restored, nativeHdKeyRevealVerified: false }), false);
});

test('the actual Android runner requires ERC20 and NEVM restart evidence in addition to existing HD evidence', async () => {
  const { runInNewContext } = require('node:vm');
  const { matchesHdRestartEvidence } = require('./hd-accounts.ts');
  const diagnostics = require('./log-diagnostics.cjs');
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const start = source.indexOf('async function android()');
  const end = source.indexOf('\n(async () => {', start);
  assert(start >= 0 && end > start);
  const exercise = async (change = {}) => {
    let phase = 'stopped';
    const calls = [];
    const run = (_command, args) => {
      calls.push(args);
      if (args[0] === 'dump') return "package: name='com.paliwallet.qualification'\nlaunchable-activity: name='com.paliwallet.qualification.MainActivity'";
      if (args[0] === 'list') return [...['arm64-v8a', 'x86_64'].flatMap((abi) => ['libQuickCrypto.so', 'libNitroModules.so', 'libexpo-sqlite.so'].map((file) => `lib/${abi}/${file}`)), 'assets/index.android.bundle'].join('\n');
      if (args.includes('start')) phase = args[args.indexOf('-d') + 1].includes('phase=restart') ? 'restart' : 'create';
      if (args.includes('force-stop')) phase = 'stopped';
      if (args.includes('pidof')) return phase === 'stopped' ? '' : phase === 'create' ? '100' : '101';
      if (args[0] === 'shell' && args[1] === 'id') return '0';
      if (args.includes('getprop')) return '35';
      return '';
    };
    run.binary = () => Buffer.alloc(4096, 0x61);
    const base = JSON.parse(reportWaitFixture().report);
    const created = { ...base, sessionId: 'create-session' };
    const restored = { ...base, phase: 'restart', ...erc20Evidence('restart'), ...nevmEvidence('restart'), ...zksysEvidence('restart'), ...importedEvidence('restart'), sessionId: 'restart-session', ...change };
    // The mismatch used below deliberately passes the pre-existing HD check.
    assert.equal(matchesHdRestartEvidence(created, restored), true);
    const android = runInNewContext(source.slice(start, end) + '\nandroid;', {
      process: { env: { ANDROID_HOME: '/public-sdk' } },
      httpEnabled: false, httpCompanion: undefined,
      publicPoolBuild: undefined,
      privateProofBuild: undefined,
      httpRead: undefined, captureHttpDiagnostic: async () => undefined,
      fs: { readdirSync: () => ['35.0.0'], writeFileSync() {}, readFileSync: () => Buffer.from('public APK fixture') },
      prepareAndroidRoot: require('./native-readiness.cjs').prepareAndroidRoot,
      path: require('node:path'), run, platform: 'android', PACKAGE: 'com.paliwallet.qualification', artifact: '/public.apk', output: '/public-output',
      waitReport: async (_read, requestedPhase, scenario) => ({ ...(requestedPhase === 'create' ? created : restored), scenario }),
      androidProcessRunning: () => true,
      databaseEvidence: (bytes) => { assert.equal(bytes.length, 4096); return { plaintextHeader: false }; },
      matchesHdRestartEvidence, matchesErc20RestartEvidence, matchesNevmRestartEvidence, matchesZksysRestartEvidence, matchesHdKeyRevealRestartEvidence, matchesImportedRestartEvidence,
      captureFixtureLoadError: () => false, redact: (text) => text,
      latestAndroidExitPid: diagnostics.latestAndroidExitPid,
      summarizeAndroidLog: diagnostics.summarizeAndroidLog,
      summarizeAndroidExitInfo: diagnostics.summarizeAndroidExitInfo,
      hash: (bytes) => require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
    });
    return android();
  };
  const result = await exercise();
  assert.equal(result.reports.length, 2);
  assert(result.reports.every((report) => report.hdAccountsRestored && report.signedTransferRestored && report.erc20TransferRestored && report.nevmTransferRestored && report.zksysTransferRestored));
  await assert.rejects(exercise({ erc20TransferHash: '0x' + 'f'.repeat(64) }), /Cold restart identity/);
  await assert.rejects(exercise({ nevmTransferHash: '0x' + 'f'.repeat(64) }), /Cold restart identity/);
  await assert.rejects(exercise({ nevmEthereumTransferHash: '0x' + 'f'.repeat(64) }), /Cold restart identity/);
  await assert.rejects(exercise({ zksysTransferHash: '0x' + 'f'.repeat(64) }), /Cold restart identity/);
  await assert.rejects(exercise({ zksysSignatures: 1 }), /Cold restart identity/);
});

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

test('raw load evidence copies only bounded public-import error envelopes and redacts fixture credentials', () => {
  const { runInNewContext } = require('node:vm');
  const { isCryptoDiagnostic } = require('../src/crypto/diagnostics.ts');
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const start = source.indexOf('const captureFixtureLoadError =');
  const end = source.indexOf('const waitReport =', start);
  const writes = [];
  let failWrite = false;
  const capture = runInNewContext(source.slice(start, end) + '\ncaptureFixtureLoadError;', {
    Buffer, isCryptoDiagnostic, platform: 'ios', output: '/public', path: require('node:path'),
    redact: (value) => value.replaceAll('PUBLIC_PASSWORD', '[redacted]'),
    fs: { writeFileSync(file, text) { if (failWrite) throw Error('write failed'); writes.push({ file, text }); } },
  });
  const valid = JSON.stringify({ version: 1, stage: 'quick-crypto-load', error: { name: 'Error', message: 'PUBLIC_PASSWORD', stack: 'public stack' } });
  assert.equal(capture(valid, 'import'), true);
  assert.equal(writes[0].file, '/public/ios-import-fixture-load-error.json');
  assert(!writes[0].text.includes('PUBLIC_PASSWORD'));
  const sdk = valid.replace('quick-crypto-load', 'software-sdk-load');
  assert.equal(capture(sdk, 'import', 'software-sdk-load'), true);
  assert.equal(writes[1].file, '/public/ios-import-fixture-sdk-load-error.json');
  assert(!writes[1].text.includes('PUBLIC_PASSWORD'));
  assert.equal(capture(sdk, 'import'), false);
  assert.equal(capture(valid, 'import', 'software-sdk-load'), false);
  assert.equal(capture(sdk, 'generate', 'software-sdk-load'), false);
  assert.equal(capture(sdk, 'import', 'wallet'), false);
  for (const [text, scenario] of [[valid, 'generate'], ['x'.repeat(65537), 'import'], ['broken', 'import'], [JSON.stringify({ version: 1, stage: 'wallet', error: {} }), 'import']])
    assert.equal(capture(text, scenario), false);
  failWrite = true;
  assert.equal(capture(valid, 'import'), false);
  assert.equal(writes.length, 2);
});

test('runner requires imported account evidence and binds every restarted chain hash', () => {
  const fixture = reportWaitFixture();
  const created = JSON.parse(fixture.report);
  assert.equal(fixture.validate(JSON.stringify(created), 'create', 'import').nativeImportedVerified, true);
  for (const key of Object.keys(importedEvidence())) {
    const missing = { ...created }; delete missing[key];
    assert.throws(() => fixture.validate(JSON.stringify(missing), 'create', 'import'));
  }
  for (const change of [{ nativeImportedVerified: false }, { importedAccountId: 'hd:60:1' },
    { importedChainIds: ['1', '57057', '5700'] }, { importedTransferHashes: [] }, { importedKeyRevealVerified: false },
    { importedSignatures: 0 }, { importedAuthorizations: 1 }])
    assert.throws(() => fixture.validate(JSON.stringify({ ...created, ...change }), 'create', 'import'));
  const restored = { ...created, phase: 'restart', ...importedEvidence('restart') };
  assert(matchesImportedRestartEvidence(created, restored));
  assert.equal(matchesImportedRestartEvidence(created, { ...restored, importedTransferHashes: ['0x' + 'f'.repeat(64), ...restored.importedTransferHashes.slice(1)] }), false);
  assert.equal(matchesImportedRestartEvidence({ status: 'failed', phase: 'create' }, { status: 'failed', phase: 'restart' }), false);
});

test('WalletConnect failure diagnostics remain bounded and cannot turn a failure into a pass', () => {
  const { decodeNativeReport, assertFullNativeReport } = require('./report-validation.cjs');
  const report = { version: 1, status: 'failed', phase: 'create', scenario: 'import', platform: 'android',
    osVersion: '35', sessionId: 'public-fixture', checks: [], networkCalls: 0,
    failedStage: 'native WalletConnect lifecycle', storageDiagnostic: {},
    walletConnectDiagnostic: { substage: 'pair', errorName: 'Error', errorCode: 'CONNECTION_UNAVAILABLE',
      counts: { opened: 1, closed: 0, pending: 0, pendingClosed: 0, frames: 1, invalid: 0 } } };
  const parsed = decodeNativeReport(JSON.stringify(report), 'android', 'create', 'import');
  assert.deepEqual(parsed.walletConnectDiagnostic, report.walletConnectDiagnostic);
  assert.throws(() => assertFullNativeReport(parsed), /walletConnect.*CONNECTION_UNAVAILABLE/);
  for (const change of [
    { status: 'passed' }, { failedStage: 'native POST transport' },
    { walletConnectDiagnostic: { ...report.walletConnectDiagnostic, message: 'PRIVATE_PAIRING_KEY' } },
    { walletConnectDiagnostic: { ...report.walletConnectDiagnostic, substage: 'PRIVATE_URI' } },
    { walletConnectDiagnostic: { ...report.walletConnectDiagnostic, errorCode: 'PRIVATE_CODE' } },
    { walletConnectDiagnostic: { ...report.walletConnectDiagnostic, counts: { ...report.walletConnectDiagnostic.counts, invalid: Infinity } } },
  ]) assert.throws(() => decodeNativeReport(JSON.stringify({ ...report, ...change }), 'android', 'create', 'import'), /schema/);
  const withoutDiagnostic = { ...report };
  delete withoutDiagnostic.walletConnectDiagnostic;
  assert.equal(decodeNativeReport(JSON.stringify(withoutDiagnostic), 'android', 'create', 'import').status, 'failed');
});
