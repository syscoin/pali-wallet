import { createTestPrivateAuthentication, readTestNoteInventory, testInventoryAuthentication } from './fixtures/privateAuthentication.ts';
import { createPrivateVaultSession } from '../../../source/wallet/privateVault.ts';
import { createTestPinRecordKeyring } from './fixtures/pinOperation.ts';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { WalletStorageError } from '../src/storage/types.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  type SqlHook,
} from './storageHelpers.ts';
import type { createNativePrivacyPoolSync } from '../src/privacy/nativePrivacyPoolSync.ts';
import type { IPrivateNoteStatus } from '../../../source/utils/privacy/privateVaultTypes.ts';
import { PRIVACY_RELAYER_SOURCE } from '../../../source/utils/privacy/relayers.ts';
import { getPrivacyPool } from '../../../source/utils/privacy/registry.ts';
import { identifyClassicNote } from '../../../source/utils/privacy/note.ts';
import { createNativePrivacyServiceSettings } from '../src/platform/privacyServiceSettings.native.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { PRIVACY_SERVICE_ORIGIN_STORAGE_KEY } from '../../../source/shared/privacyServiceOrigin.ts';
import { createNoteBackupCodec } from '../../../source/wallet/noteBackup.ts';
import { readPrivateVaultBundle } from '../../../source/wallet/privateVaultInspection.ts';

const pinCredential = createTestPinCredentialPort();

const sdk = await loadNativeKeyringSdk();
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = '123456';
const noop = () => undefined;
const depositAbi = new Interface([
  'function deposit(bytes32) payable',
  'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)',
  'event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)',
]);
const RECIPIENT = '0x' + '12'.repeat(20);

async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-private-deposit-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage!: SqliteWalletStorage;
  let initialized = false;
  let privacySettings: ReturnType<typeof createNativePrivacyServiceSettings>;
  let runtime!: KeyringRuntime;
  let keyring!: InstanceType<typeof sdk.HostKeyring>;
  let privateState!: () => {
    activeAccount: { id: number; type: string };
    accounts: Record<string, Record<number, Record<string, unknown>>>;
  };
  class ObservedKeyring extends sdk.HostKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...args);
      keyring = this;
      const setState = this.setVaultStateGetter;
      this.setVaultStateGetter = (read) => {
        privateState = read;
        setState(read);
      };
    }
  }
  let nonce = 0;
  let proofs = 0;
  let proofGate: (() => Promise<void>) | undefined;
  let badProof = false;
  const rpcMethods: string[] = [];
  let beforeResponse: () => Promise<void> = async () => undefined;
  let lost = false;
  let failPoolDispose = false;
  let completionReads = false, completionReverted = false;
  let noteStatus: IPrivateNoteStatus = { phase: 'waiting' };
  const posted: string[] = [];
  const relayedPosts: unknown[] = [];
  const poolReads: string[] = [];
  let opened = 0,
    disposed = 0,
    refreshes = 0;
  const connectionFetch: typeof fetch = async (_url, init) => {
    if (String(_url).startsWith('https://relay.example/')) {
      relayedPosts.push(JSON.parse(String(init?.body)));
      if (lost) throw Error('synthetic relayer response lost');
      return new Response(
        JSON.stringify({ id: '00000000-0000-4000-8000-000000000088' }),
        { headers: { 'content-type': 'application/json' } }
      );
    }
    const { id, method, params } = JSON.parse(String(init?.body));
    rpcMethods.push(method);
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getBlockByNumber')
      result = {
        number: '0x10',
        hash: '0x' + 'aa'.repeat(32),
        gasLimit: '0x1c9c380',
        baseFeePerGas: '0x2',
      };
    else if (completionReads && (method === 'eth_getTransactionReceipt' || method === 'eth_getTransactionByHash')) {
      const transaction = posted.map(raw => Transaction.from(raw)).find(tx => tx.hash === params[0]);
      assert(transaction);
      const shared = { to: transaction.to, value: '0x' + transaction.value.toString(16), chainId: '0x1', input: transaction.data, hash: transaction.hash, blockNumber: '0x10', blockHash: '0x' + 'aa'.repeat(32), from: transaction.from, nonce: '0x' + transaction.nonce.toString(16) };
      const action = depositAbi.parseTransaction({ data: transaction.data })!;
      const event = action.name === 'withdraw' ? depositAbi.encodeEventLog(depositAbi.getEvent('Withdrawal')!, [action.args[3], action.args[2], action.args[4], action.args[5]]) : null;
      result = method === 'eth_getTransactionByHash' ? shared : { transactionHash: transaction.hash, blockHash: shared.blockHash, blockNumber: shared.blockNumber, status: completionReverted && action.name === 'withdraw' ? '0x0' : '0x1', logs: event ? [{ address: transaction.to, transactionHash: transaction.hash, blockHash: shared.blockHash, blockNumber: shared.blockNumber, removed: false, ...event }] : [] };
    }
    else if (completionReads && method === 'eth_call') result = '0x' + '00'.repeat(32);
    else if (method === 'eth_getTransactionCount')
      result = '0x' + nonce.toString(16);
    else if (method === 'eth_getBalance') result = '0x56bc75e2d63100000';
    else if (method === 'eth_gasPrice') result = '0x5';
    else if (method === 'eth_maxPriorityFeePerGas') result = '0x1';
    else if (method === 'eth_estimateGas') result = '0x186a0';
    else if (method === 'eth_sendRawTransaction') {
      const raw = params[0] as string;
      const transaction = Transaction.from(raw);
      assert.equal(
        transaction.to?.toLowerCase(),
        getPrivacyPool('eth-1').address
      );
      const action = depositAbi.parseTransaction({
        data: transaction.data,
      })!.name;
      const saved = await storage.signedRecords.read(
        (await storage.recovery.readIdentity())!.root!.profileId
      );
      assert(saved);
      const entry = JSON.parse(saved).entries.find(
        (entry: any) => entry.hash === transaction.hash
      );
      assert(entry);
      if (action === 'deposit') {
        assert.equal(transaction.value, 10n ** 18n);
        assert(entry.metadata.privateDeposit);
      } else {
        assert.equal(action, 'withdraw');
        assert.equal(transaction.gasLimit, 650000n);
        assert.equal(transaction.value, 0n);
        assert(entry.metadata.privateWithdrawal);
      }
      nonce++;
      posted.push(raw);
      await beforeResponse();
      if (lost) throw Error('synthetic response lost');
      result = transaction.hash;
    } else throw Error(`Unexpected RPC ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const factory = createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (_request, _signal, check, verify) => { check(); const result = await verify({ method: 'pin', pin: PASSWORD }, check); if (!result.accepted) throw Error(result.reason); }, privacyServiceSettings: { getOrigin: () => privacySettings.getOrigin(), changeOrigin: (...args) => privacySettings.changeOrigin(...args) }, slhExecution: null,
    readEvmRetirement: null,
    ensureCryptoReady: async () => undefined,
    loadSdk: async () => ({ ...sdk, HostKeyring: ObservedKeyring }),
    connectionFetch,
    async openPrivacyWithdrawal(_signal, guard) {
      return {
        fetcher: connectionFetch,
        relayers: {
          assertSelectionCurrent: guard,
          async getDirectory() {
            return {
              asOfBlockHash: '0x' + 'ab'.repeat(32),
              asOfBlockNumber: 16,
              asOfBlockTimestamp: 1000,
              candidateCount: 1,
              chainId: 1,
              observedAt: 1000,
              source: PRIVACY_RELAYER_SOURCE,
              state: 'ready',
              unavailableEntries: 0,
              version: 1,
              relayers: [
                {
                  ensHash: '0x' + '33'.repeat(32),
                  ensName: 'fixture.eth',
                  owner: '0x' + '44'.repeat(20),
                  registryBalance: '1',
                  advertisedServiceFeePercent: '0.1',
                  health: 'reported-healthy',
                  supportedPools: ['eth-1'],
                },
              ],
            };
          },
          async checkRelayer(directory, ensHash, poolId) {
            guard();
            return {
              advertisedQueueLength: 0,
              advertisedServiceFeePercent: '0.1',
              directory,
              endpoint: 'https://relay.example',
              ensHash,
              observedAt: 1000,
              poolId,
              rewardAccount: '0x' + '44'.repeat(20),
              version: '4',
            };
          },
        },
        async prove(request, options) {
          proofs++;
          options.assertCurrent();
          options.assertSnapshotCurrent(request.snapshot);
          await proofGate?.();
          options.assertCurrent();
          return {
            proof: '0x' + '01'.repeat(256),
            publicSignals: [
              request.snapshot.root,
              (
                await import('../../../source/utils/privacy/note.ts')
              ).identifyClassicNote(request.note).nullifierHash,
              request.recipient,
              request.relayer,
              request.fee,
              request.refund,
            ]
              .map((value) => BigInt(value).toString())
              .map((value, index) => (badProof && index === 0 ? '99' : value)),
          };
        },
      };
    },
    async openPrivacyPool(_network, poolId, signal, check) {
      check();
      opened++;
      return {
        getStatus() {
          check();
          return { poolId, phase: 'idle' };
        },
        async refresh() {
          check();
          assert(!signal.aborted);
          refreshes++;
          return { poolId, phase: 'ready' };
        },
        async readNote(identity: { poolId: string }) {
          check();
          assert(!signal.aborted);
          assert.equal(identity.poolId, poolId);
          poolReads.push(poolId);
          return noteStatus;
        },
        async readSnapshot(id: string) {
          check();
          assert.equal(id, poolId);
          const snapshot = { poolId, root: '0x' + '11'.repeat(32) };
          return {
            snapshot,
            assertSnapshotCurrent(value: unknown) {
              check();
              assert.equal(value, snapshot);
            },
            async getPath() {
              check();
              return { pathElements: [], pathIndices: [] };
            },
          };
        },
        async dispose() {
          disposed++;
          if (failPoolDispose) throw Error('synthetic pool cleanup failure');
        },
      } as unknown as ReturnType<typeof createNativePrivacyPoolSync>;
    },
    async openStorage() {
      storage = await SqliteWalletStorage.open(
        nodeConnection(file, hooks).connection,
        digest,
        INSTALLATION,
        !initialized
      );
      initialized = true;
      privacySettings = createNativePrivacyServiceSettings(storage.keyringStorage);
      return storage;
    },
  });
  runtime = (await factory.open()) as KeyringRuntime;
  await runtime.session.importWallet(PHRASE, PASSWORD);
  return {
    get runtime() {
      return runtime;
    },
    get storage() {
      return storage;
    },
    enableCompletionReads(reverted = false) { completionReads = true; completionReverted = reverted; },
    markUnsupported(
      flag: 'isLedgerWallet' | 'isTrezorWallet' | 'isSmartAccount'
    ) {
      const current = privateState();
      current.accounts[current.activeAccount.type]![current.activeAccount.id]![
        flag
      ] = true;
    },
    posted,
    rpcMethods,
    relayedPosts,
    poolReads,
    get proofs() {
      return proofs;
    },
    holdProof(fn: () => Promise<void>) {
      proofGate = fn;
    },
    badProof() {
      badProof = true;
    },
    async seed() {
      const signal = new AbortController();
      const deposit = await runtime.openPrivateDeposit!(signal.signal, noop, createTestPrivateAuthentication(noop));
      await deposit.prepare({ poolId: 'eth-1' });
      await deposit.confirm(deposit.getSnapshot().review!.intentId);
      assert.equal(deposit.getSnapshot().phase, 'submitted');
      await deposit.dispose();
      noteStatus = { phase: 'verified' };
      return readTestNoteInventory(runtime, noop);
    },

    beforeResponse(callback: () => Promise<void>) {
      beforeResponse = callback;
    },
    async privateNotes() {
      const [row] = await storage.notes!.read();
      assert(row);
      return (
        await readPrivateVaultBundle(
          row.value,
          createPrivateVaultSession({
            generation: 0,
            keyring: createTestPinRecordKeyring(storage.pin, pinCredential, keyring, () => PASSWORD, () => { assert(keyring.hasPublicSession()); }),
            assertCurrent() {
              assert(keyring.hasPublicSession());
            },
          }),
          undefined,
          'serialized'
        )
      ).manifest.notes;
    },
    async reopen() {
      await runtime.storage.close();
      runtime = (await factory.open()) as KeyringRuntime;
      await runtime.session.unlock(PASSWORD);
    },
    async restore() {
      const backupPassword = 'Private note backup fixture';
      const codec = createNoteBackupCodec({
        crypto: globalThis.crypto,
        assertCurrent: noop,
      });
      const bytes = await codec.encrypt(
        {
          format: 'pali-private-notes',
          version: 1,
          createdAt: 20,
          notes: [
            { note: `tornado-eth-1-1-0x${'02'.repeat(62)}`, createdAt: 10 },
          ],
        },
        backupPassword
      );
      const backup = await runtime.openNoteBackup!(noop, createTestPrivateAuthentication(noop));
      const id = backup.begin();
      await backup.prepareImport(id, bytes, backupPassword);
      await backup.commitImport(id, PASSWORD);
      noteStatus = { phase: 'verified' };
      return readTestNoteInventory(runtime, noop);
    },
    async select(id: string) {
      const accounts = runtime.accounts!;
      await accounts
        .reserve({ kind: 'select', id }, accounts.getSnapshot()!.revision)
        .execute(noop);
    },
    async addAccount() {
      const accounts = runtime.accounts!;
      await accounts
        .reserve(
          { kind: 'create', label: 'Second',},
          accounts.getSnapshot()!.revision
        )
        .execute(noop);
    },
    get opened() {
      return opened;
    },
    get disposed() {
      return disposed;
    },
    get refreshes() {
      return refreshes;
    },
    failPoolCleanup() {
      failPoolDispose = true;
    },
    loseResponse(value: boolean) {
      lost = value;
    },
    setStatus(value: IPrivateNoteStatus) {
      noteStatus = value;
    },
    async close() {
      try {
        await runtime.storage.close();
      } catch {
        /* A poisoned fixture owner must be reopened. */
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

test('native saved-note withdrawal binds exact fixed-gas SDK bytes and never estimates private calldata', async () => {
  const f = await fixture();
  try {
    const inventory = await f.seed();
    const initialCalls = f.rpcMethods.length;
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(model.getSnapshot().phase, 'review');
    assert.equal(f.posted.length, 1);
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(model.getSnapshot().phase, 'submitted');
    assert.equal(f.posted.length, 2);
    const transaction = Transaction.from(f.posted[1]!);
    const call = depositAbi.parseTransaction({ data: transaction.data })!;
    assert.equal(call.args[3].toLowerCase(), RECIPIENT);
    assert.equal(
      transaction.from?.toLowerCase(),
      model.getSnapshot().review!.account.address.toLowerCase()
    );
    assert.equal(transaction.gasLimit, 650000n);
    assert.equal(
      f.rpcMethods.slice(initialCalls).includes('eth_estimateGas'),
      false
    );
    assert.equal(f.rpcMethods.slice(initialCalls).includes('eth_call'), false);
    assert.equal((await f.privateNotes())[0]!.withdrawal?.phase, 'submitted');
    await model.dispose();
  } finally {
    await f.close();
  }
});

test('inventory rejects a forged saved-note row before proving', async () => {
  const f = await fixture();
  try {
    const inventory = await f.seed();
    await assert.rejects(
      inventory.openWithdrawal!(
        { ...inventory.notes[0]! },
        new AbortController().signal,
        noop
      , testInventoryAuthentication(inventory))
    );
    assert.equal(f.proofs, 0);
    assert.equal(f.posted.length, 1);
  } finally {
    await f.close();
  }
});

test('changed proof public signals cannot create a review or retained withdrawal', async () => {
  const f = await fixture();
  try {
    const inventory = await f.seed();
    f.badProof();
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(model.getSnapshot().phase, 'failed');
    assert.equal(f.posted.length, 1);
    assert.equal((await f.privateNotes())[0]!.withdrawal, undefined);
    await model.dispose();
  } finally {
    await f.close();
  }
});

test('unknown withdrawal preserves the signed transaction and note reservation for explicit recovery', async () => {
  const f = await fixture();
  try {
    const inventory = await f.seed();
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    f.loseResponse(true);
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(model.getSnapshot().phase, 'unknown');
    assert.match(
      model.getSnapshot().result!.signedTransactionHash!,
      /^0x[0-9a-f]{64}$/
    );
    assert.equal((await f.privateNotes())[0]!.withdrawal?.phase, 'unknown');
    await model.dispose();
    await f.reopen();
    const reopened = await readTestNoteInventory(f.runtime, noop);
    const resumed = await reopened.openWithdrawal!(
      reopened.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(reopened));
    assert.equal(resumed.getSnapshot().status?.phase, 'unknown');
    await resumed.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(resumed.getSnapshot().phase, 'failed');
    assert.equal(f.posted.length, 2);
    await resumed.dispose();
  } finally {
    await f.close();
  }
});

test('cancel during held proof drains the runtime before returning to inventory', async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    const inventory = await f.seed();
    f.holdProof(async () => {
      entered();
      await gate;
    });
    const lifetime = new AbortController();
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      lifetime.signal,
      noop
    , testInventoryAuthentication(inventory));
    const preparing = model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    await started;
    lifetime.abort();
    const disposing = model.dispose();
    let disposed = false;
    void disposing.then(() => {
      disposed = true;
    });
    await Promise.resolve();
    assert.equal(disposed, false);
    await assert.rejects(readTestNoteInventory(f.runtime, noop), /BUSY/);
    release();
    await Promise.all([preparing, disposing]);
    assert.equal(disposed, true);
    await readTestNoteInventory(f.runtime, noop);
    assert.notEqual(model.getSnapshot().phase, 'review');
    assert.equal(f.posted.length, 1);
  } finally {
    release?.();
    await f.close();
  }
});

test('imported EVM payer withdraws a saved note through the normal selected-key SDK path', async () => {
  const f = await fixture();
  try {
    await f.seed();
    const key = '0x' + '29'.repeat(32),
      signer = new Wallet(key);
    await f.runtime
      .imports!.reserve(
        {
          privateKey: key,
          label: 'Withdrawal payer',
          expectedAddress: signer.address,
        },
        PASSWORD,
        f.runtime.catalogue.getSnapshot()!.revision
      )
      .execute(noop);
    const inventory = await readTestNoteInventory(f.runtime, noop);
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(model.getSnapshot().phase, 'submitted');
    assert.equal(
      Transaction.from(f.posted[1]!).from?.toLowerCase(),
      signer.address.toLowerCase()
    );
    await model.dispose();
  } finally {
    await f.close();
  }
});

test('restored note requires explicit authenticated review before fresh withdrawal', async () => {
  const f = await fixture();
  try {
    const inventory = await f.restore();
    assert.equal(inventory.notes[0]!.reconciliation, 'restored-note');
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(model.getSnapshot().error, 'restored');
    assert.equal(f.proofs, 0);
    await model.reviewRestored(PASSWORD);
    assert.equal(model.getSnapshot().restored, false);
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(model.getSnapshot().phase, 'review');
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(model.getSnapshot().phase, 'submitted');
    await model.dispose();
  } finally {
    await f.close();
  }
});

for (const change of ['account', 'lock-unlock'] as const) {
  test(`withdrawal ACK uses original wallet identity across ${change}`, async () => {
    const f = await fixture();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    try {
      await f.seed();
      if (change === 'account') {
        await f.addAccount();
        await f.select('hd:60:0');
      }
      const inventory = await readTestNoteInventory(f.runtime, noop);
      const model = await inventory.openWithdrawal!(
        inventory.notes[0]!,
        new AbortController().signal,
        noop
      , testInventoryAuthentication(inventory));
      await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
      f.beforeResponse(async () => {
        entered();
        await gate;
      });
      const confirming = model.confirm(model.getSnapshot().review!.intentId);
      await posted;
      if (change === 'account') await f.select('hd:60:1');
      else {
        await f.runtime.session.lock();
        await f.runtime.session.unlock(PASSWORD);
      }
      release();
      await confirming;
      assert.equal(
        (await f.privateNotes())[0]!.withdrawal?.phase,
        change === 'account' ? 'submitted' : 'unknown'
      );
      await model.dispose();
    } finally {
      release?.();
      await f.close();
    }
  });
}

test('relayed withdrawal uses the shared proof POST and durable job acknowledgement without an EOA send', async () => {
  const f = await fixture();
  try {
    const inventory = await f.seed();
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.loadRelayers();
    await model.prepare({
      recipient: RECIPIENT,
      mode: 'relayed',
      relayerId: model.getSnapshot().relayers[0]!.id,
    });
    assert.equal(model.getSnapshot().phase, 'review');
    assert.equal(model.getSnapshot().review!.mode, 'relayed');
    assert(BigInt(model.getSnapshot().review!.feeWei) > 0n);
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(model.getSnapshot().phase, 'submitted');
    assert.equal(
      model.getSnapshot().result!.jobId,
      '00000000-0000-4000-8000-000000000088'
    );
    assert.equal(f.relayedPosts.length, 1);
    assert.equal(f.posted.length, 1);
    assert.equal((await f.privateNotes())[0]!.withdrawal?.mode, 'relayed');
    await model.dispose();
  } finally {
    await f.close();
  }
});

test('ACK storage quarantine preserves the retained withdrawal and locks custody', async () => {
  let failRead = false;
  const f = await fixture({
    before(kind, sql) {
      if (
        failRead &&
        kind === 'all' &&
        sql.startsWith("SELECT 'note' AS source")
      )
        throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');
    },
  });
  try {
    const inventory = await f.seed();
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    f.beforeResponse(async () => {
      failRead = true;
    });
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(f.posted.length, 2);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    assert.equal(model.getSnapshot().phase, 'unknown');
    failRead = false;
    await model.dispose();
  } finally {
    failRead = false;
    await f.close();
  }
});

test('cancel during held reservation cannot sign or persist a usable withdrawal attempt', async () => {
  let holding = false;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture({
    async before(kind, sql) {
      if (
        holding &&
        kind === 'run' &&
        sql.startsWith('INSERT INTO private_note_records')
      ) {
        entered();
        await gate;
      }
    },
  });
  try {
    const inventory = await f.seed();
    const lifetime = new AbortController();
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      lifetime.signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    holding = true;
    const confirming = model.confirm(model.getSnapshot().review!.intentId);
    await started;
    lifetime.abort();
    release();
    await confirming;
    assert.equal(f.posted.length, 1);
    assert.equal((await f.privateNotes())[0]!.withdrawal, undefined);
  } finally {
    release?.();
    await f.close();
  }
});

test('an account change invalidates the current withdrawal review before signing', async () => {
  const f = await fixture();
  try {
    await f.seed();
    await f.addAccount();
    await f.select('hd:60:0');
    const inventory = await readTestNoteInventory(f.runtime, noop);
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    await f.select('hd:60:1');
    await assert.rejects(model.confirm(model.getSnapshot().review!.intentId));
    assert.equal(f.posted.length, 1);
    await model.dispose();
  } finally {
    await f.close();
  }
});

for (const flag of [
  'isLedgerWallet',
  'isTrezorWallet',
  'isSmartAccount',
] as const) {
  test(`withdrawal admission excludes ${flag} in both modes`, async () => {
    const f = await fixture();
    try {
      const before = await f.seed();
      f.markUnsupported(flag);
      const inventory = await readTestNoteInventory(f.runtime, noop);
      assert.equal(inventory.openWithdrawal, undefined);
      await assert.rejects(
        before.openWithdrawal!(
          before.notes[0]!,
          new AbortController().signal,
          noop
        , testInventoryAuthentication(before))
      );
      assert.equal(f.proofs, 0);
      assert.equal(f.posted.length, 1);
    } finally {
      await f.close();
    }
  });
}

test('cancellation immediately after reservation commit clears only the unsigned withdrawal attempt', async () => {
  let armed = false, wrote = false;
  const lifetime = new AbortController();
  const f = await fixture({ after(kind, sql) {
    if (armed && kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) wrote = true;
    if (armed && wrote && kind === 'exec' && sql === 'COMMIT') {
      armed = false;
      lifetime.abort();
    }
  } });
  try {
    const inventory = await f.seed();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, lifetime.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    armed = true;
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(f.posted.length, 1);
    assert.equal((await f.privateNotes())[0]!.withdrawal, undefined);
  } finally { await f.close(); }
});

test('deposit cancellation immediately after reservation commit clears only its unsigned attempt', async () => {
  let armed = false, wrote = false;
  const lifetime = new AbortController();
  const f = await fixture({ after(kind, sql) {
    if (armed && kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) wrote = true;
    if (armed && wrote && kind === 'exec' && sql === 'COMMIT') {
      armed = false;
      lifetime.abort();
    }
  } });
  try {
    const model = await f.runtime.openPrivateDeposit!(lifetime.signal, noop, createTestPrivateAuthentication(noop));
    await model.prepare({ poolId: 'eth-1' });
    armed = true;
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(f.posted.length, 0);
    assert.equal((await f.privateNotes())[0]!.deposit, undefined);
  } finally { await f.close(); }
});


test('native maintenance clears only shared-verified completed notes and preserves unspent notes and custody', async () => {
  const f = await fixture(); const route = new AbortController();
  try {
    const inventory = await f.seed();
    await f.restore();
    const withdrawalRoute = new AbortController();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, withdrawalRoute.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(model.getSnapshot().phase, 'submitted');
    withdrawalRoute.abort(); await model.dispose(); f.enableCompletionReads();
    const before = await f.privateNotes(); assert.equal(before.length, 2);
    const completed = before.find(note => note.withdrawal)!, unspent = before.find(note => !note.withdrawal)!;
    assert(identifyClassicNote(completed.note).nullifierHash);
    const maintenance = await f.runtime.openNoteMaintenance!(route.signal, noop, createTestPrivateAuthentication(noop));
    const localReads = f.rpcMethods.length;
    const notes = await maintenance.getNotes(noop); assert.equal(notes.notes.length, 2);
    assert.equal(f.rpcMethods.length, localReads, 'opening inventory performs no note-specific RPC');
    assert.deepEqual(await maintenance.clearCompletedNote(unspent.id, noop), { removed: [], unresolved: [unspent.id] });
    assert.deepEqual(await maintenance.clearCompletedNote(completed.id, noop), { removed: [completed.id], unresolved: [] });
    assert.deepEqual((await f.privateNotes()).map(note => note.id), [unspent.id]);
    assert(f.runtime.catalogue.getSnapshot());
    assert.equal(f.posted.length, 2, 'maintenance does not sign or broadcast');
    route.abort(); await maintenance.dispose();
    await f.runtime.session.lock(); await f.runtime.session.unlock(PASSWORD);
    assert.deepEqual((await f.privateNotes()).map(note => note.id), [unspent.id]);
  } finally { route.abort(); await f.close(); }
});

for (const cancel of ['route', 'lock'] as const) test(`native maintenance rolls back a completed-note removal when ${cancel} revokes SQL authority`, async () => {
  let hold = false;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture({ async before(kind, sql) {
    if (hold && kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) { entered.resolve(); await release.promise; }
  } });
  const route = new AbortController();
  try {
    const inventory = await f.seed(); const withdrawalRoute = new AbortController();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, withdrawalRoute.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' }); await model.confirm(model.getSnapshot().review!.intentId);
    withdrawalRoute.abort(); await model.dispose(); f.enableCompletionReads();
    const [note] = await f.privateNotes(); assert(note);
    const maintenance = await f.runtime.openNoteMaintenance!(route.signal, noop, createTestPrivateAuthentication(noop)); hold = true;
    const removed = assert.rejects(maintenance.clearCompletedNote(note.id, noop)); await entered.promise;
    let retired: Promise<void>;
    if (cancel === 'lock') retired = f.runtime.session.lock();
    else { route.abort(); retired = maintenance.dispose(); }
    release.resolve(); await removed; await retired; hold = false;
    if (cancel === 'lock') await f.runtime.session.unlock(PASSWORD);
    assert.deepEqual((await f.privateNotes()).map(saved => saved.id), [note.id]);
    route.abort(); await maintenance.dispose(); await f.reopen();
    assert.deepEqual((await f.privateNotes()).map(saved => saved.id), [note.id]);
  } finally { hold = false; release.resolve(); route.abort(); await f.close(); }
});


test('native service-origin changes are guarded in the real protected SQL transaction and retain every note', async () => {
  let hold = false;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture({ async before(kind, sql) {
    if (hold && kind === 'run' && sql.startsWith('INSERT INTO keyring_records')) { entered.resolve(); await release.promise; }
  } });
  const route = new AbortController();
  try {
    await f.seed(); const before = await f.privateNotes();
    const controls = await f.runtime.openPrivacyControls!(route.signal, noop), origin = await controls.getOrigin();
    hold = true; const change = assert.rejects(controls.changeOrigin('https://private.example', origin));
    await entered.promise; const locked = f.runtime.session.lock(); release.resolve(); await change; await locked; hold = false;
    await f.runtime.session.unlock(PASSWORD);
    assert.equal(await f.storage.keyringStorage.get(PRIVACY_SERVICE_ORIGIN_STORAGE_KEY), undefined);
    assert.deepEqual(await f.privateNotes(), before);
    const next = await f.runtime.openPrivacyControls!(route.signal, noop);
    assert.equal(await next.changeOrigin('https://private.example', await next.getOrigin()), 'https://private.example');
    await next.clearPublicData(); assert.deepEqual(await f.privateNotes(), before);
    route.abort(); await f.reopen();
    const fresh = await f.runtime.openPrivacyControls!(new AbortController().signal, noop);
    assert.equal(await fresh.getOrigin(), 'https://private.example'); assert.deepEqual(await f.privateNotes(), before);
  } finally { hold = false; release.resolve(); route.abort(); await f.close(); }
});


test('native failed-withdrawal recovery authenticates, preserves the original journal and never resubmits', async () => {
  const f = await fixture(); const route = new AbortController();
  try {
    const inventory = await f.seed(), withdrawalRoute = new AbortController();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, withdrawalRoute.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' }); await model.confirm(model.getSnapshot().review!.intentId);
    withdrawalRoute.abort(); await model.dispose(); f.enableCompletionReads(true);
    const [before] = await f.privateNotes(); assert(before?.withdrawal);
    const maintenance = await f.runtime.openNoteMaintenance!(route.signal, noop, createTestPrivateAuthentication(noop));
    assert((await maintenance.getNotes(noop)).notes[0]!.withdrawal?.canCheckRecovery);
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id, PASSWORD + 'wrong', noop));
    assert.equal((await f.privateNotes())[0]!.withdrawal?.recovery, undefined);
    await maintenance.recoverFailedWithdrawal(before.id, PASSWORD, noop);
    const [after] = await f.privateNotes(); assert(after?.withdrawal?.recovery);
    assert.equal(after.note, before.note); assert.equal(after.withdrawal.transactionHash, before.withdrawal.transactionHash);
    assert.equal(after.withdrawal.proofHash, before.withdrawal.proofHash); assert.equal(f.posted.length, 2);
    assert.equal((await maintenance.getNotes(noop)).notes[0]!.withdrawal?.canCheckRecovery, undefined);
    route.abort(); await maintenance.dispose(); await f.reopen();
    assert.deepEqual((await f.privateNotes())[0]!.withdrawal?.recovery, after.withdrawal.recovery);
  } finally { route.abort(); await f.close(); }
});

test('a service-origin change preserves unknown recovery after an unacknowledged financial handoff', async () => {
  const f = await fixture(), route = new AbortController(), settingsRoute = new AbortController();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    const inventory = await f.seed();
    const settings = await f.runtime.openPrivacyControls!(settingsRoute.signal, noop), origin = await settings.getOrigin();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, route.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    f.beforeResponse(async () => { entered.resolve(); await release.promise; });
    const sending = model.confirm(model.getSnapshot().review!.intentId); await entered.promise;
    const changing = settings.changeOrigin('https://private.example', origin); let changed = false;
    void changing.then(() => { changed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); await changing; assert.equal(changed, true);
    const [note] = await f.privateNotes(); assert.equal(note?.withdrawal?.phase, 'unknown');
    const saved = await f.storage.signedRecords.read((await f.storage.recovery.readIdentity())!.root!.profileId);
    assert(saved); assert(JSON.parse(saved).entries.some((entry: { hash: string }) => entry.hash === Transaction.from(f.posted[1]!).hash));
    release.resolve(); await sending; assert.equal((await f.privateNotes())[0]!.withdrawal?.phase, 'unknown');
    assert.equal(f.posted.length, 2); assert.equal(await settings.getOrigin(), 'https://private.example');
    route.abort(); settingsRoute.abort(); await model.dispose();
  } finally { release.resolve(); route.abort(); settingsRoute.abort(); await f.close(); }
});


test('a service-origin change waits for durable recording of an already verified financial acknowledgement', async () => {
  let holding = false;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture({ async before(kind, sql) {
    if (holding && kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) { entered.resolve(); await release.promise; }
  } });
  const route = new AbortController(), settingsRoute = new AbortController();
  try {
    const inventory = await f.seed();
    const settings = await f.runtime.openPrivacyControls!(settingsRoute.signal, noop), origin = await settings.getOrigin();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, route.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    f.beforeResponse(async () => { holding = true; });
    const sending = model.confirm(model.getSnapshot().review!.intentId); await entered.promise;
    const changing = settings.changeOrigin('https://private.example', origin); let changed = false;
    void changing.then(() => { changed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(changed, false);
    release.resolve(); await sending; await changing; holding = false;
    const [note] = await f.privateNotes(); assert.equal(note?.withdrawal?.phase, 'submitted');
    assert.equal(note.withdrawal.transactionHash, Transaction.from(f.posted[1]!).hash); assert.equal(f.posted.length, 2);
    route.abort(); settingsRoute.abort(); await model.dispose();
  } finally { holding = false; release.resolve(); route.abort(); settingsRoute.abort(); await f.close(); }
});


for (const fault of ['release', 'quarantine-and-release'] as const) for (const retirement of ['close', 'recovery'] as const) test(`native ${retirement} retirement rejects ${fault} failure and never admits a recovery snapshot`, async () => {
  let failRead = false;
  const f = await fixture({ before(kind, sql) {
    if (failRead && kind === 'all' && sql.startsWith("SELECT 'note' AS source")) throw new WalletStorageError('STORAGE_REOPEN_REQUIRED');
  } });
  const route = new AbortController();
  let recoveryOpens = 0, proof: unknown;
  const recovery = new NativeRecoveryCoordinator({ pinCredential,
    owner: {
      getSnapshot: () => ({ phase: 'locked', revision: 1, presence: 'existing', backup: 'unconfirmed', account: null, error: null }),
      retireForRecovery: () => f.runtime.storage.retireForRecovery!(),
    },
    retireControllers: async () => undefined,
    ensureCryptoReady: async () => undefined,
    async openStorage() { recoveryOpens++; return f.storage; },
  });
  try {
    if (fault === 'quarantine-and-release') {
      const inventory = await f.seed();
      const withdrawal = await inventory.openWithdrawal!(inventory.notes[0]!, route.signal, noop, testInventoryAuthentication(inventory));
      await withdrawal.prepare({ recipient: RECIPIENT, mode: 'direct' });
      f.beforeResponse(async () => { failRead = true; });
      await withdrawal.confirm(withdrawal.getSnapshot().review!.intentId);
      assert.equal(f.runtime.catalogue.getSnapshot(), null, 'the store is already quarantined');
      assert.equal(withdrawal.getSnapshot().phase, 'unknown'); failRead = false;
      assert((await f.storage.notes!.read())[0]?.value, 'quarantine preserves the encrypted note row');
    } else {
      const controls = await f.runtime.openPrivacyControls!(route.signal, noop);
      await controls.openPool('eth-1', route.signal, noop);
    }
    const previousDisposals = f.disposed; f.failPoolCleanup();
    if (retirement === 'close') await assert.rejects(f.runtime.storage.close(), { code: 'CLEANUP_FAILED' });
    await assert.rejects(recovery.prepare(PHRASE, '654321', noop).then(value => { proof = value; }), { code: 'UNAVAILABLE' });
    assert.equal(proof, undefined); assert.equal(recoveryOpens, 0, 'failed retirement never grants a new storage/snapshot lease');
    await assert.rejects(f.runtime.storage.retireForRecovery!(), { code: 'CLEANUP_FAILED' });
    await assert.rejects(f.runtime.storage.close(), { code: 'CLEANUP_FAILED' });
    await assert.rejects(f.storage.readState(), { code: 'STORAGE_CLOSED' });
    await assert.rejects(f.runtime.session.unlock(PASSWORD));
    assert.equal(f.disposed, previousDisposals + 1, 'failed exact cleanup is not repeated or hidden');
    assert.equal(f.posted.length, fault === 'release' ? 0 : 2);
  } finally { failRead = false; route.abort(); await recovery.dispose(); await f.close(); }
});
