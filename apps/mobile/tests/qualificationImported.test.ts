import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isImportedQualificationReport, matchesImportedRestartEvidence, IMPORTED_REPORT_FIELDS, qualifyNativeImportedEvm } from '../qualification/imported-evm.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
const require = createRequire(import.meta.url);
const { importedEvidence } = require('../qualification/imported-report-fixture.cjs');
const report = (phase = 'create') => ({ status: 'passed', phase, scenario: 'import', networkCalls: 0, fingerprint: 'a'.repeat(64), ...importedEvidence(phase) });

test('imported qualification reports require exact kind, three chains and phase-bound counts', () => {
  const first = report(), second = report('restart');
  assert(isImportedQualificationReport(first)); assert(matchesImportedRestartEvidence(first, second));
  for (const field of IMPORTED_REPORT_FIELDS) {
    const missing = { ...first }; delete missing[field]; assert.equal(isImportedQualificationReport(missing), false);
    assert.equal(isImportedQualificationReport({ status: 'failed', [field]: true }), false);
  }
  for (const change of [
    { importedAccountId: 'hd:60:1' }, { importedAccountIndex: 0 }, { importedAddress: 'invalid' },
    { importedChainIds: ['1', '57057', '5700'] }, { importedChainIds: [1, 5700, 57057] },
    { importedTransferHashes: new Array(3) }, { importedTransferHashes: Array(3).fill('0x' + '1'.repeat(64)) },
    { importedKeyRevealVerified: 'true' }, { importedRestoredFromJournal: false }, { importedAuthorizations: 0 },
    { importedSignatures: 1 }, { importedInjectedBroadcasts: 2 }, { importedJournalContainerVersion: 2 },
    { networkCalls: 1 }, { scenario: ['import'] }, { fingerprint: 'b'.repeat(64) },
  ]) assert.equal(matchesImportedRestartEvidence(first, { ...second, ...change }), false);
  assert.equal(isImportedQualificationReport({ ...first, transferHash: first.importedTransferHashes[0] }), false);
  assert.equal(isImportedQualificationReport({ ...first, address: first.importedAddress }), false);
  assert(isImportedQualificationReport({ status: 'failed' }));
  for (const pair of [[{}, {}], [{ status: 'failed', phase: 'create' }, { status: 'failed', phase: 'restart' }],
    [first, { ...second, status: 'failed' }], [{ ...first, status: 'failed' }, second]])
    assert.equal(matchesImportedRestartEvidence(pair[0]!, pair[1]!), false);
});

test('imported qualification refuses an unready authority before accessing a runtime or storage capability', async () => {
  let accessed = 0;
  const authority = { getCatalogue() { return null; } } as unknown as NativeCustodyAuthority;
  const runtime = { get imports() { accessed++; throw Error('must not access'); } } as unknown as KeyringRuntime;
  await assert.rejects(qualifyNativeImportedEvm({ phase: 'create', authority, runtime, storage: {} as OpenWalletStorage,
    check: async (_name, operation) => operation() }), /QUALIFICATION_IMPORTED_EVM_FAILED/);
  assert.equal(accessed, 0);
});
