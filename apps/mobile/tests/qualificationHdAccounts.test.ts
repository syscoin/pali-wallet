import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HDNodeWallet } from 'ethers/wallet';
import { isHdQualificationReport, matchesHdRestartEvidence, qualifyNativeHdAccounts } from '../qualification/hd-accounts.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory } from '../src/custody/keyringRuntime.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { nativeTransferJournalKey } from '../src/custody/transferJournal.ts';
import type { TransferJournalContainer } from '../src/custody/transferJournal.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC native HD qualification test password 1!';

test('HD restart matching rejects failed and empty reports', () => {
  assert.equal(matchesHdRestartEvidence({ status: 'failed' }, { status: 'failed' }), false);
  assert.equal(matchesHdRestartEvidence({}, {}), false);
  assert.equal(matchesHdRestartEvidence({ status: 'passed' }, { status: 'failed' }), false);
});

test('HD fixture guard rejects A-B-A revisions even when address and readiness match', async () => {
  const address = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
  let revision = 0;
  const authority = {
    supportsAccountManagement: () => true,
    getCatalogue: () => ({ accounts: [{ index: 0, id: 'hd:60:0', address }] }),
    getSnapshot: () => ({ phase: 'ready', revision, account: { address, network: 'ethereum' } }),
  } as unknown as NativeCustodyAuthority;
  const runtime = {
    transfers: {
      async sign(_transaction: unknown, _password: string, assertCurrent: () => void) {
        revision += 2;
        assertCurrent();
        throw Error('UNREACHABLE_STALE_FIXTURE_GUARD');
      },
    },
  } as unknown as KeyringRuntime;
  await assert.rejects(qualifyNativeHdAccounts({
    phase: 'create', authority, runtime, storage: {} as OpenWalletStorage, password: PASSWORD,
    expectedSecondAddress: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
    check: async (_name, operation) => operation(),
  }), /QUALIFICATION_HD_ASSERTION_FAILED/);
});

for (const scenario of ['import', 'generate'] as const) {
  test(`HD qualification helper executes the real SDK ${scenario} and durable host restart`, { timeout: 90000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pali-hd-qualification-'));
    const file = path.join(directory, 'wallet.sqlite');
    let initialized = false;
    let runtime!: KeyringRuntime;
    let physicalStorage!: SqliteWalletStorage;
    const factory = createKeyringRuntimeFactory({
      ensureCryptoReady: async () => undefined,
      openStorage: async () => {
        physicalStorage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, !initialized);
        initialized = true;
        return physicalStorage;
      },
    });
    const owner = { open: async () => { runtime = await factory.open() as KeyringRuntime; return runtime; } };
    let authority = new NativeCustodyAuthority(owner);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw Error('QUALIFICATION_NETWORK_FORBIDDEN'); }) as typeof fetch;
    const checks: string[] = [];
    const check = async <T,>(name: string, operation: () => Promise<T>) => { checks.push(name); return operation(); };
    try {
      await authority.initialize();
      if (scenario === 'import') await authority.importPhrase(PHRASE, PASSWORD);
      else await authority.create(PASSWORD);
      const words = await runtime.backup.readPhrase(PASSWORD);
      const expectedSecondAddress = HDNodeWallet.fromPhrase(words.join(' '), undefined, "m/44'/60'/0'/0/1").address;
      if (scenario === 'import') assert.equal(expectedSecondAddress, '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
      await runtime.backup.confirm(await runtime.backup.fingerprint());
      await authority.refreshAuthenticatedMetadata();
      const fingerprint = await physicalStorage.getWalletFingerprint();
      await assert.rejects(qualifyNativeHdAccounts({ phase: 'create', authority, runtime, storage: physicalStorage, password: PASSWORD, check }), /QUALIFICATION_HD_ASSERTION_FAILED/);
      const created = await qualifyNativeHdAccounts({ phase: 'create', authority, runtime, storage: physicalStorage, password: PASSWORD, expectedSecondAddress, check });
      assert.equal(created.address, expectedSecondAddress);
      assert.equal(created.selectedAccountId, 'hd:60:1');
      assert.notEqual(created.transferHash, created.firstTransferHash);
      assert.equal(created.journalContainerVersion, 2);
      const checkContainers = async () => {
        for (const index of [0, 1]) {
          const row = await physicalStorage.keyringStorage.get(nativeTransferJournalKey(index)) as TransferJournalContainer;
          assert.equal(row.version, 2);
          assert.equal(row.account.id, `hd:60:${index}`);
          assert.equal(row.entries.length, 1);
          assert.equal(row.entries[0]!.phase, 'attempted');
          assert.equal(row.entries[0]!.hash, index === 0 ? created.firstTransferHash : created.transferHash);
        }
      };
      await checkContainers();
      assert.equal(await physicalStorage.getWalletFingerprint(), fingerprint);
      assert(!JSON.stringify(created).includes(PHRASE));
      assert(!JSON.stringify(created).includes(PASSWORD));
      await authority.dispose();
      authority = new NativeCustodyAuthority(owner);
      await authority.initialize();
      assert.equal(authority.getSnapshot().phase, 'locked');
      await authority.unlock(PASSWORD);
      assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
      const restored = await qualifyNativeHdAccounts({ phase: 'restart', authority, runtime, storage: physicalStorage, password: PASSWORD,
        expectedSecondAddress, expectedRestartAddress: created.address, check });
      assert.deepEqual(restored, created);
      await checkContainers();
      const reports = [{ status: 'passed', ...created }, { status: 'passed', ...restored }];
      assert(matchesHdRestartEvidence(reports[0]!, reports[1]!));
      for (const mutation of [
        { address: '0x1111111111111111111111111111111111111111' },
        { selectedAccountId: 'hd:60:0' },
        { selectedAccountIndex: 0 },
        { journalContainerVersion: 1 },
        { transferHash: '0x' + 'a'.repeat(64) },
        { firstTransferHash: '0x' + 'b'.repeat(64) },
        { firstTransferHash: created.transferHash },
      ]) assert.equal(matchesHdRestartEvidence(reports[0]!, { ...reports[1], ...mutation }), false);
      assert.equal(isHdQualificationReport({ status: 'failed', ...created }), false);
      assert.equal(isHdQualificationReport({ status: 'failed' }), true);
      assert(checks.includes('native account journal isolation and pending-removal refusal'));
      assert(checks.includes('native selected-HD identity and journal after cold restart'));
    } finally {
      await authority.dispose().catch(() => undefined);
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  });
}
