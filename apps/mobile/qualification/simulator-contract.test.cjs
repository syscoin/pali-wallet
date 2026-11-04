const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { Buffer } = require('node:buffer');
const test = require('node:test');
const {
  qualificationMode, assertSimulatorRefusal, assertSimulatorTarget,
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
  assert.doesNotThrow(() => assertSimulatorTarget('iphonesimulator', 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'));
  for (const [target, runtime] of [
    ['iphoneos', 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'],
    ['iphonesimulator', 'com.apple.CoreSimulator.SimRuntime.iOS-26-4'],
  ]) assert.throws(() => assertSimulatorTarget(target, runtime), /pinned Simulator/);
});

test('only complete native crypto plus a classified strict protection refusal qualifies as limited evidence', () => {
  assert.equal(TIMED_CRYPTO_CASES.length, 29);
  for (const stage of REFUSAL_STAGES) assert.doesNotThrow(() => assertSimulatorRefusal(refusal(stage)));
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
    (r) => { r.journalContainerVersion = 2; },
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
    assert.throws(() => assertSimulatorRefusal(report), /Unexpected iOS Simulator refusal/);
  }
});

async function runFixture({ limited = true, report = refusal(), target = 'iphonesimulator', mixedOutput = false } = {}) {
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const writes = [], calls = [];
  const original = JSON.stringify(report, null, 3) + '\n';
  const spawn = (command, args) => {
    calls.push({ command, args });
    const ok = (stdout = '') => ({ status: 0, stdout });
    if (command === 'plutil') return ok(args.includes('CFBundleIdentifier') ? 'com.paliwallet.qualification' :
      args.includes('DTPlatformName') ? target : 'PaliQualification');
    if (args.includes('runtimes')) return ok(JSON.stringify({ runtimes: [{ isAvailable: true,
      identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', version: '26.5' }] }));
    if (args.includes('devicetypes')) return ok(JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] }));
    if (args.includes('create')) return ok('public-device');
    if (args.includes('get_app_container')) return ok('/public-container');
    return ok();
  };
  const fakeProcess = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', QUALIFICATION_ARTIFACTS: '/public-output',
    GITHUB_SHA: 'a'.repeat(40), ImageVersion: 'public-image' },
  argv: ['node', 'runner', 'ios', '/public-app', ...(limited ? ['--ios-simulator-contract'] : [])], exitCode: 0 };
  await runInNewContext(source, {
    require(name) {
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
  return { writes, calls, fakeProcess, original };
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
