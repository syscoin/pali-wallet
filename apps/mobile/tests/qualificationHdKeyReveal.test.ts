import assert from 'node:assert/strict';
import test from 'node:test';
import { isHdKeyRevealQualificationReport, matchesHdKeyRevealRestartEvidence, qualifyNativeHdKeyReveal } from '../qualification/hd-key-reveal.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';

const evidence = (phase: 'create' | 'restart') => ({ status: 'passed', phase, selectedAccountId: 'hd:60:1', selectedAccountIndex: 1,
  address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', nativeHdKeyRevealVerified: true });

test('HD key reveal evidence is strict, required and bound to the same selected public identity across restart', () => {
  const first = evidence('create'), second = evidence('restart');
  assert(isHdKeyRevealQualificationReport(first));
  assert(matchesHdKeyRevealRestartEvidence(first, second));
  const missing: Record<string, unknown> = { ...first }; delete missing.nativeHdKeyRevealVerified;
  for (const value of [missing, ...[false, 1, 'true', null, {}].map((flag) => ({ ...first, nativeHdKeyRevealVerified: flag })),
    { ...first, selectedAccountId: 'hd:60:0' }, { ...first, selectedAccountIndex: 0 }, { ...first, phase: 'reset' }])
    assert.equal(isHdKeyRevealQualificationReport(value), false);
  for (const value of [{ ...second, phase: 'create' }, { ...second, address: '0x' + '1'.repeat(40) }, { ...second, nativeHdKeyRevealVerified: false }])
    assert.equal(matchesHdKeyRevealRestartEvidence(first, value), false);
  assert(isHdKeyRevealQualificationReport({ status: 'failed' }));
  assert.equal(isHdKeyRevealQualificationReport({ status: 'failed', nativeHdKeyRevealVerified: true }), false);
});

test('HD key qualification cannot read a secret before backup confirmation or for a different selected account', async () => {
  let reads = 0;
  for (const backup of ['unconfirmed', 'confirmed']) {
    const index = backup === 'unconfirmed' ? 1 : 0;
    const authority = { getSnapshot: () => ({ phase: 'ready', backup, revision: 1, account: { address: evidence('create').address, network: 'ethereum' } }),
      getCatalogue: () => ({ revision: 1, active: { accountId: `hd:60:${index}`, networkId: 'ethereum' }, accounts: [{ id: `hd:60:${index}`, index, type: 'HDAccount', address: evidence('create').address }] }) } as unknown as NativeCustodyAuthority;
    const runtime = { keyExport: { async readSelected() { reads++; return ''; } } } as unknown as KeyringRuntime;
    await assert.rejects(qualifyNativeHdKeyReveal({ authority, runtime, storage: {} as OpenWalletStorage,
      password: 'public-test-password', expectedAddress: evidence('create').address, check: async (_name, operation) => operation() }), /QUALIFICATION_HD_KEY_REVEAL_FAILED/);
  }
  assert.equal(reads, 0);
});

test('restart evidence never accepts failed or incomplete reports', () => {
  const failedCreate = { status: 'failed', phase: 'create' };
  const failedRestart = { status: 'failed', phase: 'restart' };
  for (const [created, restored] of [
    [failedCreate, failedRestart],
    [evidence('create'), failedRestart],
    [failedCreate, evidence('restart')],
    [{ status: 'passed', phase: 'create' }, { status: 'passed', phase: 'restart' }],
  ]) assert.equal(matchesHdKeyRevealRestartEvidence(created!, restored!), false);
});
