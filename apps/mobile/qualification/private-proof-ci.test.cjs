const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const test = require('node:test');
const { parsePrivateProofReport, PRIVATE_PROOF_CASES } = require('./private-proof-contract.ts');
const { readPrivateProofCiBuild, runPrivateProofQualification } = require('./private-proof-ci.cjs');
const { readHttpSidecar } = require('./post-sidecar.cjs');
const { SENTRY_ISOLATED_CHECK } = require('./native-sentry-isolated.ts');

const expected = { sourceRevision: 'a'.repeat(40), lockfileSha256: crypto.createHash('sha256').update('{}').digest('hex'),
  sdkVersion: '3.9.7', sdkPackageVersion: '3.9.7', platform: 'ios', token: 'b'.repeat(32) };
const report = () => ({ version: 1, ...expected, kind: 'native-private-proof', status: 'passed',
  sessionId: '11111111-2222-4333-8444-555555555555', jsNetworkCalls: 0, nativeNetworkObservation: 'unmeasured', sentryQualified: true,
  result: { version: 1, provingKeySha256: '8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af',
    cases: PRIVATE_PROOF_CASES.map((name, index) => ({ name, outcome: index === 1 ? 'cancelled' : 'verified', durationMs: 100,
      rejectedPublicSignalMutations: index === 1 ? 0 : 6,
      stages: index === 1 ? ['artifacts', 'witness', 'proving'] : ['artifacts', 'witness', 'proving', 'verifying'] })) } });

test('proof report admits only exact current identity and complete ordered proof/cancel/proof evidence', () => {
  assert.deepEqual(parsePrivateProofReport(JSON.stringify(report()), expected), report());
  const changes = [
    value => { value.token = 'c'.repeat(32); }, value => { value.sourceRevision = 'd'.repeat(40); },
    value => { value.sdkVersion = 'other'; }, value => { value.lockfileSha256 = 'e'.repeat(64); },
    value => { value.status = 'failed'; }, value => { value.sessionId = ''; },
    value => { delete value.sentryQualified; }, value => { value.sentryQualified = false; },
    value => { value.extra = 'private'; }, value => { value.result.extra = true; },
    value => { value.result.cases.pop(); }, value => { value.result.cases.push(value.result.cases[0]); },
    value => { value.result.cases.reverse(); }, value => { value.result.cases[1].outcome = 'verified'; },
    value => { value.result.cases[0].rejectedPublicSignalMutations = 5; },
    value => { value.result.cases[1].stages.push('verifying'); },
    value => { value.result.cases[0].durationMs = 125001; },
    value => { value.nativeNetworkObservation = 'qualified'; }, value => { value.jsNetworkCalls = 1; },
  ];
  for (const change of changes) {
    const value = report(); change(value);
    assert.throws(() => parsePrivateProofReport(JSON.stringify(value), expected), /PRIVATE_PROOF_REPORT_INVALID/);
  }
  assert.throws(() => parsePrivateProofReport(' '.repeat(8193), expected));
  assert.throws(() => parsePrivateProofReport('{', expected));
});

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-proof-ci-build-'));
  const build = { version: 1, sourceRevision: expected.sourceRevision, lockfileSha256: expected.lockfileSha256 };
  fs.mkdirSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: '3.9.7' }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: 'qualification/index.tsx', dependencies: { '@sidhujag/sysweb3-keyring': '3.9.7' } }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  const receipt = { identifier: 'com.paliwallet.qualification', qualificationEntry: 'qualification/index.tsx', keyringVersion: '3.9.7', privateProof: build };
  fs.writeFileSync(path.join(root, '.native-qualification.json'), JSON.stringify(receipt));
  fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: {
    ios: { bundleIdentifier: receipt.identifier }, android: { package: receipt.identifier },
    extra: { paliPrivateProofQualification: build, paliQualificationSdkVersion: '3.9.7', paliQualificationSdkIdentity: '3.9.7' },
  } }));
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION: '1',
    PALI_NATIVE_HTTP_QUALIFICATION: '0', PALI_NATIVE_PUBLIC_POOL_QUALIFICATION: '0', GITHUB_SHA: expected.sourceRevision };
  return { root, env, receipt, build };
}

test('host build admission checks flags, checkout, lock and installed SDK before launching', () => {
  const fixture = buildFixture();
  try {
    const run = (command, args) => { assert.equal(command, 'git'); assert.deepEqual(args, ['rev-parse', 'HEAD']); return expected.sourceRevision; };
    assert.deepEqual(readPrivateProofCiBuild(fixture.env, fixture.root, run), { ...fixture.build, sdkVersion: '3.9.7', sdkPackageVersion: '3.9.7' });
    for (const [name, value] of [['CI', 'false'], ['GITHUB_ACTIONS', undefined], ['PALI_NATIVE_HTTP_QUALIFICATION', '1'],
      ['PALI_NATIVE_PUBLIC_POOL_QUALIFICATION', '1'], ['PALI_PHYSICAL_QUALIFICATION', 'import']])
      assert.throws(() => readPrivateProofCiBuild({ ...fixture.env, [name]: value }, fixture.root, run), /HOSTED_ISOLATION/);
    assert.throws(() => readPrivateProofCiBuild(fixture.env, fixture.root, () => 'f'.repeat(40)), /BUILD_MISMATCH/);
    fs.writeFileSync(path.join(fixture.root, 'package-lock.json'), 'changed');
    assert.throws(() => readPrivateProofCiBuild(fixture.env, fixture.root, run), /BUILD_MISMATCH/);
    fs.writeFileSync(path.join(fixture.root, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(fixture.root, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: '3.9.6' }));
    assert.throws(() => readPrivateProofCiBuild(fixture.env, fixture.root, run), /exact manifest version/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('runner uses a fresh token, waits for atomic output and persists only validated evidence', async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-proof-ci-report-'));
  let time = 0, name, launched = false;
  try {
    const { platform, token, ...config } = expected;
    const answer = await runPrivateProofQualification({ platform, config, output,
      randomBytes: count => { assert.equal(count, 16); return Buffer.from(token, 'hex'); },
      launch: async uri => { assert.equal(uri, `pali-wallet-qualification://run?phase=create&scenario=import&proofToken=${token}`); launched = true; name = `pali-native-private-proof-${token}.json`; },
      list: () => !launched ? [] : time === 0 ? [name + '.tmp'] : [name],
      read: requested => { assert.equal(requested, name); return JSON.stringify(report()); },
      readFailure: () => { throw Error('A valid proof must not read a failure report'); },
      now: () => time, pause: async ms => { assert.equal(ms, 1000); time += ms; },
    });
    assert.deepEqual(answer, report());
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'ios-private-proof-app.json'))), report());
    assert(!fs.existsSync(path.join(output, 'ios-private-proof-app.json.tmp')));
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('runner refuses stale, extra, malformed and missing results without launching replacements', async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-proof-ci-reject-'));
  const { platform, token, ...config } = expected;
  const name = `pali-native-private-proof-${token}.json`;
  try {
    for (const kind of ['stale', 'extra', 'malformed', 'missing']) {
      let time = 0, launched = false;
      const task = runPrivateProofQualification({ platform, config, output, randomBytes: () => Buffer.from(token, 'hex'),
        launch: () => { launched = true; }, now: () => time, pause: async ms => { time += ms; },
        list: () => kind === 'stale' ? [name] : !launched || kind === 'missing' ? [] : kind === 'extra' ? [name, 'pali-native-qualification-create.json'] : [name],
        read: () => '{',
        readFailure: () => '{',
      });
      await assert.rejects(task);
      assert.equal(launched, kind !== 'stale');
      if (kind === 'missing') assert.equal(time, 400000);
      assert(!fs.existsSync(path.join(output, 'ios-private-proof-app.json')));
    }
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

const appFailure = (platform, phase = 'create') => ({ version: 1, status: 'failed', phase: phase === 'startup' ? 'unknown' : 'create', scenario: phase === 'startup' ? 'unknown' : 'import', platform,
  osVersion: platform === 'ios' ? '26.5' : '35', sessionId: 'private-session-not-retained', networkCalls: 0,
  failedStage: SENTRY_ISOLATED_CHECK, checks: [], storageDiagnostic: {}, cryptoDiagnostic: { bootstrap: 'ready' } });

for (const platform of ['ios', 'android']) for (const phase of ['create', 'startup']) test(`${platform} extra ${phase} report stays fatal but preserves only validated public failure evidence`, async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-proof-diagnostic-'));
  const calls = [], value = appFailure(platform, phase);
  // A completed isolated check distinguishes failure after that qualification from failure inside it.
  value.checks = [{ name: SENTRY_ISOLATED_CHECK, durationMs: 10 }, { name: 'private label never retained', durationMs: 1 }];
  let launched = false;
  try {
    const { token, platform: _platform, ...config } = expected;
    await assert.rejects(runPrivateProofQualification({ platform, config, output, randomBytes: () => Buffer.from(token, 'hex'),
      launch: () => { launched = true; }, list: () => launched ? [`pali-native-qualification-${phase}.json`] : [],
      read: () => assert.fail('The success-sidecar reader must stay separate'),
      readFailure: phase => { calls.push(phase); return JSON.stringify(value); },
    }), /PRIVATE_PROOF_EXTRA_REPORT/);
    assert.deepEqual(calls, [phase]);
    const text = fs.readFileSync(path.join(output, `${platform}-private-proof-diagnostic.json`), 'utf8'), diagnostic = JSON.parse(text);
    assert.equal(diagnostic.diagnosticOnly, true); assert.equal(diagnostic.status, 'failed');
    assert.deepEqual(diagnostic.reports, [{ filePhase: phase, availability: 'available', reportedStatus: 'failed', reportedPhase: value.phase, reportedScenario: value.scenario,
      failedStage: SENTRY_ISOLATED_CHECK, completedCheckCount: 2, completedChecks: [{ name: SENTRY_ISOLATED_CHECK, durationMs: 10 }],
      isolatedSentryQualified: true, networkCalls: 0, nativeBridgeExercised: false, cryptoDiagnostic: { bootstrap: 'ready' }, storageDiagnostic: {} }]);
    assert(!text.includes(value.sessionId)); assert(!text.includes('private label')); assert(Buffer.byteLength(text) <= 8192);
    assert.throws(() => parsePrivateProofReport(text, expected), /PRIVATE_PROOF_REPORT_INVALID/);
    assert(!fs.existsSync(path.join(output, `${platform}-private-proof-app.json`)));
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

for (const fault of ['malformed', 'oversized', 'unknown-field', 'invalid-diagnostic', 'unavailable', 'unknown-name', 'unknown-stage']) test(`extra report ${fault} cannot disclose raw data or qualify proof`, async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-proof-diagnostic-refusal-')), secret = 'private marker never upload';
  let launched = false, reads = 0;
  try {
    const { token, platform, ...config } = expected;
    const value = appFailure(platform);
    if (fault === 'unknown-field') value.wallet = secret;
    if (fault === 'invalid-diagnostic') value.cryptoDiagnostic.load = { error: secret };
    if (fault === 'unknown-stage') value.failedStage = secret;
    const text = fault === 'malformed' ? '{' + secret : fault === 'oversized' ? ' '.repeat(100001) + secret : JSON.stringify(value);
    await assert.rejects(runPrivateProofQualification({ platform, config, output, randomBytes: () => Buffer.from(token, 'hex'),
      launch: () => { launched = true; }, list: () => launched ? [fault === 'unknown-name' ? `pali-native-${secret}.json` : 'pali-native-qualification-create.json'] : [],
      read: () => assert.fail('No proof may be consumed'),
      readFailure: () => { reads++; if (fault === 'unavailable') throw Error(secret); return text; },
    }), /PRIVATE_PROOF_EXTRA_REPORT/);
    const retained = fs.readFileSync(path.join(output, `${platform}-private-proof-diagnostic.json`), 'utf8'), diagnostic = JSON.parse(retained);
    assert.equal(reads, fault === 'unknown-name' ? 0 : 1); assert(!retained.includes(secret));
    if (fault === 'unknown-stage') {
      assert.equal(diagnostic.reports[0].failedStage, 'unrecognized');
      assert.equal(diagnostic.reports[0].isolatedSentryQualified, false);
    } else assert.deepEqual(diagnostic.reports, fault === 'unknown-name' ? [] : [{ filePhase: 'create', availability: fault === 'unavailable' ? 'unavailable' : 'invalid' }]);
    assert(!fs.existsSync(path.join(output, `${platform}-private-proof-app.json`)));
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('required failure-reader omission is refused before launch and diagnostic write failure preserves primary rejection', async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-proof-diagnostic-owner-'));
  let launched = false;
  try {
    const { token, platform, ...config } = expected;
    const options = { platform, config, output, randomBytes: () => Buffer.from(token, 'hex'),
      launch: () => { launched = true; }, list: () => launched ? ['pali-native-qualification-create.json'] : [], read: () => assert.fail() };
    await assert.rejects(runPrivateProofQualification(options), /FAILURE_READER_REQUIRED/); assert.equal(launched, false);
    const existing = path.join(output, `${platform}-private-proof-diagnostic.json`);
    fs.writeFileSync(existing, 'preserve earlier evidence');
    await assert.rejects(runPrivateProofQualification({ ...options, readFailure: () => JSON.stringify(appFailure(platform)) }), /PRIVATE_PROOF_EXTRA_REPORT/);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'preserve earlier evidence');
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('shared bounded sidecar reader admits exact proof filenames and rejects symlinks', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-proof-sidecar-'));
  const name = `pali-native-private-proof-${expected.token}.json`;
  try {
    fs.writeFileSync(path.join(directory, name), JSON.stringify(report()));
    assert.equal(readHttpSidecar(directory, name), JSON.stringify(report()));
    fs.unlinkSync(path.join(directory, name));
    fs.symlinkSync('outside', path.join(directory, name));
    assert.throws(() => readHttpSidecar(directory, name), /SIDECAR_INVALID/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
