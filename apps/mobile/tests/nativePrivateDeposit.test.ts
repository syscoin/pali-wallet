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
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';
import type { createNativePrivacyPoolSync } from '../src/privacy/nativePrivacyPoolSync.ts';
import type { IPrivateNoteStatus } from '../../../source/utils/privacy/privateVaultTypes.ts';
import { getPrivacyPool } from '../../../source/utils/privacy/registry.ts';
import { readPrivateVaultBundle } from '../../../source/wallet/privateVaultInspection.ts';

const pinCredential = createTestPinCredentialPort();

const sdk = await loadNativeKeyringSdk();
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = '123456';
const noop = () => undefined;
const depositAbi = new Interface(['function deposit(bytes32) payable']);

async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-private-deposit-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage!: SqliteWalletStorage;
  let initialized = false;
  let runtime!: KeyringRuntime;
  let keyring!: InstanceType<typeof sdk.HostKeyring>;
  let secretLeases = 0, leasesAtBroadcast: number | undefined;
  let privateAccess: { released: Promise<void>; disposed: boolean } | undefined;
  const credentialRequests: string[] = [];
  let beforeCredential: () => Promise<void> = async () => {};
  let beforeNoteEncryption: () => Promise<void> = async () => {};
  class ObservedKeyring extends sdk.HostKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...args);
      keyring = this;
    }
    override withSecretOperation<T>(
      credential: Parameters<InstanceType<typeof sdk.HostKeyring>['withSecretOperation']>[0],
      options: Parameters<InstanceType<typeof sdk.HostKeyring>['withSecretOperation']>[1],
      work: (secret: string) => T | Promise<T>
    ): Promise<T> { secretLeases++; return super.withSecretOperation(credential, options, work); }
    override async createPrivateRecordAccess(
      domains: readonly string[], options: Parameters<InstanceType<typeof sdk.HostKeyring>['createPrivateRecordAccess']>[1]
    ): Promise<Awaited<ReturnType<InstanceType<typeof sdk.HostKeyring>['createPrivateRecordAccess']>>> {
      const access = await super.createPrivateRecordAccess(domains, options);
      if (!domains.includes('org.syscoin.pali.privacy.notes.v1')) return access;
      let release!: () => void;
      const tracked = { released: new Promise<void>(resolve => { release = resolve; }), disposed: false };
      privateAccess = tracked;
      return Object.freeze({ getPrivateRecordProfileId: access.getPrivateRecordProfileId,
        async encryptPrivateRecord(input: Parameters<typeof access.encryptPrivateRecord>[0]) { await beforeNoteEncryption(); return access.encryptPrivateRecord(input); }, decryptPrivateRecord: access.decryptPrivateRecord,
        dispose() { access.dispose(); tracked.disposed = true; release(); } });
    }
  }
  let beforeResponse: () => Promise<void> = async () => undefined;
  let lost = false;
  let failPoolDispose = false;
  let noteStatus: IPrivateNoteStatus = { phase: 'waiting' };
  const posted: string[] = [];
  const poolReads: string[] = [];
  let opened = 0,
    disposed = 0,
    refreshes = 0;
  const connectionFetch: typeof fetch = async (_url, init) => {
    assert.equal(keyring.isUnlocked(), false, 'public RPC and broadcast never hold signing keys');
    const { id, method, params } = JSON.parse(String(init?.body));
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getBlockByNumber')
      result = {
        number: '0x10',
        hash: '0x' + 'aa'.repeat(32),
        gasLimit: '0x1c9c380',
        baseFeePerGas: '0x2',
      };
    else if (method === 'eth_getTransactionCount') result = '0x0';
    else if (method === 'eth_getBalance') result = '0x56bc75e2d63100000';
    else if (method === 'eth_gasPrice') result = '0x5';
    else if (method === 'eth_maxPriorityFeePerGas') result = '0x1';
    else if (method === 'eth_estimateGas') result = '0x186a0';
    else if (method === 'eth_sendRawTransaction') {
      const raw = params[0] as string;
      const transaction = Transaction.from(raw);
      assert.equal(transaction.to?.toLowerCase(), getPrivacyPool('eth-1').address);
      assert.equal(transaction.value, 10n ** 18n);
      assert.equal(depositAbi.parseTransaction({ data: transaction.data })?.name, 'deposit');
      const saved = await storage.signedRecords.read(
        (await storage.recovery.readIdentity())!.root!.profileId
      );
      assert(saved);
      assert(
        JSON.parse(saved).entries.some(
          (entry: any) => entry.hash === transaction.hash && entry.metadata?.privateDeposit
        )
      );
      posted.push(raw);
      leasesAtBroadcast = secretLeases;
      await beforeResponse();
      if (lost) throw Error('synthetic response lost');
      result = transaction.hash;
    } else throw Error(`Unexpected RPC ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const factory = createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (request, _signal, check) => { check(); credentialRequests.push(request.purpose); await beforeCredential(); check(); return { method: 'pin', pin: PASSWORD }; }, privacyServiceSettings: null, slhExecution: null,
    readEvmRetirement: null,
    ensureCryptoReady: async () => undefined,
    loadSdk: async () => ({ ...sdk, HostKeyring: ObservedKeyring }),
    connectionFetch,
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
          assert.equal(keyring.isUnlocked(), false, 'private pool reads use only the authorized record capability');
          assert(!signal.aborted);
          assert.equal(identity.poolId, poolId);
          poolReads.push(poolId);
          return noteStatus;
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
    posted,
    credentialRequests,
    get secretLeases() { return secretLeases; },
    get privateAccess() { return privateAccess; },
    assertNoSigningKeys() { assert.equal(keyring.isUnlocked(), false); },
    beforeCredential(callback: () => Promise<void>) { beforeCredential = callback; },
    beforeNoteEncryption(callback: () => Promise<void>) { beforeNoteEncryption = callback; },
    assertAcknowledgementKeyLifetime() {
      assert.equal(secretLeases, leasesAtBroadcast, 'post-broadcast private acknowledgement must use only its retained record keys');
      assert.equal(keyring.isUnlocked(), false);
    },
    poolReads,
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
    async select(id: string) {
      const accounts = runtime.accounts!;
      await accounts
        .reserve({ kind: 'select', id }, accounts.getSnapshot()!.revision)
        .execute(noop);
    },
    async selectNetwork(id: string) {
      await runtime.networks!.reserve(id, runtime.catalogue.getSnapshot()!.revision).execute(noop);
    },
    async addAccount() {
      const accounts = runtime.accounts!;
      await accounts
        .reserve(
          { kind: 'create', label: 'Second', password: PASSWORD },
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
    failPoolCleanup() { failPoolDispose = true; },
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

test('native deposit persists its generated note and exact reviewed metadata before actual SDK broadcast', async () => {
  const f = await fixture();
  const lifetime = new AbortController();
  const operation = await f.runtime.openPrivateDeposit!(lifetime.signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    const view = operation.getSnapshot();
    assert.equal(view.phase, 'review');
    assert(view.review);
    assert.equal(f.posted.length, 0);
    assert.equal(f.refreshes, 0, 'first deposit keeps extension waiting-reader semantics');
    assert(f.poolReads.length > 0, 'operational checks use the real pool reader');
    await operation.confirm(view.review.intentId);
    assert.equal(operation.getSnapshot().phase, 'submitted');
    f.assertAcknowledgementKeyLifetime();
    assert.equal(f.posted.length, 1);
    await operation.confirm(view.review.intentId);
    assert.equal(f.posted.length, 1);
    f.setStatus({ phase: 'verified', blockNumber: 16 });
    await operation.refresh();
    assert.equal(operation.getSnapshot().status?.phase, 'verified');
    assert.equal(f.refreshes, 1);
    const inventory = await f.runtime.readNoteInventory!(noop);
    assert.equal(inventory.notes.length, 1);
  } finally {
    await operation.dispose();
    await f.close();
  }
  assert.equal(f.opened, f.disposed);
});

test('native deposit rejects a positive spent observation before any signature or POST', async () => {
  const f = await fixture();
  f.setStatus({ phase: 'spent', blockNumber: 16 });
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    assert.equal(operation.getSnapshot().phase, 'failed');
    assert.equal(f.posted.length, 0);
  } finally {
    await operation.dispose();
    await f.close();
  }
});

test('a lost native deposit response remains unknown with its protected signed recovery hash', async () => {
  const f = await fixture();
  f.loseResponse(true);
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    await operation.confirm(operation.getSnapshot().review!.intentId);
    const state = operation.getSnapshot();
    assert.equal(state.phase, 'unknown');
    assert.equal(state.result?.signedTransactionHash, Transaction.from(f.posted[0]!).hash);
    assert.equal(f.posted.length, 1);
  } finally {
    await operation.dispose();
    await f.close();
  }
});

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('cancelling a held reservation rolls it back before any signature or POST', async () => {
  const held = deferred(),
    entered = deferred();
  let inserts = 0;
  const f = await fixture({
    async before(kind, sql) {
      if (kind === 'run' && sql.startsWith('INSERT INTO private_note_records') && ++inserts === 2) {
        entered.release();
        await held.promise;
      }
    },
  });
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    const confirming = operation.confirm(operation.getSnapshot().review!.intentId);
    await entered.promise;
    const closing = operation.dispose();
    held.release();
    await Promise.all([confirming, closing]);
    assert.equal(f.posted.length, 0);
    assert.equal((await f.runtime.readNoteInventory!(noop)).notes.length, 1);
  } finally {
    held.release();
    await operation.dispose();
    await f.close();
  }
});

test('a lost private ACK write quarantines custody while preserving the acknowledged hash', async () => {
  let noteWrites = 0,
    changed = false;
  const f = await fixture({
    after(kind, sql) {
      if (kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) {
        noteWrites++;
        changed = true;
      }
      if (kind === 'exec' && sql === 'COMMIT' && changed) {
        changed = false;
        if (noteWrites === 3) throw Error('synthetic lost deposit acknowledgement');
      }
    },
  });
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    await operation.confirm(operation.getSnapshot().review!.intentId);
    assert.equal(f.posted.length, 1);
    assert.equal(
      operation.getSnapshot().result?.transactionHash,
      Transaction.from(f.posted[0]!).hash
    );
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    await assert.rejects(f.runtime.session.readSelectedAddress());
  } finally {
    await operation.dispose();
    await f.close();
  }
});

test('private saved-byte replay ignores stale cancel and confirm IDs', async () => {
  const f = await fixture();
  f.loseResponse(true);
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    await operation.confirm(operation.getSnapshot().review!.intentId);
    const hash = operation.getSnapshot().result!.signedTransactionHash!;
    await operation.dispose();
    const replay = f.runtime.transfers!.replay(
      noop,
      {
        observe: async () => { f.assertNoSigningKeys(); return { status: 'missing', latestNonce: '0' }; },
        dispatch: async (raw, admit) =>
          { f.assertNoSigningKeys(); return admit(
            () => Promise.resolve(Transaction.from(raw).hash!),
            async () => undefined
          ); },
      },
      { now: () => 1000, randomBytes: (n) => new Uint8Array(n).fill(5) }
    );
    const beforeInspect = f.secretLeases;
    const inspected = await replay.prepare(hash, 'inspect');
    assert.equal(inspected.status, 'unknown');
    assert.equal(f.secretLeases, beforeInspect, 'private transaction status is public-only');
    const prepared = await replay.prepare(hash, 'resend');
    assert.equal(f.credentialRequests.at(-1), 'private-reconciliation');
    const beforeRetry = f.secretLeases;
    assert.equal(prepared.status, 'review');
    if (prepared.status !== 'review') throw Error('Expected review');
    const before = f.disposed;
    replay.cancel('stale');
    await assert.rejects(replay.confirm('stale'));
    assert.equal(f.disposed, before);
    await f.runtime.security!.authenticateOperation({ method: 'pin', pin: PASSWORD }, noop);
    assert.deepEqual(await replay.confirm(prepared.review.id), { status: 'submitted', hash });
    assert.equal(f.secretLeases, beforeRetry, 'private retry and ACK reuse only their authorized record capability');
    f.assertNoSigningKeys();
    assert(f.poolReads.length > 0);
  } finally {
    await operation.dispose();
    await f.close();
  }
});

for (const retirement of ['cancel', 'account-change'] as const)
  test(`private replay reconciliation rejects ${retirement} before releasing note or signing keys`, async () => {
    const f = await fixture();
    f.loseResponse(true);
    const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
    try {
      await operation.prepare({ poolId: 'eth-1' });
      await operation.confirm(operation.getSnapshot().review!.intentId);
      const hash = operation.getSnapshot().result!.signedTransactionHash!;
      await operation.dispose();
      if (retirement === 'account-change') await f.addAccount();
      if (retirement === 'account-change') await f.select('hd:60:0');
      const replay = f.runtime.transfers!.replay(noop, {
        observe: async () => ({ status: 'missing', latestNonce: '0' }),
        dispatch: async () => { throw Error('Cancelled reconciliation must not dispatch'); },
      }, { now: () => 1000, randomBytes: n => new Uint8Array(n).fill(5) });
      const entered = deferred(), release = deferred();
      const leases = f.secretLeases;
      f.beforeCredential(async () => { entered.release(); await release.promise; });
      const preparing = replay.prepare(hash, 'resend');
      const rejected = assert.rejects(preparing);
      await entered.promise;
      if (retirement === 'cancel') replay.cancel();
      else await f.select('hd:60:1');
      release.release(); await rejected;
      assert.equal(f.secretLeases, leases, 'stale consent never opens a secret operation');
      f.assertNoSigningKeys();
      assert.equal(f.posted.length, 1);
    } finally { await operation.dispose(); await f.close(); }
  });

for (const change of ['account', 'lock-unlock'] as const)
  test(`native deposit ACK keeps wallet identity across ${change}`, async () => {
    const f = await fixture();
    if (change === 'account') {
      await f.addAccount();
      await f.select('hd:60:0');
    }
    const posted = deferred(),
      release = deferred();
    f.beforeResponse(async () => {
      posted.release();
      await release.promise;
    });
    const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
    try {
      await operation.prepare({ poolId: 'eth-1' });
      const confirming = operation.confirm(operation.getSnapshot().review!.intentId);
      await posted.promise;
      if (change === 'account') await f.select('hd:60:1');
      else {
        await f.runtime.session.lock();
        await f.runtime.session.unlock(PASSWORD);
      }
      release.release();
      await confirming;
      const note = (await f.privateNotes())[0]!;
      assert.equal(note.deposit?.phase, change === 'account' ? 'submitted' : 'unknown');
      if (change === 'account')
        assert.equal(note.deposit?.transactionHash, Transaction.from(f.posted[0]!).hash);
      assert.equal(f.posted.length, 1);
    } finally {
      release.release();
      await operation.dispose();
      await f.close();
    }
  });

test('cross-SLIP selection drains the dispatched private ACK before transferring its wallet', async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  let hold = false;
  f.beforeResponse(async () => { hold = true; });
  f.beforeNoteEncryption(async () => { if (hold) { hold = false; entered.release(); await release.promise; } });
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    const confirming = operation.confirm(operation.getSnapshot().review!.intentId);
    await entered.promise;
    assert.equal(f.posted.length, 1, 'the SDK response precedes the held note acknowledgement');
    let selected = false;
    const selecting = f.selectNetwork('bitcoin').then(() => { selected = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(selected, false);
    assert.equal(f.runtime.networks!.getSelectedId(), 'ethereum');
    release.release(); await confirming; await selecting;
    assert.equal(f.runtime.networks!.getSelectedId(), 'bitcoin');
    await f.selectNetwork('ethereum');
    const note = (await f.privateNotes())[0]!;
    assert.equal(note.deposit?.phase, 'submitted');
    assert.equal(note.deposit?.transactionHash, Transaction.from(f.posted[0]!).hash);
    assert.equal(f.posted.length, 1); f.assertNoSigningKeys();
  } finally { release.release(); await operation.dispose(); await f.close(); }
});

test('already aborted native deposit creation leaves no pool owner', async () => {
  const f = await fixture(),
    abort = new AbortController();
  abort.abort();
  try {
    await assert.rejects(f.runtime.openPrivateDeposit!(abort.signal, noop));
    assert.equal(f.opened, 0);
  } finally {
    await f.close();
  }
});


test('private replay keeps only its receipt capability after cancellation during dispatch', async () => {
  const f = await fixture(); f.loseResponse(true);
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  const entered = deferred(), release = deferred();
  try {
    await operation.prepare({ poolId: 'eth-1' });
    await operation.confirm(operation.getSnapshot().review!.intentId);
    const hash = operation.getSnapshot().result!.signedTransactionHash!;
    await operation.dispose();
    const replay = f.runtime.transfers!.replay(noop, {
      observe: async () => ({ status: 'missing', latestNonce: '0' }),
      dispatch: (raw, admit) => admit(async () => {
        f.assertNoSigningKeys(); entered.release(); await release.promise;
        return Transaction.from(raw).hash!;
      }, async () => undefined),
    }, { now: () => 1000, randomBytes: n => new Uint8Array(n).fill(5) });
    const prepared = await replay.prepare(hash, 'resend');
    if (prepared.status !== 'review') throw Error('Expected replay review');
    const leases = f.secretLeases;
    const pending = replay.confirm(prepared.review.id);
    await Promise.race([entered.promise, pending.then(() => { throw Error('Replay did not dispatch'); })]);
    replay.cancel(); release.release();
    await pending.catch(() => undefined);
    assert.equal(f.secretLeases, leases, 'late receipt persistence cannot reopen signing material');
    f.assertNoSigningKeys();
    assert.equal((await f.privateNotes())[0]!.deposit?.transactionHash, hash);
  } finally { release.release(); await operation.dispose(); await f.close(); }
});

for (const outcome of ['confirmed', 'reverted'] as const)
  test(`terminal private replay ${outcome} releases its note capability after reconciliation`, async () => {
    const f = await fixture(); f.loseResponse(true);
    const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
    try {
      await operation.prepare({ poolId: 'eth-1' });
      await operation.confirm(operation.getSnapshot().review!.intentId);
      const hash = operation.getSnapshot().result!.signedTransactionHash!;
      await operation.dispose();
      const replay = f.runtime.transfers!.replay(noop, {
        observe: async () => ({ status: 'mined', outcome, block: { hash: '0x' + 'ab'.repeat(32), number: '1' } }),
        dispatch: async () => { throw Error('Mined records must not dispatch'); },
      }, { now: () => 1000, randomBytes: n => new Uint8Array(n).fill(5) });
      const terminal = await replay.prepare(hash, 'resend');
      assert.equal(terminal.status, outcome);
      const leases = f.secretLeases;
      assert(f.privateAccess);
      await f.privateAccess.released;
      assert.equal(f.privateAccess.disposed, true);
      assert.equal(f.secretLeases, leases);
      f.assertNoSigningKeys();
    } finally { await operation.dispose(); await f.close(); }
  });

test('private replay quarantines a failed ACK write even if its pool disposal also fails', async () => {
  let noteWrites = 0, changed = false;
  const f = await fixture({ after(kind, sql) {
    if (kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) { noteWrites++; changed = true; }
    if (kind === 'exec' && sql === 'COMMIT' && changed) {
      changed = false;
      if (noteWrites === 3) throw Error('synthetic replay ACK loss');
    }
  } });
  f.loseResponse(true);
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    await operation.confirm(operation.getSnapshot().review!.intentId);
    const hash = operation.getSnapshot().result!.signedTransactionHash!;
    await operation.dispose();
    f.failPoolCleanup();
    const replay = f.runtime.transfers!.replay(noop, {
      observe: async () => ({ status: 'missing', latestNonce: '0' }),
      dispatch: async (raw, admit) => admit(() => Promise.resolve(Transaction.from(raw).hash!), async () => undefined),
    }, { now: () => 1000, randomBytes: n => new Uint8Array(n).fill(5) });
    const prepared = await replay.prepare(hash, 'resend');
    if (prepared.status !== 'review') throw Error('Expected replay review');
    await replay.confirm(prepared.review.id).catch(() => undefined);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    await assert.rejects(f.runtime.session.readSelectedAddress());
  } finally { await f.close(); }
});

test('older replay completion cannot close a newly prepared private reader', { timeout: 5000 }, async () => {
  const f = await fixture();
  f.loseResponse(true);
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    await operation.confirm(operation.getSnapshot().review!.intentId);
    const hash = operation.getSnapshot().result!.signedTransactionHash!;
    await operation.dispose();
    const posted = deferred(), finish = deferred();
    let sends = 0;
    const replay = f.runtime.transfers!.replay(noop, {
      observe: async () => ({ status: 'missing', latestNonce: '0' }),
      dispatch: async (raw, admit) => admit(async () => {
        if (++sends === 1) { posted.release(); await finish.promise; }
        return Transaction.from(raw).hash!;
      }, async () => undefined),
    }, { now: () => 1000, randomBytes: n => new Uint8Array(n).fill(5) });
    const first = await replay.prepare(hash, 'resend');
    if (first.status !== 'review') throw Error('Expected review');
    const old = replay.confirm(first.review.id);
    await Promise.race([posted.promise, old.then(() => { throw Error('Replay did not enter transport'); })]);
    const next = await replay.prepare(hash, 'resend');
    if (next.status !== 'review') throw Error('Expected second review');
    finish.release();
    await old;
    assert.deepEqual(await replay.confirm(next.review.id), { status: 'submitted', hash });
    assert.equal(sends, 2);
  } finally { await operation.dispose(); await f.close(); }
});

test('aborting during native deposit opening cannot attach late listeners or open a pool', async () => {
  const f = await fixture(), abort = new AbortController();
  const opening = f.runtime.openPrivateDeposit!(abort.signal, noop);
  abort.abort();
  try { await assert.rejects(opening); assert.equal(f.opened, 0); }
  finally { await f.close(); }
});

for (const poison of [false, true]) test(`a private-note read failure before replay handles quarantine=${poison}`, async () => {
  let failRead = false;
  const f = await fixture({ before(kind, sql) {
    if (failRead && kind === 'all' && sql.startsWith("SELECT 'note' AS source")) throw poison ? new WalletStorageError('STORAGE_REOPEN_REQUIRED') : Error('synthetic note read failure');
  } });
  f.loseResponse(true);
  const operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
  try {
    await operation.prepare({ poolId: 'eth-1' });
    await operation.confirm(operation.getSnapshot().review!.intentId);
    const hash = operation.getSnapshot().result!.signedTransactionHash!;
    await operation.dispose();
    const replay = f.runtime.transfers!.replay(noop, {
      observe: async () => ({ status: 'missing', latestNonce: '0' }),
      dispatch: async () => { throw Error('must not broadcast'); },
    }, { now: () => 1000, randomBytes: n => new Uint8Array(n).fill(5) });
    failRead = true;
    await assert.rejects(replay.prepare(hash, 'resend'));
    assert.equal(f.runtime.catalogue.getSnapshot() === null, poison);
  } finally { failRead = false; await f.close(); }
});


test('an imported EVM private key signs the exact native private-deposit review', async () => {
  const f = await fixture();
  const key = '0x' + '22'.repeat(32);
  const signer = new Wallet(key);
  let operation: Awaited<ReturnType<NonNullable<KeyringRuntime['openPrivateDeposit']>>> | undefined;
  try {
    await f.runtime.imports!.reserve({ privateKey: key, label: 'Imported', expectedAddress: signer.address }, PASSWORD, f.runtime.catalogue.getSnapshot()!.revision).execute(noop);
    await f.select('imported:60:0');
    operation = await f.runtime.openPrivateDeposit!(new AbortController().signal, noop);
    await operation.prepare({ poolId: 'eth-1' });
    const review = operation.getSnapshot().review!;
    assert.equal(review.account.address.toLowerCase(), signer.address.toLowerCase());
    await operation.confirm(review.intentId);
    assert.equal(operation.getSnapshot().phase, 'submitted');
    assert.equal(Transaction.from(f.posted[0]!).from, signer.address);
  } finally { await operation?.dispose(); await f.close(); }
});
