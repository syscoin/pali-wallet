const assert = require('node:assert/strict');
const test = require('node:test');
const { qualifyNativeSlhActivation, readSlhActivationEvidence } = require('./native-slh-activation.ts');
const { getSLHDSAKeyId, SLH_DSA_PARAMETER_SET } = require('../../../source/utils/slhDsa/constants.ts');

const key = { accountIndex: 0, derivationLabel: 'public-test', parameterSet: SLH_DSA_PARAMETER_SET,
  pkSeed: `0x${'11'.repeat(32)}`, pkRoot: `0x${'22'.repeat(32)}`, signatureCount: 0, signatureLimit: 16777216 };
key.keyId = getSLHDSAKeyId(key);
const previous = { version: 1, phase: 'create', authorizationMode: 'native-os', publicChain: 'offline-undeployed-fixture',
  keyId: key.keyId, accountId: 'smart:60:0', signatureCount: 0, nativeSetupComplete: true, privateRuntimeRetired: true,
  publicReopenWithoutSecret: false, counters: { stages: 1, secretReads: 2, nativeOpens: 1, nativeActive: 0 } };

function fixture(phase, overrides = {}) {
  let selected = phase === 'create' ? 'hd:60:0' : 'smart:60:0', imported = phase !== 'create', closed = 0;
  const count = { stages: 0, secretReads: 0, nativeOpens: 0, nativeActive: 0 }, abort = new AbortController();
  const runtime = {
    storage: { readState: async () => ({ presence: imported ? 'existing' : 'empty' }), close: async () => { closed++; } },
    session: {
      importWallet: async () => { imported = true; count.stages++; },
      unlock: async () => { overrides.onUnlock?.(count); return { authenticated: true }; },
    },
    backup: { fingerprint: async () => 'public-fingerprint', confirm: async () => undefined },
    accounts: {
      getSnapshot: () => ({ revision: 1, active: { accountId: selected }, accounts: [{ id: 'smart:60:0', type: 'SmartAccount', smartAccount: { isDeployed: false } }] }),
      reserve: () => ({ execute: async () => { selected = 'smart:60:0'; count.secretReads++; } }),
    },
    openSlhDsaAccount: async () => ({ installedKeys: [],
      prepareFresh: async () => { count.secretReads++; count.nativeOpens++; overrides.onPrepare?.(count, abort); return key; },
      readPrepared: async () => [overrides.savedKey ?? key],
    }),
  };
  return { closed: () => closed, count, input: { phase, previous: phase === 'restart' ? previous : null,
    signal: abort.signal, open: async () => runtime, counts: () => ({ ...count }),
    assertCurrent() { assert.equal(abort.signal.aborted, false); }, observe() {} } };
}

test('activation preparation requires real-operation counters and closes the runtime', async () => {
  const f = fixture('create'), result = await qualifyNativeSlhActivation(f.input);
  assert.equal(result.keyId, key.keyId);
  assert.equal(result.signatureCount, 0);
  assert.equal(result.publicChain, 'offline-undeployed-fixture');
  assert.equal(f.closed(), 1);
  assert.deepEqual(result.counters, previous.counters);
});

test('restart reads the prepared public state without credentials or native execution', async () => {
  const f = fixture('restart'), result = await qualifyNativeSlhActivation(f.input);
  assert.equal(result.publicReopenWithoutSecret, true);
  assert.deepEqual(result.counters, { stages: 0, secretReads: 0, nativeOpens: 0, nativeActive: 0 });
  assert.equal(f.closed(), 1);
});

test('restart refuses a secret read or a different prepared key', async () => {
  for (const options of [{ onUnlock: count => count.secretReads++ }, { savedKey: { ...key, keyId: `${key.keyId}-different` } }]) {
    const f = fixture('restart', options);
    await assert.rejects(qualifyNativeSlhActivation(f.input), /SLH_ACTIVATION_QUALIFICATION_FAILED/);
    assert.equal(f.closed(), 1);
  }
});

test('aborted setup drains through runtime close and cannot produce a pass', async () => {
  const f = fixture('create', { onPrepare: (_count, abort) => abort.abort() });
  await assert.rejects(qualifyNativeSlhActivation(f.input));
  assert.equal(f.closed(), 1);
});

test('an undrained native context cannot pass activation preparation', async () => {
  const f = fixture('create', { onPrepare: count => count.nativeActive++ });
  await assert.rejects(qualifyNativeSlhActivation(f.input), /SLH_ACTIVATION_QUALIFICATION_FAILED/);
  assert.equal(f.closed(), 1);
});

test('restart evidence refuses a wrong mode, scope, setup result, key or counter', () => {
  for (const changed of [{ version: 2 }, { authorizationMode: 'test-only-fixture' }, { publicChain: 'live' },
    { nativeSetupComplete: false }, { privateRuntimeRetired: false }, { signatureCount: 1 },
    { keyId: 'unbound' }, { accountId: 'hd:60:0' }, { counters: { ...previous.counters, secretReads: 0 } }]) {
    assert.throws(() => readSlhActivationEvidence({ ...previous, ...changed }), /SLH_ACTIVATION_QUALIFICATION_FAILED/);
  }
});
