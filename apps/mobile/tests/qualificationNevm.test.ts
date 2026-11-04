import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import {
  nativeTransferJournalKey,
  type TransferJournalContainer,
} from '../src/custody/transferJournal.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC NEVM native qualification test password';
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
    `NEVM ${scenario} qualifier signs the same HD3 nonce on two chains and cold-restores exact bytes`,
    { timeout: 90000 },
    async () => {
      const disk = memoryDisk();
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
      const rows = () =>
        [0, 1, 2].map((index) =>
          JSON.stringify(disk.records.get(nativeTransferJournalKey(index)))
        );
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
        const older = rows();
        const fingerprint = await disk.storage.getWalletFingerprint();
        let signatures = 0;
        const realTransfer = disk.runtime.transfers!;
        const createRuntime: KeyringRuntime = {
          ...disk.runtime,
          transfers: {
            ...realTransfer,
            async sign(transaction, password, guard, intent) {
              signatures++;
              assert.equal(
                transaction.chainId,
                signatures === 1 ? '1' : '5700'
              );
              return realTransfer.sign(transaction, password, guard, intent);
            },
          },
        };
        const beforeInvalid = JSON.stringify([...disk.records]);
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
        assert.equal(JSON.stringify([...disk.records]), beforeInvalid);
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
        assert.deepEqual(rows(), older);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        assert.equal(authority.getSnapshot().account?.network, 'ethereum');
        const container = structuredClone(
          disk.records.get(nativeTransferJournalKey(3))
        ) as TransferJournalContainer;
        assert.equal(container.version, 1);
        assert.equal(container.entries.length, 2);
        for (const [index, network, value] of [
          [0, 'ethereum', 456n],
          [1, 'syscoin-nevm-testnet', 789n],
        ] as const) {
          const entry = container.entries[index]!;
          assert.deepEqual(entry.registration, { ...getNativeNetwork(network) });
          assert.equal(entry.phase, 'attempted');
          assert.equal(entry.nonce, 0);
          const signed = Transaction.from(entry.rawTransaction);
          assert(signed.isSigned());
          assert.equal(signed.from, created.nevmAddress);
          assert.equal(signed.chainId, network === 'ethereum' ? 1n : 5700n);
          assert.equal(signed.value, value);
          assert.equal(signed.nonce, 0);
          assert.equal(signed.gasLimit, 21000n);
          assert.equal(signed.maxFeePerGas, 3n);
          assert.equal(signed.maxPriorityFeePerGas, 1n);
        }
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
            container.entries[0]!.rawTransaction
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
            async authorize() {
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
        assert.deepEqual(
          disk.records.get(nativeTransferJournalKey(3)),
          container
        );
        assert.deepEqual(rows(), older);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        assert.equal(authority.getSnapshot().account?.network, 'ethereum');
        assert.equal(await disk.storage.getWalletFingerprint(), fingerprint);
        assert(checks.includes('native NEVM chain 5700 signature and journal'));
        assert(
          checks.includes('native NEVM chain 5700 journal after cold restart')
        );
        if (scenario === 'import') {
          const restoreSelection = async () => {
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
          };
          for (const corrupt of [
            { ...container, entries: container.entries.slice(0, 1) },
            {
              ...container,
              entries: [
                container.entries[0],
                {
                  ...container.entries[1],
                  registration: {
                    ...container.entries[1]!.registration,
                    rpcUrl: 'https://wrong.invalid',
                  },
                },
              ],
            },
            {
              ...container,
              entries: [
                container.entries[0],
                {
                  ...container.entries[1],
                  rawTransaction: container.entries[0]!.rawTransaction,
                },
              ],
            },
          ]) {
            disk.records.set(nativeTransferJournalKey(3), corrupt);
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
            disk.records.set(
              nativeTransferJournalKey(3),
              structuredClone(container)
            );
            await restoreSelection();
            assert.deepEqual(rows(), older);
          }
        }
        assert.equal(networkCalls, 0);
      } finally {
        await authority.dispose().catch(() => undefined);
        globalThis.fetch = originalFetch;
      }
    }
  );
}
