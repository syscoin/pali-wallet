const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { Buffer } = require('node:buffer');
const test = require('node:test');
const {
  qualificationMode, assertSimulatorRefusal, assertSimulatorTarget, selectSimulatorTarget,
  REFUSAL_STAGES, CHECKS, TIMED_CRYPTO_CASES,
} = require('./simulator-contract.cjs');

function refusal(stage = 'ios-policy-protection-none') {
  return {
    version: 1, status: 'failed', phase: 'create', scenario: 'import', platform: 'ios',
    osVersion: '26.5', sessionId: '182EBF83-98D5-4A1F-8AB3-7021E67FB593',
    checks: CHECKS.map((name) => ({ name, durationMs: 1 })), networkCalls: 0,
    failedStage: 'open SQLCipher and device key',
    cryptoEvidence: { passed: true, productionIterations: 900000,
      cases: TIMED_CRYPTO_CASES.map((name) => ({ name, milliseconds: 1 })) },
    nativeBridgeExercised: true,
    storageDiagnostic: { stage, code: 'STORAGE_UNAVAILABLE' },
    cryptoDiagnostic: { bootstrap: 'ready', fullCase: 'opaque-key-owner-and-disposal' },
  };
}

test('limited mode is explicit and restricted to the pinned iOS Simulator target', () => {
  assert.equal(qualificationMode('ios', []), 'full');
  assert.equal(qualificationMode('android', []), 'full');
  assert.equal(qualificationMode('ios', ['--ios-simulator-contract']), 'ios-simulator-contract');
  for (const [platform, args] of [
    ['android', ['--ios-simulator-contract']], ['ios', ['--unknown']],
    ['ios', ['--ios-simulator-contract', '--extra']],
  ]) assert.throws(() => qualificationMode(platform, args), /mode/);
  assert.doesNotThrow(() => assertSimulatorTarget('iphonesimulator', 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'));
  for (const [target, runtime] of [
    ['iphoneos', 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'],
    ['iphonesimulator', 'com.apple.CoreSimulator.SimRuntime.iOS-26-4'],
  ]) assert.throws(() => assertSimulatorTarget(target, runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'), /selected Simulator/);
});

test('only complete native crypto plus a classified strict protection refusal qualifies as limited evidence', () => {
  assert.equal(TIMED_CRYPTO_CASES.length, 29);
  for (const stage of REFUSAL_STAGES) assert.doesNotThrow(() => assertSimulatorRefusal(refusal(stage), '26.5'));
  const changes = [
    (r) => { r.status = 'passed'; },
    (r) => { r.scenario = 'generate'; },
    (r) => { r.phase = 'restart'; },
    (r) => { r.platform = 'android'; },
    (r) => { r.osVersion = '26.4'; },
    (r) => { r.networkCalls = 1; },
    (r) => { r.nativeBridgeExercised = false; },
    (r) => { r.failedStage = 'load software SDK'; },
    (r) => { r.address = 'unexpected wallet evidence'; },
    (r) => { r.nativeHdAccountsVerified = true; },
    (r) => { r.nativeHdKeyRevealVerified = true; },
    (r) => { r.journalContainerVersion = 1; },
    (r) => { r.nativeErc20Verified = true; },
    (r) => { r.erc20TransferHash = '0x' + 'd'.repeat(64); },
    (r) => { r.nativeNevmVerified = true; },
    (r) => { r.nevmTransferHash = '0x' + '7'.repeat(64); },
    (r) => { r.nativeZksysVerified = true; },
    (r) => { r.zksysTransferHash = '0x' + '9'.repeat(64); },
    (r) => { r.storageDiagnostic.stage = 'ios-policy-protection-unknown'; },
    (r) => { r.storageDiagnostic.stage = 'ios-policy-protection-read'; },
    (r) => { r.storageDiagnostic.stage = 'ios-policy-protection-check'; },
    (r) => { r.storageDiagnostic.code = 'STORAGE_KEY_MISSING'; },
    (r) => { r.storageDiagnostic.message = 'unexpected raw diagnostic'; },
    (r) => { r.checks.pop(); },
    (r) => { r.checks.reverse(); },
    (r) => { r.checks[0].durationMs = -1; },
    (r) => { r.checks[0].path = 'unexpected path'; },
    (r) => { r.cryptoEvidence.passed = false; },
    (r) => { r.cryptoEvidence.productionIterations = 20000; },
    (r) => { r.cryptoEvidence.cases.pop(); },
    (r) => { r.cryptoEvidence.cases[0].name = r.cryptoEvidence.cases[1].name; },
    (r) => { r.cryptoEvidence.cases[0].milliseconds = Infinity; },
    (r) => { r.cryptoEvidence.cases[0].raw = 'unexpected bytes'; },
    (r) => { r.cryptoEvidence.raw = 'unexpected bytes'; },
    (r) => { r.cryptoDiagnostic.bootstrap = 'provider-context'; },
    (r) => { r.cryptoDiagnostic.fullCase = 'startup-known-answers'; },
    (r) => { r.cryptoDiagnostic.extra = 'unexpected diagnostic'; },
    (r) => { delete r.cryptoEvidence; },
  ];
  for (const change of changes) {
    const report = refusal(); change(report);
    assert.throws(() => assertSimulatorRefusal(report, '26.5'), /Unexpected iOS Simulator refusal/);
  }
});

async function runFixture({ limited = true, report = refusal(), target = 'iphonesimulator', mixedOutput = false, http = false, httpFailure = false, cleanupFailure = false, diagnosticFailure = false } = {}) {
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const writes = [], calls = [];
  const original = JSON.stringify(report, null, 3) + '\n';
  let httpVerifications = 0, httpClosed = false;
  const httpEvents = [];
  const spawn = (command, args) => {
    calls.push({ command, args });
    const ok = (stdout = '') => ({ status: 0, stdout });
    if (command === 'plutil') return ok(args.includes('CFBundleIdentifier') ? 'com.paliwallet.qualification' :
      args.includes('DTPlatformName') ? target : 'PaliQualification');
    if (args.includes('runtimes')) return ok(JSON.stringify({ runtimes: [{ isAvailable: true,
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', version: '26.5' }] }));
    if (args.includes('devicetypes')) return ok(JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] }));
    if (args.includes('create')) return ok('11111111-2222-3333-4444-555555555555');
    if (args.includes('devices')) return ok(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
      { udid: '11111111-2222-3333-4444-555555555555', isAvailable: true, state: 'Booted' },
    ] } }));
    if (args.includes('launchctl')) return ok('12\t0\tcom.apple.SpringBoard\n');
    if (args.includes('get_app_container')) return ok('/public-container');
    return ok();
  };
  const fakeProcess = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', QUALIFICATION_ARTIFACTS: '/public-output',
    ...(http ? { PALI_NATIVE_HTTP_QUALIFICATION: '1' } : {}),
    GITHUB_SHA: 'a'.repeat(40), ImageVersion: 'public-image' },
  argv: ['node', 'runner', 'ios', '/public-app', ...(limited ? ['--ios-simulator-contract'] : [])], exitCode: 0 };
  await runInNewContext(source, {
    require(name) {
      if (name === './http-companion.cjs') return { startHttpCompanion: async () => ({
        begin: async () => `&httpPort=45454&httpToken=${'a'.repeat(32)}`,
        verify: async () => { if (httpFailure) throw Error('HTTP_QUALIFICATION_REPORT_INVALID'); httpVerifications++; return { nativeHttpQualified: true }; },
        assertComplete: (count) => assert.equal(httpVerifications, count),
        diagnostic: async () => {
          httpEvents.push('diagnostic');
          if (diagnosticFailure) throw Error('HTTP_DIAGNOSTIC_FAILED');
          return { version: 1, kind: 'native-http-diagnostic', status: 'failed', diagnosticOnly: true,
            failedCase: 'abort-stream', server: { counts: { body: 1 }, closed: { body: false } } };
        },
        close: async () => { httpEvents.push('close'); httpClosed = true; if (cleanupFailure) throw Error('HTTP_CLEANUP_FAILED'); },
      }) };
      if (name === 'fs') return {
        existsSync: (file) => file.endsWith('/ios-qualification.json') ? mixedOutput : true, mkdirSync() {},
        writeFileSync(file, data) { writes.push({ file, data }); },
        readFileSync(file) {
          if (file.endsWith('/PaliQualification')) return Buffer.from('public binary');
          if (file.endsWith('/pali-native-qualification-create.json')) return original;
          throw Error('fixture file absent');
        },
      };
      if (name === 'child_process') return { spawnSync: spawn };
      return require(name);
    },
    process: fakeProcess, console: { error() {}, log() {} }, setTimeout,
  });
  return { writes, calls, fakeProcess, original, httpVerifications, httpClosed, httpEvents };
}

test('real limited runner preserves the failed report and writes only a separate non-custody artifact', async () => {
  const fixture = await runFixture();
  assert.equal(fixture.fakeProcess.exitCode, 0);
  const original = fixture.writes.find((write) => write.file.endsWith('/ios-import-create.json'));
  assert.equal(original.data, fixture.original);
  assert.equal(JSON.parse(original.data).status, 'failed');
  const limited = JSON.parse(fixture.writes.find((write) => write.file.endsWith('/ios-simulator-limited.json')).data);
  assert.equal(limited.status, 'limited');
  assert.equal(limited.custodyQualified, false);
  assert.equal(limited.nativeCryptoVerified, true);
  assert.equal(limited.sdkSmokeVerified, false);
  assert.equal(limited.sourceRevision, 'a'.repeat(40));
  assert.equal(limited.originalReportFile, 'ios-import-create.json');
  assert.deepEqual(limited.storageRefusal, refusal().storageDiagnostic);
  assert.match(limited.appExecutableSha256, /^[0-9a-f]{64}$/);
  assert(!fixture.writes.some((write) => write.file.endsWith('/ios-qualification.json')));
  assert(!fixture.writes.some((write) => write.file.endsWith('/ios-failure.json')));
  assert.equal(fixture.calls.filter((call) => call.args.includes('launch')).length, 1);
  assert(fixture.calls.some((call) => call.args.includes('delete')));
});

test('default full runner rejects the identical storage refusal and retains its failed evidence', async () => {
  const fixture = await runFixture({ limited: false });
  assert.equal(fixture.fakeProcess.exitCode, 1);
  assert(fixture.writes.some((write) => write.file.endsWith('/ios-import-create.json')));
  assert(fixture.writes.some((write) => write.file.endsWith('/ios-failure.json')));
  assert(!fixture.writes.some((write) => write.file.endsWith('/ios-qualification.json') || write.file.endsWith('/ios-simulator-limited.json')));
});

test('limited runner fails on unknown protection, incomplete crypto or a physical-device target', async () => {
  const incomplete = refusal(); incomplete.cryptoEvidence.cases.pop();
  for (const options of [{ report: refusal('ios-policy-protection-unknown') }, { report: incomplete }, { target: 'iphoneos' }]) {
    const fixture = await runFixture(options);
    assert.equal(fixture.fakeProcess.exitCode, 1);
    assert(!fixture.writes.some((write) => write.file.endsWith('/ios-simulator-limited.json') || write.file.endsWith('/ios-qualification.json')));
  }
});

test('limited runner refuses an output directory already containing full custody evidence', async () => {
  await assert.rejects(runFixture({ mixedOutput: true }), /must not contain full custody evidence/);
});

test('HTTP-enabled limited runner requires its sidecar and still preserves the failed custody report', async () => {
  const fixture = await runFixture({ http: true });
  assert.equal(fixture.fakeProcess.exitCode, 0);
  assert.equal(fixture.httpVerifications, 1); assert.equal(fixture.httpClosed, true);
  const limited = JSON.parse(fixture.writes.find((write) => write.file.endsWith('/ios-simulator-limited.json')).data);
  assert.equal(limited.nativeHttpQualified, true); assert.equal(limited.custodyQualified, false);
  assert.equal(fixture.writes.find((write) => write.file.endsWith('/ios-import-create.json')).data, fixture.original);
});
test('missing HTTP proof or failed cleanup cannot produce a qualified limited aggregate', async () => {
  for (const options of [{ httpFailure: true }, { cleanupFailure: true }, { httpFailure: true, cleanupFailure: true }]) {
    const fixture = await runFixture({ http: true, ...options });
    assert.equal(fixture.fakeProcess.exitCode, 1); assert.equal(fixture.httpClosed, true);
    assert(!fixture.writes.some((write) => write.file.endsWith('/ios-simulator-limited.json')));
    if (options.httpFailure) {
      const failure = fixture.writes.find((write) => write.file.endsWith('/ios-failure.json')).data;
      assert(failure.includes('HTTP_QUALIFICATION_REPORT_INVALID'));
      assert(!failure.includes('HTTP_CLEANUP_FAILED'));
    }
  }
});
test('real runner records diagnostic-only HTTP evidence before cleanup without replacing its primary error', async () => {
  const fixture = await runFixture({ http: true, httpFailure: true, cleanupFailure: true });
  const diagnostic = JSON.parse(fixture.writes.find((write) => write.file.endsWith('/ios-http-diagnostic.json')).data);
  assert.equal(diagnostic.status, 'failed'); assert.equal(diagnostic.diagnosticOnly, true); assert.equal(diagnostic.failedCase, 'abort-stream');
  assert.equal(diagnostic.server.closed.body, false);
  assert.deepEqual(fixture.httpEvents, ['diagnostic', 'close']);
  const failure = fixture.writes.find((write) => write.file.endsWith('/ios-failure.json')).data;
  assert(failure.includes('HTTP_QUALIFICATION_REPORT_INVALID')); assert(!failure.includes('HTTP_CLEANUP_FAILED'));
  const unavailable = await runFixture({ http: true, httpFailure: true, cleanupFailure: true, diagnosticFailure: true });
  assert.equal(unavailable.fakeProcess.exitCode, 1);
  assert(unavailable.writes.find((write) => write.file.endsWith('/ios-failure.json')).data.includes('HTTP_QUALIFICATION_REPORT_INVALID'));
  assert(!unavailable.writes.some((write) => write.file.endsWith('/ios-simulator-limited.json')));
});


test('local Simulator selection uses an available current runtime while an explicit hosted pin fails closed', () => {
  const runtime = version => ({ isAvailable: true, version, identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace(/\./g, '-')}` });
  const types = [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }];
  assert.equal(selectSimulatorTarget([runtime('26.5'), runtime('27.2')], types).runtime.version, '27.2');
  assert.equal(selectSimulatorTarget([runtime('26.5'), runtime('27.2')], types, runtime('26.5').identifier).runtime.version, '26.5');
  assert.throws(() => selectSimulatorTarget([runtime('27.2')], types, runtime('26.5').identifier));
  assert.throws(() => selectSimulatorTarget([runtime('27.2'), runtime('27.2')], types));
  assert.throws(() => selectSimulatorTarget([runtime('27.2')], types, undefined, 'unknown'));
  const current = { ...refusal(), osVersion: '27.2' };
  assert.doesNotThrow(() => assertSimulatorRefusal(current, '27.2'));
  assert.throws(() => assertSimulatorRefusal(current, '26.5'));
  assert.throws(() => assertSimulatorRefusal(current));
});
