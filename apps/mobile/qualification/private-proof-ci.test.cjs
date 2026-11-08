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

const expected = { sourceRevision: 'a'.repeat(40), lockfileSha256: crypto.createHash('sha256').update('{}').digest('hex'),
  sdkVersion: '3.9.7', sdkPackageVersion: '3.9.7', platform: 'ios', token: 'b'.repeat(32) };
const report = () => ({ version: 1, ...expected, kind: 'native-private-proof', status: 'passed',
  sessionId: '11111111-2222-4333-8444-555555555555', jsNetworkCalls: 0, nativeNetworkObservation: 'unmeasured',
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
      });
      await assert.rejects(task);
      assert.equal(launched, kind !== 'stale');
      if (kind === 'missing') assert.equal(time, 400000);
      assert(!fs.existsSync(path.join(output, 'ios-private-proof-app.json')));
    }
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
