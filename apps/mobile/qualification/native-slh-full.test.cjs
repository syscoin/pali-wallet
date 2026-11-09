const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  SLH_DSA_PARAMETER_SET,
} = require('../../../source/utils/slhDsa/constants.ts');
const {
  fullSlhBuild,
  readFullSlhEvidence,
  matchesFullSlhRestart,
  FULL_SLH_PHASE_TIMEOUT_MS,
} = require('./native-slh-full.ts');
const { decodeNativeReport } = require('./report-validation.cjs');

const build = {
  version: 1,
  sourceRevision: 'a'.repeat(40),
  lockfileSha256: 'b'.repeat(64),
};
const hash = (byte) => '0x' + byte.repeat(32);
// Public schema fixtures only; no native crypto executes or is qualified by these tests.
const signed = (count, fallback = false) => ({
  actionHash: hash(String(count).padStart(2, '0')),
  signatureHash: hash(String(count + 10).padStart(2, '0')),
  count,
  verified: true,
  mutatedSignatureRefused: true,
  mutatedActionRefused: true,
  native: {
    loads: fallback ? 0 : 1,
    setups: 0,
    prelude: 1,
    fors: fallback ? 0 : 6,
    finish: fallback ? 0 : 1,
    cached: fallback ? 1 : 0,
    forced: fallback ? 1 : 0,
  },
});
const evidence = (phase) => ({
  ...build,
  parameterSet: SLH_DSA_PARAMETER_SET,
  accountIndex: 0,
  profileHash: hash('01'),
  keyIdHash: hash('02'),
  publicKey32: hash('03'),
  signatureCount: phase === 'create' ? 2 : 3,
  deriveCalls: phase === 'create' ? 1 : 0,
  prepared: phase === 'create',
  canceledAdmissionDrained: phase === 'create',
  healthy: signed(phase === 'create' ? 1 : 3),
  fallback: phase === 'create' ? signed(2, true) : null,
});

test('full SLH public evidence requires exact profile, native FORS/finish/fallback and saved usage progression', () => {
  assert.deepEqual(fullSlhBuild(build), build);
  for (const phase of ['create', 'restart'])
    assert.doesNotThrow(() =>
      readFullSlhEvidence(evidence(phase), phase, build)
    );
  assert.equal(
    matchesFullSlhRestart(evidence('create'), evidence('restart'), build),
    true
  );
  const changes = [
    (r) => {
      r.parameterSet = 'reduced-profile';
    },
    (r) => {
      r.accountIndex = 1;
    },
    (r) => {
      r.sourceRevision = 'c'.repeat(40);
    },
    (r) => {
      r.lockfileSha256 = 'c'.repeat(64);
    },
    (r) => {
      r.signatureCount--;
    },
    (r) => {
      r.prepared = false;
    },
    (r) => {
      r.canceledAdmissionDrained = false;
    },
    (r) => {
      r.deriveCalls = 2;
    },
    (r) => {
      r.healthy.native.loads = 0;
    },
    (r) => {
      r.healthy.native.fors = 5;
    },
    (r) => {
      r.healthy.native.finish = 0;
    },
    (r) => {
      r.healthy.native.cached = 1;
    },
    (r) => {
      r.fallback.native.forced = 0;
    },
    (r) => {
      r.fallback.native.cached = 0;
    },
    (r) => {
      r.fallback.native.setups = 1;
    },
    (r) => {
      r.healthy.verified = false;
    },
    (r) => {
      r.healthy.mutatedSignatureRefused = false;
    },
    (r) => {
      r.healthy.mutatedActionRefused = false;
    },
    (r) => {
      r.healthy.actionHash = hash('04');
    },
    (r) => {
      r.healthy.signatureHash = r.fallback.signatureHash;
    },
    (r) => {
      r.fallback.native.fors = -1;
    },
    (r) => {
      r.fallback.native.prelude = Infinity;
    },
    (r) => {
      r.secretKeyHex = hash('04');
    },
    (r) => {
      r.pkSeed = hash('04');
    },
    (r) => {
      r.healthy.signature = hash('04');
    },
    (r) => {
      r.healthy.native.raw = 'private input';
    },
  ];
  for (const mutate of changes) {
    const value = evidence('create');
    mutate(value);
    assert.throws(() => readFullSlhEvidence(value, 'create', build));
  }
  const restart = evidence('restart');
  restart.deriveCalls = 1;
  assert.throws(() => readFullSlhEvidence(restart, 'restart', build));
  for (const name of ['profileHash', 'keyIdHash', 'publicKey32']) {
    const restored = evidence('restart');
    restored[name] = hash('ff');
    assert.equal(
      matchesFullSlhRestart(evidence('create'), restored, build),
      false
    );
  }
});

test('full SLH never relaxes normal report credential, size, status or unknown-field refusal', () => {
  const fullSlh = evidence('create');
  for (const text of [
    'x'.repeat(100001),
    JSON.stringify({
      fullSlh,
      extra:
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    }),
    JSON.stringify({
      fullSlh,
      extra: 'PUBLIC native qualification password 2026!',
    }),
  ]) {
    assert.throws(() =>
      decodeNativeReport(text, 'android', 'create', 'import')
    );
  }
  assert.throws(() =>
    decodeNativeReport(
      JSON.stringify({
        fullSlh,
        version: 1,
        status: 'failed',
        phase: 'create',
        scenario: 'import',
        platform: 'android',
      }),
      'android',
      'create',
      'import'
    )
  );
});

function waitFunction(name, fullEnabled = true) {
  const source = fs.readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const start = source.indexOf(`const ${name} = async `);
  const end = source.indexOf('\n};', start) + 3;
  assert(start >= 0 && end > start);
  let elapsed = 0;
  const context = {
    fullSlhConfiguration: fullEnabled ? build : null,
    FULL_SLH_PHASE_TIMEOUT_MS,
    Date: { now: () => elapsed },
    sleep: async (ms) => {
      elapsed += ms;
    },
    platform: 'android',
    validateReport: (text) => JSON.parse(text),
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end)}\nglobalThis.wait = ${name};`,
    context
  );
  return { wait: context.wait, elapsed: () => elapsed };
}

test('manual full-SLH phase has its own finite 1800s budget and ordinary custody remains 300s', async () => {
  assert.equal(FULL_SLH_PHASE_TIMEOUT_MS, 1800000);
  const normal = waitFunction('waitReport');
  await assert.rejects(
    normal.wait(() => undefined, 'create', 'import'),
    /timed out/
  );
  assert.equal(normal.elapsed(), 300000);
  const full = waitFunction('waitFullSlhReport');
  await assert.rejects(
    full.wait(() => undefined, 'create', 'import'),
    /1800s phase budget/
  );
  assert.equal(full.elapsed(), 1800000);
  const disabled = waitFunction('waitFullSlhReport', false);
  await assert.rejects(
    disabled.wait(() => undefined, 'create', 'import'),
    /mode required/
  );
  const exited = waitFunction('waitFullSlhReport');
  await assert.rejects(
    exited.wait(
      () => undefined,
      'restart',
      'import',
      undefined,
      () => false
    ),
    /exited before report/
  );
  assert.equal(exited.elapsed(), 5000);
});
