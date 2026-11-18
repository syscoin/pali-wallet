import { operationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import { prepareRecoveryCredential } from './fixtures/recoveryCredential.ts';
import { createTestPrivateAuthentication, readTestNoteInventory, testInventoryAuthentication } from './fixtures/privateAuthentication.ts';
import { createPrivateVaultSession } from '../../../source/wallet/privateVault.ts';
import { createTestCredentialRecordKeyring } from './fixtures/credentialOperation.ts';
import { createTestCredentialPort } from './fixtures/credential.ts';
import type { NativeCredentialPort } from '../src/custody/credentialVault.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
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
import { readPrivateVaultBundle, type IStoredNote } from '../../../source/wallet/privateVaultInspection.ts';

const credentialPort = createTestCredentialPort();

const sdk = await loadNativeKeyringSdk();
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const noop = () => undefined;
const depositAbi = new Interface([
  'function deposit(bytes32) payable',
  'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)',
  'event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)',
  'function isKnownRoot(bytes32) view returns(bool)',
  'function isSpent(bytes32) view returns(bool)',
]);
const RECIPIENT = '0x' + '12'.repeat(20);

async function assertCheckpointReached(checkpoint: Promise<void>, operation: Promise<unknown>) {
  assert.equal(
    await Promise.race([checkpoint.then(() => true), operation.then(() => false)]),
    true,
    'The operation must reach its held checkpoint before completing'
  );
}

const assertArchivedRecoveryNote = (saved: IStoredNote | undefined, original: IStoredNote) => {
  assert(saved);
  const { archivedAt, ...recovery } = saved;
  assert(Number.isSafeInteger(archivedAt) && archivedAt! > 0);
  assert.deepEqual(recovery, original, 'Archiving preserves the raw secret and every recovery field');
  return saved;
};

async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-private-deposit-'));
  let file = path.join(directory, 'wallet.sqlite');
  let checkpoint = 0;
  let storage!: SqliteWalletStorage;
  let initialized = false;
  let privacySettings: ReturnType<typeof createNativePrivacyServiceSettings>;
  let runtime!: KeyringRuntime;
  let keyring!: InstanceType<typeof sdk.HostKeyring>;
  let signingFault = false, credentialFault = false, signatures = 0;
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
    override signPreparedEvmTransaction(...args: Parameters<InstanceType<typeof sdk.HostKeyring>['signPreparedEvmTransaction']>) {
      const signed = super.signPreparedEvmTransaction(...args);
      signatures++;
      if (signingFault) throw Error('Synthetic post-signing fault');
      return signed;
    }
  }
  let nonce = 0;
  let proofs = 0;
  let proofGate: (() => Promise<void>) | undefined;
  let badProof = false;
  const rpcMethods: string[] = [];
  let beforeRpc: (method: string) => Promise<void> = async () => undefined;
  let beforeResponse: () => Promise<void> = async () => undefined;
  let lost = false;
  let failPoolDispose = false;
  let completionReads = false, completionReverted = false, completionKnown = false, completionSpent = false;
  let missingCompletionReceipt: ((hash: string) => boolean) | undefined;
  let noteStatus: IPrivateNoteStatus = { phase: 'waiting' };
  const posted: string[] = [];
  const relayedPosts: unknown[] = [];
  const poolReads: string[] = [];
  let opened = 0,
    disposed = 0,
    refreshes = 0;
  const connectionFetch: typeof fetch = async function fixtureFetch(_url, init): Promise<Response> {
    if (String(_url).startsWith('https://relay.example/')) {
      relayedPosts.push(JSON.parse(String(init?.body)));
      if (lost) throw Error('synthetic relayer response lost');
      return new Response(
        JSON.stringify({ id: '00000000-0000-4000-8000-000000000088' }),
        { headers: { 'content-type': 'application/json' } }
      );
    }
    const request = JSON.parse(String(init?.body));
    if (Array.isArray(request)) return Response.json(await Promise.all(request.map(async row =>
      (await fixtureFetch(_url, { ...init, body: JSON.stringify(row) })).json())));
    const { id, method, params } = request;
    rpcMethods.push(method);
    await beforeRpc(method);
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getBlockByNumber')
      result = {
        number: params[0] === '0x8' ? '0x8' : '0x10',
        hash: '0x' + (params[0] === '0x8' ? '55' : 'aa').repeat(32),
        gasLimit: '0x1c9c380',
        baseFeePerGas: '0x2',
      };
    else if (completionReads && method === 'eth_getTransactionReceipt' && missingCompletionReceipt?.(params[0])) result = null;
    else if (completionReads && (method === 'eth_getTransactionReceipt' || method === 'eth_getTransactionByHash')) {
      const transaction = posted.map(raw => Transaction.from(raw)).find(tx => tx.hash === params[0]);
      assert(transaction);
      const shared = { to: transaction.to, value: '0x' + transaction.value.toString(16), chainId: '0x1', input: transaction.data, hash: transaction.hash, blockNumber: '0x10', blockHash: '0x' + 'aa'.repeat(32), from: transaction.from, nonce: '0x' + transaction.nonce.toString(16) };
      const action = depositAbi.parseTransaction({ data: transaction.data })!;
      const event = action.name === 'withdraw' ? depositAbi.encodeEventLog(depositAbi.getEvent('Withdrawal')!, [action.args[3], action.args[2], action.args[4], action.args[5]]) : null;
      result = method === 'eth_getTransactionByHash' ? shared : { transactionHash: transaction.hash, blockHash: shared.blockHash, blockNumber: shared.blockNumber, status: completionReverted && action.name === 'withdraw' ? '0x0' : '0x1', logs: event ? [{ address: transaction.to, transactionHash: transaction.hash, blockHash: shared.blockHash, blockNumber: shared.blockNumber, removed: false, ...event }] : [] };
    }
    else if (completionReads && method === 'eth_call') {
      const known = params[0].data.startsWith(depositAbi.getFunction('isKnownRoot')!.selector);
      result = depositAbi.encodeFunctionResult(known ? 'isKnownRoot' : 'isSpent', [known ? params[1] === '0x8' || completionKnown : completionSpent]);
    }
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
  const credentials: NativeCredentialPort = { ...credentialPort, async withSecret(reference, owner, consume) {
    if (credentialFault && owner.purpose === 'transaction') throw Error('Synthetic protected read failure');
    return credentialPort.withSecret(reference, owner, consume);
  } };
  const factory = createKeyringRuntimeFactory({ isAuthenticationActive: () => false, credentialPort: credentials, privacyServiceSettings: { getOrigin: () => privacySettings.getOrigin(), changeOrigin: (...args) => privacySettings.changeOrigin(...args) }, passkeys: null, slhExecution: null,
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
          const snapshot = { poolId, root: '0x' + '11'.repeat(32), asOfBlockNumber: 8, asOfBlockHash: '0x' + '55'.repeat(32) };
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
  await runtime.session.importWallet(PHRASE);
  return {
    get runtime() {
      return runtime;
    },
    get storage() {
      return storage;
    },
    enableCompletionReads(reverted = false) { completionReads = true; completionReverted = reverted; },
    missingCompletionReceipts(read: (hash: string) => boolean) { missingCompletionReceipt = read; },
    completionPoolState(known: boolean, spent = false) { completionKnown = known; completionSpent = spent; },
    finalizedPayerNonce(value: number) { nonce = value; },
    markUnsupported(
      flag: 'isLedgerWallet' | 'isTrezorWallet' | 'isSmartAccount'
    ) {
      const current = privateState();
      current.accounts[current.activeAccount.type]![current.activeAccount.id]![
        flag
      ] = true;
    },
    posted,
    failSigning() { signingFault = true; },
    failCredentialRead() { credentialFault = true; },
    get signatures() { return signatures; },
    get secretReads() { return credentialPort.secretReads; },
    refuseNextAuthorization() { credentialPort.refuseNext(operationAuthenticationCancellation()); },
    rpcMethods,
    beforeRpc(callback: (method: string) => Promise<void>) { beforeRpc = callback; },
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
            keyring: createTestCredentialRecordKeyring(storage.credential, credentialPort, keyring, () => { assert(keyring.hasPublicSession()); }),
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
      await runtime.session.unlock();
    },
    async captureRestart() {
      const savedFile = path.join(directory, `restart-${++checkpoint}.sqlite`);
      const connection = new DatabaseSync(file);
      try { await backup(connection, savedFile); }
      finally { connection.close(); }
      const saved = new DatabaseSync(savedFile, { readOnly: true });
      let noteValue: unknown;
      try { noteValue = saved.prepare('SELECT value FROM private_note_records').get()?.value; }
      finally { saved.close(); }
      return {
        noteValue,
        async reopen() {
          // Cleanup may alter the old database. Reopen the exact bytes captured
          // before cleanup, as a new process would after abrupt termination.
          await runtime.storage.close().catch(() => undefined);
          file = savedFile;
          runtime = (await factory.open()) as KeyringRuntime;
          await runtime.session.unlock();
        },
      };
    },
    async restore(seed = '02', createdAt = 10) {
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
            { note: `tornado-eth-1-1-0x${seed.repeat(62)}`, createdAt },
          ],
        },
        backupPassword
      );
      const backup = await runtime.openNoteBackup!(noop, createTestPrivateAuthentication(noop));
      const id = backup.begin();
      await backup.prepareImport(id, bytes, backupPassword);
      await backup.commitImport(id);
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

test('pending withdrawal Activity pauses the note until a generic reset permits a fresh review', async () => {
  const f = await fixture();
  try {
    const inventory = await f.seed();
    const model = await inventory.openWithdrawal!(
      inventory.notes[0]!,
      new AbortController().signal,
      noop
    , testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    const previousIntent = model.getSnapshot().review!.intentId;
    f.loseResponse(true);
    await model.confirm(previousIntent);
    assert.equal(model.getSnapshot().phase, 'unknown');
    assert.match(
      model.getSnapshot().result!.signedTransactionHash!,
      /^0x[0-9a-f]{64}$/
    );
    const oldJournal=(await f.privateNotes())[0]!.withdrawal;
    const oldHash=model.getSnapshot().result!.signedTransactionHash!;
    assert.equal(oldJournal?.phase, 'unknown');
    assert.equal((await f.privateNotes())[0]!.withdrawal?.unsigned, undefined);
    await model.dispose();
    await f.reopen();
    const reopenInventory = () => readTestNoteInventory(f.runtime, noop);
    const openWithdrawal = (inventory: Awaited<ReturnType<typeof reopenInventory>>) =>
      inventory.openWithdrawal!(
        inventory.notes[0]!,
        new AbortController().signal,
        noop,
        testInventoryAuthentication(inventory)
      );
    const pending = await reopenInventory();
    assert.equal(pending.notes[0]?.withdrawalPending, true);
    const blocked = await openWithdrawal(pending);
    assert.equal(blocked.getSnapshot().status?.phase, 'unknown');
    await blocked.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(blocked.getSnapshot().review, null);
    assert.equal(f.posted.length, 2);
    await blocked.dispose();

    await f.runtime.resetActivity(noop, noop);
    const cleared = await reopenInventory();
    assert.equal(cleared.notes[0]?.withdrawalPending, undefined);
    assert.equal((await cleared.checkNote!(cleared.notes[0]!, noop)).phase, 'verified');
    const resumed = await openWithdrawal(cleared);
    await resumed.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(resumed.getSnapshot().phase, 'review');
    const freshReview = resumed.getSnapshot().review!;
    assert.notEqual(freshReview.intentId, previousIntent);
    assert.equal(freshReview.recipient, RECIPIENT);
    assert.equal(freshReview.mode, 'direct');
    assert.equal(resumed.getSnapshot().status?.phase, 'unknown');
    assert.equal(f.posted.length, 2, 'a fresh review never resubmits before explicit Confirm');
    assert.deepEqual((await f.privateNotes())[0]!.withdrawal, oldJournal, 'reset and preparation preserve the prior Vault journal');
    const signed = await f.storage.signedRecords.read((await f.storage.recovery.readIdentity())!.root!.profileId);
    assert(signed);
    assert(!JSON.parse(signed).entries.some((entry: { hash: string }) => entry.hash === oldHash), 'reset drops the old local Activity row');
    await resumed.dispose();
  } finally {
    await f.close();
  }
});

for (const mode of ['direct', 'relayed'] as const) test(`native ${mode} unsigned withdrawal survives abrupt restart without a public-unlock secret read`, async () => {
  let holding = false, wrote = false;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture({ async after(kind, sql) {
    if (!holding) return;
    if (kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) wrote = true;
    if (wrote && kind === 'exec' && sql === 'COMMIT') {
      holding = false;
      entered.resolve();
      await release.promise;
    }
  } });
  const route = new AbortController();
  let model: Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof f.seed>>['openWithdrawal']>>> | undefined;
  try {
    const inventory = await f.seed();
    model = await inventory.openWithdrawal!(inventory.notes[0]!, route.signal, noop, testInventoryAuthentication(inventory));
    if (mode === 'relayed') await model.loadRelayers();
    await model.prepare({ recipient: RECIPIENT, mode,
      ...(mode === 'relayed' ? { relayerId: model.getSnapshot().relayers[0]!.id } : {}) });
    assert.equal(model.getSnapshot().phase, 'review');
    const signatures = f.signatures;
    holding = true;
    const sending = model.confirm(model.getSnapshot().review!.intentId);
    await assertCheckpointReached(entered.promise, sending);
    await assert.rejects(readTestNoteInventory(f.runtime, noop), { code: 'BUSY' });
    const restart = await f.captureRestart();
    route.abort(); release.resolve();
    await sending;
    await model.dispose(); model = undefined;
    const reads = f.secretReads;
    await restart.reopen();
    assert.equal(f.secretReads, reads, 'public restoration must not acquire note or signing secrets');
    assert.equal((await f.storage.notes!.read())[0]?.value, restart.noteValue, 'public restoration preserves the captured encrypted snapshot');
    assert((await f.privateNotes())[0]?.withdrawal?.unsigned, 'the new runtime still has the pre-cleanup durable marker');
    const recovered = await readTestNoteInventory(f.runtime, noop);
    assert.equal((await f.privateNotes())[0]?.withdrawal, undefined);
    assert.equal(recovered.notes.length, 1);
    assert.equal(recovered.notes[0]!.reconciliation, undefined);
    assert.equal(f.signatures, signatures);
    assert.equal(f.posted.length, 1, 'only the seed deposit was broadcast');
    assert.equal(f.relayedPosts.length, 0);
    const retry = await recovered.openWithdrawal!(recovered.notes[0]!, new AbortController().signal, noop, testInventoryAuthentication(recovered));
    await retry.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(retry.getSnapshot().phase, 'review');
    await retry.dispose();
  } finally { holding = false; release.resolve(); route.abort(); await model?.dispose(); await f.close(); }
});

test('authenticated inventory during direct preflight cannot reclaim its live unsigned marker', { timeout: 15000 }, async () => {
  let watch = false, wrote = false, reserved = false, paused = false;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture({ after(kind, sql) {
    if (!watch) return;
    if (kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) wrote = true;
    if (wrote && kind === 'exec' && sql === 'COMMIT') reserved = true;
  } });
  const route = new AbortController();
  try {
    const inventory = await f.seed();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, route.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    watch = true;
    f.beforeRpc(async method => {
      if (reserved && method === 'eth_getTransactionCount' && !paused) {
        paused = true; entered.resolve(); await release.promise;
      }
    });
    const signatures = f.signatures;
    const sending = model.confirm(model.getSnapshot().review!.intentId);
    await assertCheckpointReached(entered.promise, sending);
    const before = (await f.storage.notes!.read())[0]!.value;
    const concurrent = await readTestNoteInventory(f.runtime, noop);
    assert.equal(concurrent.notes[0]!.reconciliation, 'withdrawal-history');
    assert.equal((await f.storage.notes!.read())[0]!.value, before);
    assert.equal(f.signatures, signatures);
    release.resolve(); await sending;
    assert.equal(model.getSnapshot().phase, 'submitted');
    assert.equal(f.signatures, signatures + 1);
    await model.dispose();
  } finally { release.resolve(); route.abort(); await f.close(); }
});

for (const phase of ['credential', 'signed'] as const) test(`direct withdrawal ${phase} failure clears only known-unsigned reservations`, async () => {
  const f = await fixture();
  try {
    const inventory = await f.seed();
    const deposit = (await f.privateNotes())[0]!.deposit;
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, new AbortController().signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' });
    if (phase === 'credential') f.failCredentialRead(); else f.failSigning();
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(model.getSnapshot().phase, phase === 'credential' ? 'failed' : 'unknown');
    assert.equal(f.posted.length, 1, 'only the original deposit was broadcast');
    assert.equal(f.signatures, phase === 'credential' ? 1 : 2);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    await f.runtime.session.unlock();
    const saved = (await f.privateNotes())[0]!;
    if (phase === 'credential') assert.equal(saved.withdrawal, undefined);
    else assert.equal(saved.withdrawal?.phase, 'unknown');
    assert.deepEqual(saved.deposit, deposit, 'the prior submitted deposit remains intact');
    await model.dispose();
  } finally { await f.close(); }
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
    await assertCheckpointReached(started, preparing);
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
        f.runtime.catalogue.getSnapshot()!.revision,
        new AbortController().signal,
        createTestPrivateAuthentication(noop)
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

test('restored note reaches the normal prepared review and explicit withdrawal confirmation', async () => {
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
    assert.equal(f.proofs, 1);
    assert.equal(f.posted.length, 0, 'preparation never broadcasts the imported note');
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
      await assertCheckpointReached(posted, confirming);
      if (change === 'account') await f.select('hd:60:1');
      else {
        await f.runtime.session.lock();
        await f.runtime.session.unlock();
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
    await assertCheckpointReached(started, confirming);
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


test('native maintenance archives only shared-verified completed notes and preserves recovery secrets, unspent notes and custody', async () => {
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
    assert.deepEqual(await maintenance.clearCompletedNotes([completed.id], noop, noop, noop), { removed: [completed.id], unresolved: [] });
    const saved = await f.privateNotes();
    assert.equal(saved.length, 2, 'Full encrypted recovery retains both notes');
    const archived = assertArchivedRecoveryNote(saved.find(note => note.id === completed.id), completed);
    assert.deepEqual(saved.find(note => note.id === unspent.id), unspent);
    assert.deepEqual((await maintenance.getNotes(noop)).notes.map(note => note.id), [unspent.id]);
    assert(f.runtime.catalogue.getSnapshot());
    assert.equal(f.posted.length, 2, 'maintenance does not sign or broadcast');
    route.abort(); await maintenance.dispose();
    await f.runtime.session.lock(); await f.runtime.session.unlock();
    const restarted = await f.privateNotes();
    assert.deepEqual(restarted.find(note => note.id === completed.id), archived);
    assert.deepEqual(restarted.find(note => note.id === unspent.id), unspent);
    const active = await readTestNoteInventory(f.runtime, noop);
    assert.equal(active.notes.length, 1);
    assert.equal(active.notes[0]!.createdAt, unspent.createdAt);
    assert.equal(active.archiveSummary?.noteCount, 1);
  } finally { route.abort(); await f.close(); }
});

test('single-note maintenance reaches a completed seventh note past a slow unresolved prefix with fresh authorization', async context => {
  const f = await fixture();
  const submitted: string[] = [];
  const routes: AbortController[] = [];
  let maintenance: Awaited<ReturnType<NonNullable<KeyringRuntime['openNoteMaintenance']>>> | undefined;
  try {
    f.enableCompletionReads();
    for (let index = 0; index < 7; index++) {
      const inventory = index === 0 ? await f.seed() : await f.restore(String(index + 1).padStart(2, '0'), index + 20);
      const selected = (await f.privateNotes()).find(note => !note.withdrawal);
      assert(selected);
      const note = inventory.notes.find(note => note.createdAt === selected.createdAt);
      assert(note, `iteration ${index}: inventory ${inventory.notes.length}, submitted ${submitted.length}`);
      const route = new AbortController(); routes.push(route);
      const withdrawal = await inventory.openWithdrawal!(note, route.signal, noop, testInventoryAuthentication(inventory));
      await withdrawal.prepare({ recipient: RECIPIENT, mode: 'direct' });
      assert.equal(withdrawal.getSnapshot().phase, 'review', `iteration ${index}: ${JSON.stringify(withdrawal.getSnapshot())}`);
      await withdrawal.confirm(withdrawal.getSnapshot().review!.intentId);
      assert.equal(withdrawal.getSnapshot().phase, 'submitted');
      submitted.push(selected.id);
      route.abort(); await withdrawal.dispose();
    }
    const before = await f.privateNotes();
    assert.equal(before.length, 7);
    assert(before.every(note => note.withdrawal?.phase === 'submitted'));
    f.enableCompletionReads();
    // The controlled clock advances in exact milliseconds; avoid subtracting
    // unrelated floating-point fractions from the real process clock.
    let elapsed = Math.trunc(performance.now());
    const start = elapsed;
    context.mock.method(performance, 'now', () => elapsed);
    const checked: string[] = [];
    const slow = new Set(before.filter(note => note.id !== submitted[6]).map(note => note.withdrawal!.transactionHash));
    f.missingCompletionReceipts(hash => {
      checked.push(hash);
      if (!slow.has(hash)) return false;
      elapsed += 11_000;
      return true;
    });
    let route = new AbortController(); routes.push(route);
    maintenance = await f.runtime.openNoteMaintenance!(route.signal, noop, createTestPrivateAuthentication(noop));
    const inventory = await maintenance.getNotes(noop);
    assert.equal(inventory.notes.length, 7);
    const first = before.find(note => note.id === submitted[0])!;
    const last = before.find(note => note.id === submitted[6])!;
    let authorizations = f.secretReads;
    let reloaded = false;
    assert.deepEqual(await maintenance.clearCompletedNotes([first.id], noop, noop, inventory => {
      reloaded = true; assert.equal(inventory.notes.length, 7);
    }), { removed: [], unresolved: [first.id] });
    assert(reloaded);
    assert.equal(elapsed - start, 11_000);
    assert.equal(f.secretReads, authorizations + 1);
    route.abort(); await maintenance.dispose(); maintenance = undefined;
    route = new AbortController(); routes.push(route);
    maintenance = await f.runtime.openNoteMaintenance!(route.signal, noop, createTestPrivateAuthentication(noop));
    assert.equal((await maintenance.getNotes(noop)).notes.length, 7);
    authorizations = f.secretReads;
    checked.length = 0; reloaded = false;
    const progress: number[] = [];
    assert.deepEqual(await maintenance.clearCompletedNotes([last.id], noop, value => progress.push(value.checked), inventory => {
      reloaded = true;
      assert.equal(inventory.notes.length, 6);
      assert(!inventory.notes.some(note => note.id === last.id));
    }), { removed: [last.id], unresolved: [] });
    assert(reloaded); assert.deepEqual(progress, [1]);
    assert.equal(elapsed - start, 11_000, 'The selected last note does not re-read the slow prefix');
    assert.equal(f.secretReads, authorizations + 1, 'Selecting another note requires fresh authorization');
    assert.deepEqual(checked, [last.withdrawal!.transactionHash, last.withdrawal!.transactionHash], 'Only the selected note is proved and revalidated');
    assert.equal(f.posted.length, 8, 'Maintenance does not sign or broadcast');
    route.abort(); await maintenance.dispose(); maintenance = undefined;
    await f.reopen();
    const after = await f.privateNotes();
    assert.equal(after.length, 7, 'Restart recovery includes the archived seventh secret');
    assertArchivedRecoveryNote(after.find(note => note.id === last.id), last);
    assert.deepEqual(after.filter(note => note.id !== last.id), before.filter(note => note.id !== last.id));
    const active = await readTestNoteInventory(f.runtime, noop);
    assert.equal(active.notes.length, 6);
    assert(active.notes.every(note => note.createdAt !== last.createdAt));
    assert.equal(active.archiveSummary?.noteCount, 1);
  } finally {
    context.mock.restoreAll();
    routes.forEach(route => route.abort());
    await maintenance?.dispose();
    await f.close();
  }
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
    const removed = assert.rejects(maintenance.clearCompletedNotes([note.id], noop, noop, noop)); await assertCheckpointReached(entered.promise, removed);
    let retired: Promise<void>;
    if (cancel === 'lock') retired = f.runtime.session.lock();
    else { route.abort(); retired = maintenance.dispose(); }
    release.resolve(); await removed; await retired; hold = false;
    if (cancel === 'lock') await f.runtime.session.unlock();
    assert.deepEqual((await f.privateNotes()).map(saved => saved.id), [note.id]);
    route.abort(); await maintenance.dispose(); await f.reopen();
    assert.deepEqual((await f.privateNotes()).map(saved => saved.id), [note.id]);
  } finally { hold = false; release.resolve(); route.abort(); await f.close(); }
});

test('native maintenance preserves a lost-ack archive and never processes the remaining notes', async () => {
  let armed = false, noteWrite = false, writes = 0;
  const f = await fixture({ after(kind, sql) {
    if (armed && kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) { noteWrite = true; writes++; }
    if (armed && noteWrite && kind === 'exec' && sql === 'COMMIT') {
      armed = false; throw Error('Synthetic lost maintenance acknowledgement');
    }
  } });
  const route = new AbortController();
  try {
    const inventory = await f.seed(), withdrawalRoute = new AbortController();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, withdrawalRoute.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' }); await model.confirm(model.getSnapshot().review!.intentId);
    withdrawalRoute.abort(); await model.dispose();
    await f.restore(); await f.restore('03'); f.enableCompletionReads();
    const before = await f.privateNotes(), completed = before.find(note => note.withdrawal)!;
    const remaining = before.filter(note => note !== completed).map(note => note.id);
    assert.equal(remaining.length, 2);
    const maintenance = await f.runtime.openNoteMaintenance!(route.signal, noop, createTestPrivateAuthentication(noop));
    const authorizations = f.secretReads, progress: number[] = [];
    armed = true;
    await assert.rejects(maintenance.clearCompletedNotes([completed.id], noop, value => progress.push(value.checked), noop));
    assert.equal(writes, 1); assert.deepEqual(progress, []);
    assert.equal(f.secretReads, authorizations + 1, 'An uncertain commit must not cause another prompt or replay');
    route.abort(); await maintenance.dispose(); await f.reopen();
    const after = await f.privateNotes();
    assert.equal(after.length, before.length, 'An uncertain archive acknowledgement never deletes the selected secret');
    assertArchivedRecoveryNote(after.find(note => note.id === completed.id), completed);
    assert.deepEqual(after.filter(note => note.id !== completed.id), before.filter(note => note.id !== completed.id));
    const active = await readTestNoteInventory(f.runtime, noop);
    assert.equal(active.notes.length, remaining.length);
    assert(active.notes.every(note => note.createdAt !== completed.createdAt));
    assert.equal(active.archiveSummary?.noteCount, 1);
  } finally { armed = false; route.abort(); await f.close(); }
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
    await assertCheckpointReached(entered.promise, change); const locked = f.runtime.session.lock(); release.resolve(); await change; await locked; hold = false;
    await f.runtime.session.unlock();
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
    f.refuseNextAuthorization();
    const refusedAt = f.secretReads;
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id, noop, noop));
    assert.equal(f.secretReads, refusedAt + 1, 'A refused action must not prompt again for a reload');
    assert.equal((await f.privateNotes())[0]!.withdrawal?.recovery, undefined);
    const authorizedAt = f.secretReads;
    let reloaded = false;
    await maintenance.recoverFailedWithdrawal(before.id, noop, inventory => {
      reloaded = true; assert.equal(inventory.notes[0]!.withdrawal?.canCheckRecovery, undefined);
    });
    assert(reloaded); assert.equal(f.secretReads, authorizedAt + 1, 'Recovery and reload share one authorization');
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
    const sending = model.confirm(model.getSnapshot().review!.intentId); await assertCheckpointReached(entered.promise, sending);
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
    const sending = model.confirm(model.getSnapshot().review!.intentId); await assertCheckpointReached(entered.promise, sending);
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
  const recovery = new NativeRecoveryCoordinator({ isAuthenticationActive: () => false, credentialPort,
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
    await assert.rejects(prepareRecoveryCredential(recovery, PHRASE, noop).then(value => { proof = value; }), { code: 'UNAVAILABLE' });
    assert.equal(proof, undefined); assert.equal(recoveryOpens, 0, 'failed retirement never grants a new storage/snapshot lease');
    await assert.rejects(f.runtime.storage.retireForRecovery!(), { code: 'CLEANUP_FAILED' });
    await assert.rejects(f.runtime.storage.close(), { code: 'CLEANUP_FAILED' });
    await assert.rejects(f.storage.readState(), { code: 'STORAGE_CLOSED' });
    await assert.rejects(f.runtime.session.unlock());
    assert.equal(f.disposed, previousDisposals + 1, 'failed exact cleanup is not repeated or hidden');
    assert.equal(f.posted.length, fault === 'release' ? 0 : 2);
  } finally { failRead = false; route.abort(); await recovery.dispose(); await f.close(); }
});

test('a displaced privacy withdrawal recovers only after finalized nonce consumption and proof expiry, preserving the journal across restart', async () => {
  const f = await fixture(), route = new AbortController();
  let maintenance: Awaited<ReturnType<NonNullable<KeyringRuntime['openNoteMaintenance']>>> | undefined;
  try {
    const inventory = await f.seed(), withdrawalRoute = new AbortController();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, withdrawalRoute.signal, noop, testInventoryAuthentication(inventory));
    await model.prepare({ recipient: RECIPIENT, mode: 'direct' }); await model.confirm(model.getSnapshot().review!.intentId);
    withdrawalRoute.abort(); await model.dispose();
    const [before] = await f.privateNotes(); assert(before?.withdrawal?.transactionHash);
    const originalHash = before.withdrawal.transactionHash, originalNonce = Number(before.withdrawal.nonce);
    f.enableCompletionReads(); f.missingCompletionReceipts(hash => hash === originalHash);
    f.completionPoolState(true); f.finalizedPayerNonce(originalNonce + 1);
    maintenance = await f.runtime.openNoteMaintenance!(route.signal, noop, createTestPrivateAuthentication(noop));
    const oldBytes = await f.storage.notes!.read();
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id, noop, noop), /privacy_withdrawal_recovery_unavailable/);
    assert.deepEqual(await f.storage.notes!.read(), oldBytes, 'a live disclosed proof cannot be cleared by payer cancellation');
    f.completionPoolState(false); f.finalizedPayerNonce(originalNonce);
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id, noop, noop), /privacy_withdrawal_recovery_unavailable/);
    assert.deepEqual(await f.storage.notes!.read(), oldBytes);
    f.finalizedPayerNonce(originalNonce + 1); f.completionPoolState(false, true);
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id, noop, noop), /privacy_withdrawal_recovery_unavailable/);
    assert.deepEqual(await f.storage.notes!.read(), oldBytes);
    f.completionPoolState(false);
    let nonceReads = 0;
    f.beforeRpc(async method => { if (method === 'eth_getTransactionCount' && ++nonceReads === 2) f.completionPoolState(true); });
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id, noop, noop), /privacy_withdrawal_recovery_unavailable/);
    assert.equal(nonceReads, 2, 'the same finalized evidence is checked again immediately before storage mutation');
    assert.deepEqual(await f.storage.notes!.read(), oldBytes);
    f.beforeRpc(async () => undefined); f.completionPoolState(false);
    const posted = f.posted.length, signatures = f.signatures, authorizations = f.secretReads;
    await maintenance.recoverFailedWithdrawal(before.id, noop, noop);
    assert.equal(f.secretReads, authorizations + 1, 'original record lookup and recovery reuse the same authentication');
    assert.equal(f.posted.length, posted); assert.equal(f.signatures, signatures);
    const [after] = await f.privateNotes(); assert(after?.withdrawal?.recovery);
    assert.equal(after.note, before.note); assert.equal(after.withdrawal.transactionHash, originalHash);
    assert.equal(after.withdrawal.proofHash, before.withdrawal.proofHash); assert.equal(after.withdrawal.inputHash, before.withdrawal.inputHash);
    route.abort(); await maintenance.dispose(); maintenance = undefined; await f.reopen();
    assert.deepEqual((await f.privateNotes())[0]!.withdrawal, after.withdrawal);
    await f.runtime.resetActivity(noop, noop);
    const freshInventory = await readTestNoteInventory(f.runtime, noop);
    const retry = await freshInventory.openWithdrawal!(freshInventory.notes[0]!, new AbortController().signal, noop, testInventoryAuthentication(freshInventory));
    await retry.prepare({ recipient: RECIPIENT, mode: 'direct' });
    assert.equal(retry.getSnapshot().phase, 'review', 'fresh proof and fee consent are required after recovery');
    assert.equal(f.posted.length, posted); await retry.dispose();
  } finally { route.abort(); await maintenance?.dispose(); await f.close(); }
});

for (const lostReply of [false,true]) test(`native relayed proof expiry recovery survives restart (lost reply: ${lostReply}) without trusting relayer failure or using its nonce`, async () => {
  const f = await fixture(), route = new AbortController();
  let maintenance: Awaited<ReturnType<NonNullable<KeyringRuntime['openNoteMaintenance']>>> | undefined;
  try {
    const inventory = await f.seed(), withdrawalRoute = new AbortController();
    const model = await inventory.openWithdrawal!(inventory.notes[0]!, withdrawalRoute.signal, noop, testInventoryAuthentication(inventory));
    await model.loadRelayers();
    await model.prepare({recipient:RECIPIENT,mode:'relayed',relayerId:model.getSnapshot().relayers[0]!.id});
    f.loseResponse(lostReply);
    await model.confirm(model.getSnapshot().review!.intentId);
    assert.equal(model.getSnapshot().phase,lostReply?'unknown':'submitted');
    withdrawalRoute.abort(); await model.dispose();
    const [before] = await f.privateNotes(); assert(before?.withdrawal?.publicInputs);
    assert.equal(before.withdrawal.phase,lostReply?'unknown':'submitted');
    f.loseResponse(false); f.enableCompletionReads(); f.completionPoolState(true);
    maintenance = await f.runtime.openNoteMaintenance!(route.signal,noop,createTestPrivateAuthentication(noop));
    const disk = await f.storage.notes!.read();
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id,noop,noop),/privacy_withdrawal_recovery_unavailable/);
    assert.deepEqual(await f.storage.notes!.read(),disk);
    f.completionPoolState(false,true);
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id,noop,noop),/privacy_withdrawal_recovery_unavailable/);
    assert.deepEqual(await f.storage.notes!.read(),disk);
    f.completionPoolState(false);
    let rootReads = 0;
    f.beforeRpc(async method => { if (method==='eth_call' && ++rootReads===3) f.completionPoolState(true); });
    await assert.rejects(maintenance.recoverFailedWithdrawal(before.id,noop,noop),/privacy_withdrawal_recovery_unavailable/);
    assert.deepEqual(await f.storage.notes!.read(),disk,'prewrite evidence is repeated, not trusted from preparation');
    f.beforeRpc(async()=>undefined); f.completionPoolState(false);
    const rpcStart=f.rpcMethods.length, secretReads=f.secretReads, posts=f.relayedPosts.length, signed=f.signatures;
    await maintenance.recoverFailedWithdrawal(before.id,noop,noop);
    assert.equal(f.secretReads,secretReads+1,'recovery uses one existing authenticated lease');
    assert.equal(f.relayedPosts.length,posts); assert.equal(f.signatures,signed);
    assert(f.rpcMethods.slice(rpcStart).every(method=>['eth_chainId','eth_getBlockByNumber','eth_call'].includes(method)));
    const [after]=await f.privateNotes(); assert(after?.withdrawal?.recovery);
    assert.equal(after.withdrawal.recovery.kind,'relayed-proof-expired');
    assert.deepEqual({...after.withdrawal,recovery:undefined},{...before.withdrawal,recovery:undefined});
    route.abort(); await maintenance.dispose(); maintenance=undefined; await f.reopen();
    assert.deepEqual((await f.privateNotes())[0]!.withdrawal,after.withdrawal);
    const fresh=await readTestNoteInventory(f.runtime,noop);
    const retry=await fresh.openWithdrawal!(fresh.notes[0]!,new AbortController().signal,noop,testInventoryAuthentication(fresh));
    await retry.prepare({recipient:RECIPIENT,mode:'direct'});
    assert.equal(retry.getSnapshot().phase,'review'); assert.equal(f.relayedPosts.length,posts); await retry.dispose();
  } finally { route.abort(); await maintenance?.dispose(); await f.close(); }
});
