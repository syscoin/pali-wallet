import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HDNodeWallet } from 'ethers/wallet';
import {
  qualifyNativeHdAccounts,
  matchesHdRestartEvidence,
} from '../qualification/hd-accounts.ts';
import {
  qualifyNativeErc20Transfer,
  isErc20QualificationReport,
  matchesErc20RestartEvidence,
} from '../qualification/erc20-transfer.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import {
  nativeTransferJournalKey,
  type TransferJournalContainer,
} from '../src/custody/transferJournal.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC ERC20 native qualification test password!';
const report = (phase: 'create' | 'restart') => ({
  status: 'passed',
  phase,
  scenario: 'import',
  networkCalls: 0,
  fingerprint: 'f'.repeat(64),
  address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
  transferHash: '0x' + 'a'.repeat(64),
  firstTransferHash: '0x' + 'b'.repeat(64),
  nativeErc20Verified: true,
  erc20AccountId: 'hd:60:2',
  erc20AccountIndex: 2,
  erc20Address: '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
  erc20TransferHash: '0x' + 'c'.repeat(64),
  erc20IntentHash: '0x' + 'd'.repeat(64),
  erc20Signatures: phase === 'create' ? 1 : 0,
  erc20Authorizations: phase === 'create' ? 0 : 1,
  erc20InjectedBroadcasts: 1,
  erc20RestoredFromJournal: phase === 'restart',
});

test('ERC20 qualification reports require complete positive evidence and exact restart identity', () => {
  assert(isErc20QualificationReport(report('create')));
  assert(matchesErc20RestartEvidence(report('create'), report('restart')));
  for (const change of [
    { nativeErc20Verified: false },
    { erc20AccountId: 'hd:60:1' },
    { erc20AccountIndex: 1 },
    { erc20Address: report('create').address },
    { erc20TransferHash: report('create').transferHash },
    { erc20TransferHash: '0x123' },
    { erc20Signatures: 1 },
    { erc20Authorizations: 0 },
    { erc20InjectedBroadcasts: 2 },
    { erc20RestoredFromJournal: false },
    { erc20IntentHash: '0x' + 'e'.repeat(64) },
    { fingerprint: 'e'.repeat(64) },
    { phase: 'create' },
    { scenario: 'generate' },
    { networkCalls: 1 },
  ])
    assert.equal(
      matchesErc20RestartEvidence(report('create'), {
        ...report('restart'),
        ...change,
      }),
      false
    );
  for (const field of [
    'nativeErc20Verified',
    'erc20AccountId',
    'erc20AccountIndex',
    'erc20Address',
    'erc20TransferHash',
    'erc20IntentHash',
    'erc20Signatures',
    'erc20Authorizations',
    'erc20InjectedBroadcasts',
    'erc20RestoredFromJournal',
  ]) {
    const missing = { ...report('create') } as Record<string, unknown>;
    delete missing[field];
    assert.equal(isErc20QualificationReport(missing), false);
    assert.equal(
      isErc20QualificationReport({
        status: 'failed',
        [field]: report('create')[field as keyof ReturnType<typeof report>],
      }),
      false
    );
  }
  assert.equal(isErc20QualificationReport({ status: 'failed' }), true);
  assert.equal(
    matchesErc20RestartEvidence(
      {
        status: 'failed',
        phase: 'create',
        scenario: 'import',
        fingerprint: 'f'.repeat(64),
      },
      {
        status: 'failed',
        phase: 'restart',
        scenario: 'import',
        fingerprint: 'f'.repeat(64),
      }
    ),
    false
  );
});

for (const scenario of ['import', 'generate'] as const)
  test(
    `native ERC20 ${scenario} helper uses real SDK/SQL storage, preserves HD0/1 and retries HD2 without signing again`,
    { timeout: 90000 },
    async () => {
      const directory = await mkdtemp(
        path.join(tmpdir(), 'pali-erc20-qualification-')
      );
      const file = path.join(directory, 'wallet.sqlite');
      let initialized = false;
      let runtime!: KeyringRuntime;
      let storage!: SqliteWalletStorage;
      const factory = createKeyringRuntimeFactory({
        ensureCryptoReady: async () => undefined,
        openStorage: async () => {
          storage = await SqliteWalletStorage.open(
            nodeConnection(file).connection,
            digest,
            INSTALLATION,
            !initialized
          );
          initialized = true;
          return storage;
        },
      });
      const owner = {
        open: async () => {
          runtime = (await factory.open()) as KeyringRuntime;
          return runtime;
        },
      };
      let authority = new NativeCustodyAuthority(owner);
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
      try {
        await authority.initialize();
        if (scenario === 'import')
          await authority.importPhrase(PHRASE, PASSWORD);
        else await authority.create(PASSWORD);
        const words = await runtime.backup.readPhrase(PASSWORD);
        const expectedSecondAddress = HDNodeWallet.fromPhrase(
          words.join(' '),
          undefined,
          "m/44'/60'/0'/0/1"
        ).address;
        const expectedThirdAddress = HDNodeWallet.fromPhrase(
          words.join(' '),
          undefined,
          "m/44'/60'/0'/0/2"
        ).address;
        await runtime.backup.confirm(await runtime.backup.fingerprint());
        await authority.refreshAuthenticatedMetadata();
        const fingerprint = await storage.getWalletFingerprint();
        const hdCreated = await qualifyNativeHdAccounts({
          phase: 'create',
          authority,
          runtime,
          storage,
          password: PASSWORD,
          expectedSecondAddress,
          check,
        });
        const created = await qualifyNativeErc20Transfer({
          phase: 'create',
          authority,
          runtime,
          storage,
          password: PASSWORD,
          expectedThirdAddress,
          check,
        });
        assert.equal(created.erc20Address, expectedThirdAddress);
        assert.equal(created.erc20Signatures, 1);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        const readRows = async () =>
          Promise.all(
            [0, 1, 2].map(
              async (index) =>
                (await storage.keyringStorage.get(
                  nativeTransferJournalKey(index)
                )) as TransferJournalContainer
            )
          );
        const before = await readRows();
        assert.equal(before[0]!.entries[0]!.phase, 'attempted');
        assert.equal(before[1]!.entries[0]!.phase, 'attempted');
        assert.equal(before[2]!.entries[0]!.phase, 'attempted');
        assert.equal(before[2]!.entries[0]!.intent!.token.decimals, 6);
        await authority.dispose();
        authority = new NativeCustodyAuthority(owner);
        await authority.initialize();
        await authority.unlock(PASSWORD);
        const hdRestored = await qualifyNativeHdAccounts({
          phase: 'restart',
          authority,
          runtime,
          storage,
          password: PASSWORD,
          expectedSecondAddress,
          expectedRestartAddress: hdCreated.address,
          check,
        });
        const restored = await qualifyNativeErc20Transfer({
          phase: 'restart',
          authority,
          runtime,
          storage,
          password: PASSWORD,
          expectedThirdAddress,
          check,
        });
        assert.equal(restored.erc20Signatures, 0);
        assert.equal(restored.erc20Authorizations, 1);
        assert.equal(authority.getCatalogue()?.active.accountId, 'hd:60:1');
        const after = await readRows();
        assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
        assert.equal(
          after[2]!.entries[0]!.rawTransaction,
          before[2]!.entries[0]!.rawTransaction
        );
        assert.equal(after[2]!.entries[0]!.phase, 'submitted');
        const createdReport = {
          status: 'passed',
          phase: 'create',
          scenario,
          networkCalls,
          fingerprint,
          ...hdCreated,
          ...created,
        };
        const restoredReport = {
          status: 'passed',
          phase: 'restart',
          scenario,
          networkCalls,
          fingerprint,
          ...hdRestored,
          ...restored,
        };
        assert(matchesHdRestartEvidence(createdReport, restoredReport));
        assert(matchesErc20RestartEvidence(createdReport, restoredReport));
        assert.equal(networkCalls, 0);
        assert.equal(await storage.getWalletFingerprint(), fingerprint);
        assert(!JSON.stringify(createdReport).includes(PHRASE));
        assert(!JSON.stringify(createdReport).includes(PASSWORD));
        assert(
          checks.includes(
            'native first-account prepared signature and durable container'
          )
        );
        assert(
          checks.includes(
            'native selected-HD identity and journal after cold restart'
          )
        );
        assert(
          checks.includes(
            'native ERC20 sign persist and lost injected response'
          )
        );
        assert(
          checks.includes(
            'native ERC20 cold restart intent and exact-byte authorized retry'
          )
        );
      } finally {
        await authority.dispose().catch(() => undefined);
        globalThis.fetch = originalFetch;
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
