import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
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
import type { NativeOperationAuthorization } from '../src/custody/types.ts';
import type { NativeTransferRuntime } from '../src/custody/transfers.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { readSignedRecordEvidence } from '../qualification/signed-record-evidence.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const pinCredential = createTestPinCredentialPort();

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = '123456';

test('HD restart matching rejects failed and empty reports', () => {
  assert.equal(matchesHdRestartEvidence({ status: 'failed' }, { status: 'failed' }), false);
  assert.equal(matchesHdRestartEvidence({}, {}), false);
  assert.equal(matchesHdRestartEvidence({ status: 'passed' }, { status: 'failed' }), false);
});

test('HD fixture guard rejects A-B-A revisions even when address and readiness match', async () => {
  const address = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
  let revision = 0;
  const authorizations = new Set<NativeOperationAuthorization>();
  let signingAttempts = 0;
  const authority = {
    supportsAccountManagement: () => true,
    getCatalogue: () => ({ accounts: [{ index: 0, id: 'hd:60:0', address }] }),
    getSnapshot: () => ({ phase: 'ready', revision, account: { address, network: 'ethereum' } }),
  } as unknown as NativeCustodyAuthority;
  const runtime = {
    transfers: {
      async authorizeOperation(_credential: Parameters<NativeTransferRuntime['authorizeOperation']>[0], _transaction: Parameters<NativeTransferRuntime['authorizeOperation']>[1], check: () => void) {
        check();
        const receipt = Object.freeze({}) as NativeOperationAuthorization;
        authorizations.add(receipt);
        return receipt;
      },
      releaseOperationAuthorization(receipt: NativeOperationAuthorization) { authorizations.delete(receipt); },
      async sign(_transaction: unknown, authority: Parameters<NativeTransferRuntime['sign']>[1]) {
        assert(authorizations.delete(authority.authorization), 'signing requires the current one-use receipt');
        signingAttempts++;
        revision += 2;
        authority.assertCurrent();
        throw Error('UNREACHABLE_STALE_FIXTURE_GUARD');
      },
    },
  } as unknown as KeyringRuntime;
  await assert.rejects(qualifyNativeHdAccounts({
    phase: 'create', authority, runtime, storage: {} as OpenWalletStorage, password: PASSWORD,
    expectedSecondAddress: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
    check: async (_name, operation) => operation(),
  }), /QUALIFICATION_HD_ASSERTION_FAILED/);
  assert.equal(signingAttempts, 1, 'the stale guard must be exercised at signing');
  assert.equal(authorizations.size, 0);
});

for (const scenario of ['import', 'generate'] as const) {
  test(`HD qualification helper executes the real SDK ${scenario} and durable host restart`, { timeout: 90000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pali-hd-qualification-'));
    const file = path.join(directory, 'wallet.sqlite');
    let initialized = false;
    let runtime!: KeyringRuntime;
    let physicalStorage!: SqliteWalletStorage;
    const factory = createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (_request, _signal, check, verify) => { check(); const result = await verify({ method: 'pin', pin: PASSWORD }, check); if (!result.accepted) throw Error(result.reason); }, privacyServiceSettings: null, passkeys: null, slhExecution: null, readEvmRetirement: null,
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
      assert.equal(created.journalContainerVersion, 1);
      const checkContainers = async () => {
        for (const index of [0, 1]) {
          const row = await readSignedRecordEvidence(physicalStorage);
          const entries = row.entries.filter(entry => entry.signer.type === 'HDAccount' && entry.signer.id === index);
          assert.equal(row.version, 1);
          assert.equal(entries.length, 1);
          assert.equal(entries[0]!.phase, 'attempted');
          assert.equal(entries[0]!.hash, index === 0 ? created.firstTransferHash : created.transferHash);
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
        { journalContainerVersion: 2 },
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
