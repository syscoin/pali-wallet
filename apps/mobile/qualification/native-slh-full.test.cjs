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
  signMs: 123.5,
  count,
  verified: true,
  mutatedSignatureRefused: true,
  mutatedActionRefused: true,
  native: {
    loads: 1,
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
  timings: {
    deriveSetupSecretMs: phase === 'create' ? 10.5 : null,
    prepareFreshMs: phase === 'create' ? 1000.5 : null,
    hydrateInstalledMs: 2.5,
  },
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
      r.fallback.native.loads = 0;
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

test('full SLH timings require the current bounded schema and phase-specific operations', () => {
  for (const phase of ['create', 'restart']) {
    for (const field of [
      'hydrateInstalledMs',
      ...(phase === 'create' ? ['deriveSetupSecretMs', 'prepareFreshMs'] : []),
    ]) {
      for (const invalid of [
        -1,
        NaN,
        Infinity,
        FULL_SLH_PHASE_TIMEOUT_MS + 1,
        null,
        '1',
      ]) {
        const value = evidence(phase);
        value.timings[field] = invalid;
        assert.throws(() => readFullSlhEvidence(value, phase, build));
      }
    }
    for (const field of [
      'healthy',
      ...(phase === 'create' ? ['fallback'] : []),
    ]) {
      for (const invalid of [
        -1,
        NaN,
        Infinity,
        FULL_SLH_PHASE_TIMEOUT_MS + 1,
        null,
        '1',
      ]) {
        const value = evidence(phase);
        value[field].signMs = invalid;
        assert.throws(() => readFullSlhEvidence(value, phase, build));
      }
    }
  }
  for (const mutate of [
    (r) => {
      delete r.timings;
    },
    (r) => {
      delete r.timings.prepareFreshMs;
    },
    (r) => {
      r.timings.extra = 1;
    },
    (r) => {
      delete r.healthy.signMs;
    },
    (r) => {
      r.timings.deriveSetupSecretMs = r.timings.prepareFreshMs + 1;
    },
  ]) {
    const value = evidence('create');
    mutate(value);
    assert.throws(() => readFullSlhEvidence(value, 'create', build));
  }
  for (const field of ['deriveSetupSecretMs', 'prepareFreshMs']) {
    const value = evidence('restart');
    value.timings[field] = 0;
    assert.throws(() => readFullSlhEvidence(value, 'restart', build));
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

test('full SLH fallback admits drained parallel peers but never all six or invalid native counts', () => {
  for (let peers = 0; peers <= 5; peers++) {
    const value = evidence('create');
    value.fallback.native.fors = peers;
    assert.doesNotThrow(() => readFullSlhEvidence(value, 'create', build));
  }
  for (const peers of [-1, 6, 7, 0.5, NaN, Infinity, '4']) {
    const value = evidence('create');
    value.fallback.native.fors = peers;
    assert.throws(() => readFullSlhEvidence(value, 'create', build));
  }
});

test('five-lane forced failure drains real shared scheduling before cached fallback', async () => {
  const {
    createSlhDsaExecution,
  } = require('../../../source/wallet/slhDsaExecution.ts');
  const {
    getSLHDSAKeyId,
  } = require('../../../source/utils/slhDsa/constants.ts');
  const { FullSlhForsTracker } = require('./native-slh-full.ts');
  const tracker = new FullSlhForsTracker(),
    peers = [];
  let injected = false,
    calls = 0,
    cached = 0;
  const fields = {
    pkRoot: '0x' + '44'.repeat(16) + '00'.repeat(16),
    pkSeed: '0x' + '33'.repeat(16) + '00'.repeat(16),
  };
  const host = {
    leafConcurrency: 5,
    forsConcurrency: 5,
    allocateTree: () => ({}),
    releaseTree() {},
    readTree: () => new Uint8Array(16).fill(0x44),
    writeTree() {},
    loadTree: async (keyId) => ({ keyId, bytes: 134217712, tree: {} }),
    saveTree: async () => {},
    openSetup: () => ({ buildChunk: () => 0, dispose() {} }),
    createLeafLanes: () => [],
    importKey: (value) => value,
    releaseKey() {},
    signPrelude: () => new Uint8Array(46),
    async signForsTree(_key, _prelude, index) {
      if (!injected) {
        injected = true;
        throw Error('FULL_SLH_BEFORE_NATIVE_FORS');
      }
      calls++;
      return tracker.run(
        () =>
          new Promise((resolve) => {
            peers.push(() =>
              resolve({ treeIndex: index, shard: new Uint8Array(416) })
            );
          })
      );
    },
    finishSignature() {
      assert.fail('failed batch cannot assemble');
    },
    signCached() {
      tracker.assertDrained();
      cached++;
      return new Uint8Array(3856);
    },
    randomFill(bytes) {
      bytes.fill(1);
    },
    yield: async () => {},
  };
  const signing = createSlhDsaExecution(host).signActionHash(
    {
      ...fields,
      keyId: getSLHDSAKeyId(fields),
      actionHash: hash('aa'),
      secretKeyHex:
        '0x' +
        '11'.repeat(16) +
        '22'.repeat(16) +
        '33'.repeat(16) +
        '44'.repeat(16),
    },
    () => {}
  );
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  assert.equal(calls, 4);
  assert.equal(tracker.inFlight, 4);
  assert.equal(cached, 0);
  assert.throws(() => tracker.assertDrained());
  for (const release of peers.slice(0, 3)) release();
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  assert.equal(tracker.inFlight, 1);
  assert.equal(cached, 0);
  peers[3]();
  await signing;
  assert.equal(tracker.inFlight, 0);
  assert.equal(cached, 1);
  const value = evidence('create');
  value.fallback.native.fors = calls;
  assert.doesNotThrow(() => readFullSlhEvidence(value, 'create', build));
});

test('full SLH failure diagnostics contain only bounded public state', () => {
  const { readFullSlhDiagnostic } = require('./native-slh-full.ts');
  const good = {
    stage: 'fallback',
    point: 'cached',
    native: { ...signed(2, true).native, fors: 4 },
    inFlightFors: 0,
    signalAborted: false,
    executionState: 'active',
  };
  assert.deepEqual(readFullSlhDiagnostic(good), good);
  for (const patch of [
    { stage: 'private key' },
    { point: 'unknown' },
    { inFlightFors: 7 },
    { inFlightFors: -1 },
    { signalAborted: 'false' },
    { executionState: {} },
    { secret: 'extra' },
    { native: { ...good.native, raw: 'extra' } },
    { native: { ...good.native, fors: Infinity } },
  ]) {
    assert.throws(() => readFullSlhDiagnostic({ ...good, ...patch }));
  }
});
