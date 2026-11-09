import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HDNodeWallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { qualifyNativeHdAccounts } from '../qualification/hd-accounts.ts';
import { qualifyNativeErc20Transfer } from '../qualification/erc20-transfer.ts';
import {
  isNevmQualificationReport,
  matchesNevmRestartEvidence,
  qualifyNativeNevmTransfer,
} from '../qualification/nevm-transfer.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { readSignedRecordEvidence, retainedSignedEntries } from '../qualification/signed-record-evidence.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC NEVM native qualification test password 1!';
const FOURTH_ADDRESS = '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

const report = (phase: 'create' | 'restart') => ({
  status: 'passed',
  phase,
  scenario: 'import',
  networkCalls: 0,
  fingerprint: 'f'.repeat(64),
  address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
  erc20Address: '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
  transferHash: '0x' + 'a'.repeat(64),
  firstTransferHash: '0x' + 'b'.repeat(64),
  erc20TransferHash: '0x' + 'c'.repeat(64),
  nativeNevmVerified: true,
  nevmAccountId: 'hd:60:3',
  nevmAccountIndex: 3,
  nevmAddress: FOURTH_ADDRESS,
  nevmTransferHash: '0x' + 'd'.repeat(64),
  nevmEthereumTransferHash: '0x' + 'e'.repeat(64),
  nevmChainId: '5700',
  nevmJournalContainerVersion: 1,
  nevmRestoredFromJournal: phase === 'restart',
});

test('NEVM report requires complete bounded evidence and exact restart identity', () => {
  assert(isNevmQualificationReport(report('create')));
  assert(matchesNevmRestartEvidence(report('create'), report('restart')));
  for (const change of [
    { nativeNevmVerified: false },
    { nevmAccountId: 'hd:60:2' },
    { nevmAccountIndex: 2 },
    { nevmAddress: report('create').address },
    { nevmAddress: report('create').erc20Address },
    { nevmAddress: '0x' + '0'.repeat(40) },
    { nevmTransferHash: '0x123' },
    { nevmTransferHash: report('create').transferHash },
    { nevmTransferHash: report('create').firstTransferHash },
    { nevmTransferHash: report('create').erc20TransferHash },
    { nevmTransferHash: report('create').nevmEthereumTransferHash },
    { nevmEthereumTransferHash: report('create').erc20TransferHash },
    { nevmChainId: 5700 },
    { nevmChainId: '1' },
    { nevmJournalContainerVersion: 2 },
    { nevmRestoredFromJournal: false },
    { phase: ['restart'] },
    { scenario: ['import'] },
    { scenario: 'generate' },
    { networkCalls: 1 },
    { fingerprint: 'e'.repeat(64) },
  ])
    assert.equal(
      matchesNevmRestartEvidence(report('create'), {
        ...report('restart'),
        ...change,
      }),
      false
    );
  const fields = [
    'nativeNevmVerified',
    'nevmAccountId',
    'nevmAccountIndex',
    'nevmAddress',
    'nevmTransferHash',
    'nevmEthereumTransferHash',
    'nevmChainId',
    'nevmJournalContainerVersion',
    'nevmRestoredFromJournal',
  ];
  for (const field of fields) {
    const partial = { ...report('create') } as Record<string, unknown>;
    delete partial[field];
    assert.equal(isNevmQualificationReport(partial), false);
    assert.equal(
      isNevmQualificationReport({
        status: 'failed',
        [field]: report('create')[field as keyof ReturnType<typeof report>],
      }),
      false
    );
  }
  assert.equal(isNevmQualificationReport({ status: 'failed' }), true);
  assert.equal(
    matchesNevmRestartEvidence({ status: 'failed' }, { status: 'failed' }),
    false
  );
  assert.equal(matchesNevmRestartEvidence({}, {}), false);
});

async function sqliteDisk() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-qualification-'));
  const file = path.join(directory, 'wallet.sqlite');
  let initialized = false;
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  const factory = createKeyringRuntimeFactory({ readEvmRetirement: null,
    ensureCryptoReady: async () => { assert(globalThis.crypto.subtle); },
    async openStorage() {
      storage = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, !initialized);
      initialized = true;
      return storage;
    },
  });
  return {
    get runtime() { return runtime; },
    get storage() { return storage; },
    owner: { async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } },
    async snapshot(excludeSuccessfulAuthentication = false) {
      const snapshot = await storage.recovery.readSnapshot();
      if (!excludeSuccessfulAuthentication) return JSON.stringify(snapshot);
      // Real successful authentication refreshes lastAttempt; private domains
      // and every other metadata row must remain byte-exact.
      const row = snapshot.metadata.find(entry => entry.key === 'auth');
      assert(row);
      const authentication = JSON.parse(row.value);
      assert.equal(authentication.version, 1);
      assert.equal(authentication.failures, 0);
      assert.equal(authentication.notBefore, 0);
      return JSON.stringify({ ...snapshot, metadata: snapshot.metadata.filter(entry => entry.key !== 'auth') });
    },
    async replaceSigned(profile: string, value: string) {
      // Corrupt the physical fixture directly; do not weaken production admission.
      const external = nodeConnection(file);
      try { await external.connection.runAsync('UPDATE evm_signed_records SET value = ? WHERE profile_id = ?', [value, profile]); }
      finally { await external.connection.closeAsync(); }
    },
    async close() { await rm(directory, { recursive: true, force: true }); },
  };
}

for (const scenario of ['import', 'generate'] as const) {
  test(
    `NEVM ${scenario} qualifier signs the same HD3 nonce on two chains and cold-restores exact bytes`,
    { timeout: 90000 },
    async () => {
      const disk = await sqliteDisk();
      let authority = new NativeCustodyAuthority(disk.owner);
      const originalFetch = globalThis.fetch;
      let networkCalls = 0;
      globalThis.fetch = (() => {
        networkCalls++;
        throw Error('QUALIFICATION_NETWORK_FORBIDDEN');
      }) as typeof fetch;
      const checks: string[] = [];
      const check = async <T>(name: string, operation: () => Promise<T>) => {
        checks.push(name);
        return operation();
      };
      const rows = async () => {
        const evidence = await readSignedRecordEvidence(disk.storage);
        const addresses = authority.getCatalogue()!.accounts.filter(entry => entry.index < 3).map(entry => entry.address);
        return retainedSignedEntries(evidence.entries, addresses);
      };
      try {
        await authority.initialize();
        if (scenario === 'import')
          await authority.importPhrase(PHRASE, PASSWORD);
        else await authority.create(PASSWORD);
        const words = await disk.runtime.backup.readPhrase(PASSWORD);
        const derived = [1, 2, 3].map(
          (index) =>
            HDNodeWallet.fromPhrase(
              words.join(' '),
              undefined,
              `m/44'/60'/0'/0/${index}`
            ).address
        );
        if (scenario === 'import') assert.equal(derived[2], FOURTH_ADDRESS);
        await disk.runtime.backup.confirm(
          await disk.runtime.backup.fingerprint()
        );
        await authority.refreshAuthenticatedMetadata();
        const hd = await qualifyNativeHdAccounts({
          phase: 'create',
          authority,
          runtime: disk.runtime,
          storage: disk.storage,
          password: PASSWORD,
          expectedSecondAddress: derived[0],
          check,
        });
        const erc20 = await qualifyNativeErc20Transfer({
          phase: 'create',
          authority,
          runtime: disk.runtime,
          storage: disk.storage,
          password: PASSWORD,
          expectedThirdAddress: derived[1],
          check,
        });
        const older = await rows();
        const fingerprint = await disk.storage.getWalletFingerprint();
        let signatures = 0;
        const realTransfer = disk.runtime.transfers!;
        const createRuntime: KeyringRuntime = {
          ...disk.runtime,
          transfers: {
            ...realTransfer,
            async sign(transaction, guard, intent) {
              signatures++;
              assert.equal(
                transaction.chainId,
                signatures === 1 ? '1' : '5700'
              );
              return realTransfer.sign(transaction, guard, intent);
            },
          },
        };
        const beforeInvalid = await disk.snapshot();
        await assert.rejects(
          qualifyNativeNevmTransfer({
            phase: 'create',
            authority,
            runtime: createRuntime,
            storage: disk.storage,
            password: PASSWORD,
            expectedFourthAddress: 'invalid',
            check,
          }),
          /QUALIFICATION_NEVM_ASSERTION_FAILED/
        );
        assert.equal(await disk.snapshot(), beforeInvalid);
        const created = await qualifyNativeNevmTransfer({
          phase: 'create',
          authority,
          runtime: createRuntime,
          storage: disk.storage,
          password: PASSWORD,
          expectedFourthAddress: scenario === 'import' ? derived[2] : undefined,
          check,
        });
        assert.equal(signatures, 2);
        assert.equal(created.nevmAddress, derived[2]);
        assert.deepEqual(await rows(), older);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        assert.equal(authority.getSnapshot().account?.network, 'ethereum');
        const bundle = await readSignedRecordEvidence(disk.storage);
        const container = bundle.entries.filter(entry => entry.from === created.nevmAddress.toLowerCase());
        assert.equal(bundle.version, 1);
        assert.equal(container.length, 2);
        const signedBytes: string[] = [];
        await authority.manageAccounts({ kind: 'select', id: 'hd:60:3' }, authority.getSnapshot().revision, authority.getCatalogue()!.revision);
        for (const [index, network, value] of [
          [0, 'ethereum', 456n], [1, 'syscoin-nevm-testnet', 789n],
        ] as const) {
          await authority.selectNetwork(network, authority.getSnapshot().revision, authority.getCatalogue()!.revision, () => {});
          const entry = container[index]!;
          assert.equal(entry.chainId, getNativeNetwork(network).chainId);
          assert.equal(entry.phase, 'attempted'); assert.equal(entry.nonce, 0);
          const saved = await (await disk.runtime.transfers!.journal(() => undefined)).load();
          assert.equal(saved!.hash, entry.hash); signedBytes.push(saved!.rawTransaction);
          const signed = Transaction.from(saved!.rawTransaction);
          assert(signed.isSigned()); assert.equal(signed.from, created.nevmAddress);
          assert.equal(signed.chainId, network === 'ethereum' ? 1n : 5700n);
          assert.equal(signed.value, value); assert.equal(signed.nonce, 0); assert.equal(signed.gasLimit, 21000n);
          assert.equal(signed.maxFeePerGas, 3n); assert.equal(signed.maxPriorityFeePerGas, 1n);
          assert(!bundle.raw!.includes(saved!.rawTransaction));
        }
        await authority.selectNetwork('ethereum', authority.getSnapshot().revision, authority.getCatalogue()!.revision, () => {});
        await authority.manageAccounts({ kind: 'select', id: 'hd:60:1' }, authority.getSnapshot().revision, authority.getCatalogue()!.revision);
        const createdReport = {
          status: 'passed',
          phase: 'create',
          scenario,
          networkCalls,
          fingerprint,
          ...hd,
          ...erc20,
          ...created,
        };
        assert(isNevmQualificationReport(createdReport));
        assert(!JSON.stringify(createdReport).includes(words.join(' ')));
        assert(!JSON.stringify(createdReport).includes(PASSWORD));
        assert(
          !JSON.stringify(createdReport).includes(
            signedBytes[0]!
          )
        );
        await authority.dispose();
        authority = new NativeCustodyAuthority(disk.owner);
        await authority.initialize();
        assert.equal(authority.getSnapshot().phase, 'locked');
        await authority.unlock(PASSWORD);
        const restartRuntime: KeyringRuntime = {
          ...disk.runtime,
          transfers: {
            ...disk.runtime.transfers!,
            async sign() {
              throw Error('RESTART_MUST_NOT_SIGN');
            },
            assertUnlocked() {
              throw Error('RESTART_MUST_NOT_AUTHORIZE');
            },
          },
        };
        const restored = await qualifyNativeNevmTransfer({
          phase: 'restart',
          authority,
          runtime: restartRuntime,
          storage: disk.storage,
          password: PASSWORD,
          expectedFourthAddress: derived[2],
          check,
        });
        assert.deepEqual(restored, {
          ...created,
          nevmRestoredFromJournal: true,
        });
        assert(
          matchesNevmRestartEvidence(createdReport, {
            ...createdReport,
            phase: 'restart',
            ...restored,
          })
        );
        assert.equal((await readSignedRecordEvidence(disk.storage)).raw, bundle.raw);
        assert.deepEqual(await rows(), older);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        assert.equal(authority.getSnapshot().account?.network, 'ethereum');
        assert.equal(await disk.storage.getWalletFingerprint(), fingerprint);
        assert(checks.includes('native NEVM chain 5700 signature and journal'));
        assert(
          checks.includes('native NEVM chain 5700 journal after cold restart')
        );
        if (scenario === 'import') {
          const restoreSelection = async () => {
            if (authority.getSnapshot().phase === 'locked') await authority.unlock(PASSWORD);
            if (authority.getSnapshot().account?.network !== 'ethereum')
              await authority.selectNetwork(
                'ethereum',
                authority.getSnapshot().revision,
                authority.getCatalogue()!.revision
              , () => {});
            await authority.manageAccounts(
              { kind: 'select', id: 'hd:60:1' },
              authority.getSnapshot().revision,
              authority.getCatalogue()!.revision
            );
          };
          const original = JSON.parse(bundle.raw!);
          const target = original.entries.findIndex((entry: { hash: string }) => entry.hash === container[1]!.hash);
          const corruptions = [
            { ...original, entries: original.entries.filter((_: unknown, index: number) => index !== target) },
            { ...original, entries: original.entries.map((entry: unknown, index: number) => index === target ? { ...container[1], chunks: original.entries[target].chunks, chainId: '999' } : entry) },
            { ...original, entries: original.entries.map((entry: unknown, index: number) => index === target ? { ...original.entries[target], chunks: original.entries[0].chunks } : entry) },
          ];
          const profile = (await disk.storage.recovery!.readIdentity())!.root!.profileId;
          for (const corrupt of corruptions) {
            await disk.replaceSigned(profile, JSON.stringify(corrupt));
            await assert.rejects(
              qualifyNativeNevmTransfer({
                phase: 'restart',
                authority,
                runtime: restartRuntime,
                storage: disk.storage,
                password: PASSWORD,
                expectedFourthAddress: derived[2],
                check,
              })
            );
            await disk.replaceSigned(profile, bundle.raw!);
            await restoreSelection();
            assert.deepEqual(await rows(), older);
          }
        }
        assert.equal(networkCalls, 0);
      } finally {
        await authority.dispose().catch(() => undefined);
        globalThis.fetch = originalFetch;
        await disk.close();
      }
    }
  );
}
