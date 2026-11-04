import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { HDNodeWallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { qualifyNativeHdAccounts } from '../qualification/hd-accounts.ts';
import { qualifyNativeErc20Transfer } from '../qualification/erc20-transfer.ts';
import { qualifyNativeNevmTransfer } from '../qualification/nevm-transfer.ts';
import {
  qualifyNativeZksysTransfer,
  isZksysQualificationReport,
  matchesZksysRestartEvidence,
} from '../qualification/zksys-transfer.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import {
  nativeTransferJournalKey,
  type TransferJournalContainer,
} from '../src/custody/transferJournal.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC zkSYS native qualification password';
const FIFTH_ADDRESS = '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
const evidence = (phase: 'create' | 'restart') => ({
  status: 'passed',
  phase,
  scenario: 'import',
  networkCalls: 0,
  fingerprint: 'f'.repeat(64),
  address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
  erc20Address: '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
  nevmAddress: '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E',
  transferHash: '0x' + '1'.repeat(64),
  firstTransferHash: '0x' + '2'.repeat(64),
  erc20TransferHash: '0x' + '3'.repeat(64),
  nevmTransferHash: '0x' + '4'.repeat(64),
  nevmEthereumTransferHash: '0x' + '5'.repeat(64),
  zksysTransferHash: '0x' + '6'.repeat(64),
  nativeZksysVerified: true,
  zksysAccountId: 'hd:60:4',
  zksysAccountIndex: 4,
  zksysAddress: FIFTH_ADDRESS,
  zksysChainId: '57057',
  zksysJournalContainerVersion: 2,
  zksysSignatures: phase === 'create' ? 1 : 0,
  zksysAuthorizations: phase === 'create' ? 0 : 1,
  zksysInjectedBroadcasts: 1,
  zksysFeeEstimates: phase === 'create' ? 2 : 0,
  zksysRestoredFromJournal: phase === 'restart',
});

test('zkSYS report rejects missing, forged or cross-phase evidence', () => {
  assert(isZksysQualificationReport(evidence('create')));
  assert(matchesZksysRestartEvidence(evidence('create'), evidence('restart')));
  const fields = Object.keys(evidence('create')).filter(
    (k) => k.startsWith('zksys') || k === 'nativeZksysVerified'
  );
  for (const field of fields) {
    const missing = { ...evidence('create') } as Record<string, unknown>;
    delete missing[field];
    assert.equal(isZksysQualificationReport(missing), false);
    assert.equal(
      isZksysQualificationReport({ status: 'failed', [field]: true }),
      false
    );
  }
  for (const change of [
    { zksysAccountId: 'hd:60:3' },
    { zksysAccountIndex: 3 },
    { zksysChainId: 57057 },
    { zksysAddress: evidence('create').nevmAddress },
    { zksysAddress: 'invalid' },
    { zksysTransferHash: evidence('create').nevmTransferHash },
    { zksysTransferHash: '0x1' },
    { zksysSignatures: 1 },
    { zksysAuthorizations: 0 },
    { zksysFeeEstimates: 2 },
    { zksysInjectedBroadcasts: 0 },
    { zksysRestoredFromJournal: false },
    { phase: ['restart'] },
    { scenario: ['import'] },
    { networkCalls: 1 },
    { fingerprint: 'e'.repeat(64) },
  ])
    assert.equal(
      matchesZksysRestartEvidence(evidence('create'), {
        ...evidence('restart'),
        ...change,
      }),
      false
    );
  assert.equal(isZksysQualificationReport({ status: 'failed' }), true);
  assert.equal(matchesZksysRestartEvidence({}, {}), false);
});
function memoryDisk() {
  const records = new Map<string, unknown>();
  let confirmation: string | undefined;
  let storage!: OpenWalletStorage;
  let runtime!: KeyringRuntime;
  const fingerprint = () =>
    createHash('sha256')
      .update(JSON.stringify([records.get('vault'), records.get('vault-keys')]))
      .digest('hex');
  const factory = createKeyringRuntimeFactory({
    ensureCryptoReady: async () => {
      assert(globalThis.crypto.subtle);
    },
    async openStorage() {
      storage = {
        keyringStorage: {
          async get(key) {
            return records.has(key)
              ? structuredClone(records.get(key))
              : undefined;
          },
          async set(key, value) {
            records.set(key, structuredClone(value));
          },
          async deleteItem(key) {
            records.delete(key);
          },
          async createManyIfAbsent(values) {
            if (Object.keys(values).some((key) => records.has(key)))
              return false;
            for (const [key, value] of Object.entries(values))
              records.set(key, structuredClone(value));
            return true;
          },
          async compareAndSet(key, expected, value, removals = {}) {
            if (
              !records.has(key) ||
              JSON.stringify(records.get(key)) !== JSON.stringify(expected) ||
              Object.entries(removals).some(
                ([name, before]) =>
                  JSON.stringify(records.get(name)) !== JSON.stringify(before)
              )
            )
              return false;
            records.set(key, structuredClone(value));
            for (const name of Object.keys(removals)) records.delete(name);
            return true;
          },
        },
        authGuard: {
          async checkAllowed() {},
          async recordFailure() {},
          async recordSuccess() {},
        },
        async readState() {
          assert.equal(records.has('vault'), records.has('vault-keys'));
          return records.has('vault')
            ? {
                presence: 'existing',
                backup:
                  confirmation === fingerprint() ? 'confirmed' : 'unconfirmed',
              }
            : { presence: 'empty', backup: 'unconfirmed' };
        },
        async getWalletFingerprint() {
          assert(records.has('vault'));
          return fingerprint();
        },
        async confirmBackup(expected) {
          assert.equal(expected, fingerprint());
          confirmation = expected;
        },
        async close() {},
      };
      return storage;
    },
  });
  return {
    records,
    get runtime() {
      return runtime;
    },
    get storage() {
      return storage;
    },
    owner: {
      async open() {
        runtime = (await factory.open()) as KeyringRuntime;
        return runtime;
      },
    },
  };
}

for (const scenario of ['import', 'generate'] as const) {
  test(
    `zkSYS ${scenario} uses the installed SDK and exact-fee controller, preserving all prior journals across restart`,
    { timeout: 120000 },
    async () => {
      const disk = memoryDisk();
      let authority = new NativeCustodyAuthority(disk.owner);
      const originalFetch = globalThis.fetch;
      let networkCalls = 0;
      globalThis.fetch = (() => {
        networkCalls++;
        throw Error('NETWORK_FORBIDDEN');
      }) as typeof fetch;
      const check = async <T>(_name: string, work: () => Promise<T>) => work();
      const rows = () =>
        [0, 1, 2, 3].map((i) =>
          JSON.stringify(disk.records.get(nativeTransferJournalKey(i)))
        );
      try {
        await authority.initialize();
        if (scenario === 'import')
          await authority.importPhrase(PHRASE, PASSWORD);
        else await authority.create(PASSWORD);
        const words = await disk.runtime.backup.readPhrase(PASSWORD);
        const derived = [1, 2, 3, 4].map(
          (index) =>
            HDNodeWallet.fromPhrase(
              words.join(' '),
              undefined,
              `m/44'/60'/0'/0/${index}`
            ).address
        );
        if (scenario === 'import') assert.equal(derived[3], FIFTH_ADDRESS);
        await disk.runtime.backup.confirm(
          await disk.runtime.backup.fingerprint()
        );
        await authority.refreshAuthenticatedMetadata();
        const options = () => ({
          authority,
          runtime: disk.runtime,
          storage: disk.storage,
          password: PASSWORD,
          check,
        });
        const hd = await qualifyNativeHdAccounts({
          ...options(),
          phase: 'create',
          expectedSecondAddress: derived[0],
        });
        const erc20 = await qualifyNativeErc20Transfer({
          ...options(),
          phase: 'create',
          expectedThirdAddress: derived[1],
        });
        const nevm = await qualifyNativeNevmTransfer({
          ...options(),
          phase: 'create',
          expectedFourthAddress: derived[2],
        });
        const older = rows();
        const beforeInvalid = JSON.stringify([...disk.records]);
        await assert.rejects(
          qualifyNativeZksysTransfer({
            ...options(),
            phase: 'create',
            expectedFifthAddress: ['invalid'] as any,
          }),
          /QUALIFICATION_ZKSYS_ASSERTION_FAILED/
        );
        assert.equal(JSON.stringify([...disk.records]), beforeInvalid);
        const created = await qualifyNativeZksysTransfer({
          ...options(),
          phase: 'create',
          expectedFifthAddress: derived[3],
        });
        assert.deepEqual(rows(), older);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        assert.equal(authority.getSnapshot().account?.network, 'ethereum');
        const stored = structuredClone(
          disk.records.get(nativeTransferJournalKey(4))
        ) as TransferJournalContainer;
        assert.equal(stored.entries.length, 1);
        const signed = Transaction.from(stored.entries[0]!.rawTransaction);
        assert.equal(signed.chainId, 57057n);
        assert.equal(signed.nonce, 0);
        assert.equal(signed.maxPriorityFeePerGas, 0n);
        assert.equal(signed.maxFeePerGas, 20n);
        assert.equal(signed.gasLimit, 36000n);
        assert.equal(signed.value, 789n);
        assert.equal(stored.entries[0]!.phase, 'attempted');
        const fingerprint = await disk.storage.getWalletFingerprint();
        const firstReport = {
          status: 'passed',
          phase: 'create',
          scenario,
          networkCalls,
          fingerprint,
          ...hd,
          ...erc20,
          ...nevm,
          ...created,
        };
        assert(isZksysQualificationReport(firstReport));
        assert(!JSON.stringify(firstReport).includes(words.join(' ')));
        assert(!JSON.stringify(firstReport).includes(PASSWORD));
        assert(
          !JSON.stringify(firstReport).includes(
            stored.entries[0]!.rawTransaction
          )
        );
        await authority.dispose();
        authority = new NativeCustodyAuthority(disk.owner);
        await authority.initialize();
        await authority.unlock(PASSWORD);
        const hdAgain = await qualifyNativeHdAccounts({
          ...options(),
          phase: 'restart',
          expectedSecondAddress: derived[0],
          expectedRestartAddress: hd.address,
        });
        const erc20Again = await qualifyNativeErc20Transfer({
          ...options(),
          phase: 'restart',
          expectedThirdAddress: derived[1],
        });
        const nevmAgain = await qualifyNativeNevmTransfer({
          ...options(),
          phase: 'restart',
          expectedFourthAddress: derived[2],
        });
        const oldAfterEarlierRetries = rows();
        const noSignRuntime: KeyringRuntime = {
          ...disk.runtime,
          transfers: {
            ...disk.runtime.transfers!,
            async sign() {
              throw Error('RESTART_MUST_NOT_SIGN');
            },
          },
        };
        if (scenario === 'import') {
          disk.records.set(nativeTransferJournalKey(4), {
            ...stored,
            entries: [],
          });
          await assert.rejects(
            qualifyNativeZksysTransfer({
              ...options(),
              runtime: noSignRuntime,
              phase: 'restart',
              expectedFifthAddress: derived[3],
            })
          );
          disk.records.set(
            nativeTransferJournalKey(4),
            structuredClone(stored)
          );
          if (authority.getSnapshot().account?.network !== 'ethereum')
            await authority.selectNetwork(
              'ethereum',
              authority.getSnapshot().revision,
              authority.getCatalogue()!.revision
            );
          await authority.manageAccounts(
            { kind: 'select', id: 'hd:60:1' },
            authority.getSnapshot().revision,
            authority.getCatalogue()!.revision
          );
        }
        const restored = await qualifyNativeZksysTransfer({
          ...options(),
          runtime: noSignRuntime,
          phase: 'restart',
          expectedFifthAddress: scenario === 'import' ? derived[3] : undefined,
        });
        assert.equal(restored.zksysSignatures, 0);
        assert.equal(restored.zksysAuthorizations, 1);
        assert.equal(restored.zksysFeeEstimates, 0);
        assert.equal(restored.zksysTransferHash, created.zksysTransferHash);
        const after = disk.records.get(
          nativeTransferJournalKey(4)
        ) as TransferJournalContainer;
        assert.equal(
          after.entries[0]!.rawTransaction,
          stored.entries[0]!.rawTransaction
        );
        assert.equal(after.entries[0]!.phase, 'submitted');
        assert.deepEqual(rows(), oldAfterEarlierRetries);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        assert.equal(authority.getSnapshot().account?.network, 'ethereum');
        assert(
          matchesZksysRestartEvidence(firstReport, {
            status: 'passed',
            phase: 'restart',
            scenario,
            networkCalls,
            fingerprint,
            ...hdAgain,
            ...erc20Again,
            ...nevmAgain,
            ...restored,
          })
        );
        assert.equal(networkCalls, 0);
      } finally {
        await authority.dispose().catch(() => undefined);
        globalThis.fetch = originalFetch;
      }
    }
  );
}
