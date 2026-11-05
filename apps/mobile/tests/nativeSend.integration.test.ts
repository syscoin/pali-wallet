import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { keccak256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import type { TransferJournalEntry } from '../src/custody/transferJournal.ts';
import { inspectEvmSignedBundle } from '../../../source/wallet/evmSignedRecords.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public native transfer fixture password 1!';
const RECIPIENT = '0x1111111111111111111111111111111111111111';

test('shared SDK and SQLite retain exact pending bytes across a process-style authority restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-native-send-'));
  const file = path.join(directory, 'wallet.sqlite');
  const oldFetch = globalThis.fetch;
  let leakedNetwork = 0;
  let loseResponse = true;
  globalThis.fetch = (async () => {
    leakedNetwork++;
    throw Error('Public network forbidden');
  }) as typeof fetch;
  let storage: SqliteWalletStorage | undefined;
  let runtime: KeyringRuntime | undefined;
  let authority: NativeCustodyAuthority | undefined;
  let transfers: NativeTransfers | undefined;
  const submitted: string[] = [];
  const factory = createKeyringRuntimeFactory({
    async ensureCryptoReady() {
      assert.ok(globalThis.crypto.subtle);
    },
    async openStorage() {
      const fresh = !existsSync(file);
      storage = await SqliteWalletStorage.open(
        nodeConnection(file).connection,
        digest,
        INSTALLATION,
        fresh
      );
      return storage;
    },
  });
  const open = async () => {
    authority = new NativeCustodyAuthority({
      async open() {
        runtime = (await factory.open()) as KeyringRuntime;
        return runtime;
      },
    });
    await authority.initialize();
    const rpc = new NativeTransferRpc({ networkId: 'ethereum',
      fetch: async (_url, init) => {
        const b = JSON.parse(String(init.body));
        let result: unknown;
        if (b.method === 'eth_chainId') result = '0x1';
        else if (b.method === 'eth_getTransactionCount') result = '0x0';
        else if (b.method === 'eth_getBalance') result = '0x10000000000000000';
        else if (b.method === 'eth_gasPrice') result = '0x2';
        else if (b.method === 'eth_feeHistory')
          result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
        else if (b.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (b.method === 'eth_estimateGas') result = '0x5208';
        else if (b.method === 'eth_getTransactionReceipt') result = null;
        else if (b.method === 'eth_getBlockByNumber') result = { number: b.params[0] === 'latest' ? '0x20' : b.params[0], hash: '0x' + 'f'.repeat(64), baseFeePerGas: '0x1', gasLimit: '0x1c9c380' };
        else if (b.method === 'eth_sendRawTransaction') {
          const identity = await storage!.recovery.readIdentity();
          assert(identity?.root);
          const persisted = await storage!.signedRecords.read(identity.root.profileId);
          assert(persisted && inspectEvmSignedBundle(persisted, identity.root.profileId).transactions === 1);
          const entry = await (await runtime!.transfers!.journal(() => undefined)).load();
          assert(entry && ['signed', 'submitted'].includes(entry.phase));
          assert.equal(entry.rawTransaction, b.params[0]);
          assert(!persisted.includes(b.params[0]), 'physical bundle keeps wire bytes encrypted');
          submitted.push(b.params[0]);
          if (loseResponse)
            throw Error('Lost response after network acceptance');
          result = keccak256(b.params[0]);
        } else throw Error('Unexpected method');
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: b.id, result }),
          { headers: { 'content-type': 'application/json' } }
        );
      },
    });
    transfers = new NativeTransfers(authority, () => runtime?.transfers, {
      rpc,
    });
  };
  try {
    await open();
    await authority!.importPhrase(PHRASE, PASSWORD);
    await runtime!.backup.confirm(await runtime!.backup.fingerprint());
    authority!.lock();
    await authority!.unlock(PASSWORD);
    assert.equal(authority!.getSnapshot().phase, 'ready');
    await transfers!.prepare(RECIPIENT, '0.001');
    const review = transfers!.getSnapshot().review!;
    await transfers!.confirm(review.id);
    assert.equal(transfers!.getSnapshot().phase, 'unknown');
    const firstHash = transfers!.getSnapshot().hash;
    assert.equal(Transaction.from(submitted[0]!).to, RECIPIENT);
    assert.equal(Transaction.from(submitted[0]!).value, 1000000000000000n);
    transfers!.dispose();
    await authority!.dispose();
    await open();
    await authority!.unlock(PASSWORD);
    await transfers!.recover();
    assert.equal(transfers!.getSnapshot().hash, firstHash);
    assert.equal(transfers!.getSnapshot().phase, 'unknown');
    await assert.rejects(transfers!.prepare(RECIPIENT, '0.002'), {
      code: 'PENDING_TRANSFER',
    });
    await transfers!.recover(true);
    const retry = transfers!.getSnapshot().review!;
    assert.equal(retry.retry, true);
    loseResponse = false;
    await transfers!.confirm(retry.id);
    assert.equal(submitted.length, 2);
    assert.equal(submitted[0], submitted[1]);
    assert.equal(transfers!.getSnapshot().phase, 'pending');
    assert.equal(transfers!.getSnapshot().hash, firstHash);
    assert.equal(leakedNetwork, 0);
  } finally {
    transfers?.dispose();
    await authority?.dispose();
    globalThis.fetch = oldFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

async function cancellationFixture() {
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-send-cancel-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  let signatures = 0;
  let authentications = 0;
  let hydrations = 0;
  const sdkInstances: InstanceType<typeof sdk.SoftwareKeyring>[] = [];
  let journalGate: { phase: 'signed' | 'submitted'; written: boolean; entered(): void; release: Promise<void> } | null = null;
  let gate: {
    stage: 'storage-read' | 'requote';
    entered(): void;
    release: Promise<void>;
  } | null = null;
  const pause = async (stage: 'storage-read' | 'requote') => {
    const current = gate;
    if (current?.stage === stage) {
      current.entered();
      await current.release;
    }
  };
  // Keep the real SDK signer; pause only storage/RPC boundaries that still exist
  // in the unlocked-session flow. There is no per-send password or hydration.
  class ControlledKeyring extends sdk.SoftwareKeyring {
    constructor(host: ConstructorParameters<typeof sdk.SoftwareKeyring>[0]) {
      super(host);
      sdkInstances.push(this);
      const hydrate = this.createFirstAccount;
      this.createFirstAccount = async (...args) => {
        hydrations++;
        const result = await hydrate(...args);
        return result;
      };
    }
    async unlock(password: string) {
      authentications++;
      const result = await super.unlock(password);
      return result;
    }
    signPreparedEvmTransaction(
      ...args: Parameters<
        InstanceType<typeof sdk.SoftwareKeyring>['signPreparedEvmTransaction']
      >
    ) {
      signatures++;
      return super.signPreparedEvmTransaction(...args);
    }
  }
  const base = createKeyringRuntimeFactory({
    async ensureCryptoReady() {
      assert.ok(globalThis.crypto.subtle);
    },
    async openStorage() {
      const fresh = !existsSync(file);
      let native!: ReturnType<typeof nodeConnection>;
      native = nodeConnection(file, { after: async (kind, sql) => {
        if (kind === 'all' && sql.includes('FROM evm_signed_records')) await pause('storage-read');
        const current = journalGate;
        if (!current) return;
        if (kind === 'run' && sql.startsWith('INSERT INTO evm_signed_records')) {
          const row = native.database.prepare('SELECT value FROM evm_signed_records').get() as { value: string };
          const value = JSON.parse(row.value) as { entries: { phase: string }[] };
          current.written = value.entries.some((entry) => entry.phase === current.phase);
        }
        if (current.written && kind === 'exec' && sql === 'COMMIT') {
          current.entered();
          await current.release;
          throw Error('Lost signed-bundle commit acknowledgement');
        }
      } });
      storage = await SqliteWalletStorage.open(
        native.connection,
        digest,
        INSTALLATION,
        fresh
      );
      return storage;
    },
    loadSdk: async () => ({ ...sdk, SoftwareKeyring: ControlledKeyring }),
  });
  const createAuthority = () => new NativeCustodyAuthority({
    async open() {
      runtime = (await base.open()) as KeyringRuntime;
      return runtime;
    },
  });
  let authority = createAuthority();
  const broadcasts: string[] = [];
  let loseResponse = false;
  const largeReceipt = {
    oversized: false,
    repeated: false,
    receiptReads: 0,
    consumed: false,
  };
  let recovery: { receipt: Record<string, unknown> | null; nonce: string; canonicalHash: string } | undefined;
  const requests: { method: string; params: unknown[] }[] = [];
  const rpc = new NativeTransferRpc({ networkId: 'ethereum',
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getTransactionCount') {
        result = largeReceipt.oversized
          ? (request.params[1] === 'pending' || largeReceipt.consumed ||
              (largeReceipt.repeated && largeReceipt.receiptReads === 1) ? '0x1' : '0x0')
          : (recovery?.nonce ?? '0x0');
      } else if (request.method === 'eth_getBalance')
        result = '0x10000000000000000';
      else if (request.method === 'eth_gasPrice') result = '0x2';
      else if (request.method === 'eth_feeHistory')
        result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
      else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
      else if (request.method === 'eth_estimateGas') { await pause('requote'); result = '0x5208'; }
      else if (request.method === 'eth_getTransactionReceipt') {
        if (!largeReceipt.oversized) result = recovery?.receipt ?? null;
        else {
          largeReceipt.receiptReads++;
          const tx = Transaction.from(broadcasts[0]!);
          result = {
            transactionHash: tx.hash,
            from: tx.from,
            to: tx.to,
            status: '0x1',
            blockNumber: '0xa',
            blockHash: '0x' + '8'.repeat(64),
            ...(largeReceipt.repeated && largeReceipt.receiptReads === 1 ? {} : {
              logs: [{ address: tx.to, topics: [], data: '0x' + 'ab'.repeat(10_000) }],
            }),
          };
        }
      } else if (request.method === 'eth_getBlockByNumber') {
        if (largeReceipt.oversized) {
          assert(!['finalized', 'safe'].includes(request.params[0]), 'ordinary sends never request a settlement tag');
          const number = request.params[0];
          result = { number: number === 'latest' ? '0x20' : number, hash: '0x' + (number === '0xa' ? '8' : '9').repeat(64), baseFeePerGas: '0x1', gasLimit: '0x1c9c380' };
        } else {
          const current = recovery;
          assert(!['finalized', 'safe'].includes(request.params[0]), 'ordinary sends never request a settlement tag');
          const number = request.params[0];
          result = { number: number === 'latest' ? '0x20' : number, hash: current && number === current.receipt?.blockNumber ? current.canonicalHash : '0x' + 'f'.repeat(64), baseFeePerGas: '0x1', gasLimit: '0x1c9c380' };
        }
      } else if (request.method === 'eth_sendRawTransaction') {
        broadcasts.push(request.params[0]);
        if (loseResponse) throw Error('Lost acknowledgement');
        result = keccak256(request.params[0]);
      } else throw Error('Unexpected method');
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  let transfers = new NativeTransfers(authority, () => runtime?.transfers, {
    rpc,
  });
  try {
    await authority.initialize();
    await authority.importPhrase(PHRASE, PASSWORD);
    await runtime.backup.confirm(await runtime.backup.fingerprint());
    authority.lock();
    await authority.unlock(PASSWORD);
  } catch (error) {
    transfers.dispose();
    await authority.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    get authority() { return authority; },
    get runtime() { return runtime; },
    broadcasts,
    recovery: largeReceipt,
    requests,
    get transfers() { return transfers; },
    rpc,
    get signatures() { return signatures; },
    get authentications() { return authentications; },
    get hydrations() { return hydrations; },
    get sdkUnlocked() { return sdkInstances.some((instance) => instance.isUnlocked()); },
    holdJournal(phase: 'signed' | 'submitted') {
      let entered!: () => void;
      let resume!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const release = new Promise<void>((resolve) => { resume = resolve; });
      journalGate = { phase, written: false, entered, release };
      return { started, finish() { journalGate = null; resume(); } };
    },
    async readDurableJournal() {
      // Observe durable bytes independently of the quarantined runtime port.
      const { DatabaseSync } = await import('node:sqlite');
      const observer = new DatabaseSync(file, { readOnly: true });
      try {
        const row = observer.prepare('SELECT value FROM evm_signed_records').get() as { value: string } | undefined;
        if (row) inspectEvmSignedBundle(row.value);
        return row?.value;
      } finally { observer.close(); }
    },
    loseResponse() { loseResponse = true; },
    setRecovery(value: NonNullable<typeof recovery>) { recovery = structuredClone(value); },
    hold(stage: 'storage-read' | 'requote') {
      let entered!: () => void;
      let resume!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const release = new Promise<void>((resolve) => {
        resume = resolve;
      });
      gate = { stage, entered, release };
      return {
        started,
        finish() {
          gate = null;
          resume();
        },
      };
    },
    replaceTransfers() {
      transfers = new NativeTransfers(authority, () => runtime.transfers, {
        rpc,
      });
    },
    async reopen() {
      transfers.dispose();
      await authority.dispose();
      authority = createAuthority();
      await authority.initialize();
      await authority.unlock(PASSWORD);
      transfers = new NativeTransfers(authority, () => runtime.transfers, { rpc });
    },
    async readJournal() {
      return (await (await runtime.transfers!.journal(() => undefined)).load()) ?? undefined;
    },
    async close() {
      transfers.dispose();
      try { await authority.dispose(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

test('wall-clock rollback cannot hide an unresolved signed transfer after a cold reopen', async () => {
  const originalNow = Date.now;
  let wallClock = 2_000_000_000_000;
  Date.now = () => wallClock;
  let f: Awaited<ReturnType<typeof cancellationFixture>> | undefined;
  try {
    f = await cancellationFixture();
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const older = await f.readJournal() as TransferJournalEntry;
    const first = Transaction.from(older.rawTransaction);
    f.setRecovery({
      receipt: { transactionHash: older.hash, from: first.from, to: RECIPIENT,
        status: '0x1', blockNumber: '0x10', blockHash: '0x' + '1'.repeat(64) },
      nonce: '0x1', canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.transfers.recover();
    assert.equal((await f.readJournal())!.phase, 'confirmed');

    // Move only the wall-clock presentation timestamp backwards. Consent
    // deadlines continue to use the controller's actual monotonic clock.
    wallClock -= 60 * 60 * 1000;
    f.setRecovery({ receipt: null, nonce: '0x1', canonicalHash: '0x' + '1'.repeat(64) });
    await f.transfers.prepare(RECIPIENT, '0.002');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const unresolvedHash = f.transfers.getSnapshot().hash!;
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert.equal(Transaction.from(f.broadcasts.at(-1)!).nonce, 1);
    assert.notEqual(unresolvedHash, older.hash);
    const signatures = f.signatures;
    const broadcasts = [...f.broadcasts];
    assert.equal(signatures, 2);
    assert.equal(broadcasts.length, 2);
    const retained = await f.readDurableJournal();
    assert.equal(inspectEvmSignedBundle(retained!).transactions, 2);
    const unresolved = (JSON.parse(retained!).entries as { hash: string; createdAt: number; phase: string }[])
      .find((entry) => entry.hash === unresolvedHash)!;
    assert.equal(unresolved.phase, 'submitted');
    assert(unresolved.createdAt < older.createdAt);

    await f.reopen();
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal((await f.readJournal())!.hash, unresolvedHash);
    for (const prepare of [
      () => f!.transfers.prepare(RECIPIENT, '0.003'),
      () => f!.transfers.prepareToken('0x2222222222222222222222222222222222222222', RECIPIENT, '1'),
    ]) {
      const beforeRequests: number = f.requests.length;
      await assert.rejects(prepare(), { code: 'PENDING_TRANSFER' });
      assert.equal(f.transfers.getSnapshot().hash, unresolvedHash);
      assert.equal(f.transfers.getSnapshot().review, null);
      assert.equal(f.requests.length, beforeRequests, 'pending admission must precede quote or token reads');
    }
    const beforeRecovery = f.requests.length;
    await f.transfers.recover();
    const receiptReads = f.requests.slice(beforeRecovery).filter((request) => request.method === 'eth_getTransactionReceipt');
    assert.deepEqual(receiptReads.map((request) => request.params[0]), [unresolvedHash]);
    assert.equal(f.transfers.getSnapshot().hash, unresolvedHash);
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
    await f.transfers.recover(true);
    assert.equal(f.transfers.getSnapshot().hash, unresolvedHash);
    assert.equal(f.transfers.getSnapshot().review!.retry, true);
    assert.equal(f.transfers.getSnapshot().review!.nonce, '1');
    assert.equal(f.signatures, signatures);
    assert.deepEqual(f.broadcasts, broadcasts);
    assert.equal(await f.readDurableJournal(), retained, 'status/retry review preserves both exact signed records');
  } finally {
    try { await f?.close(); }
    finally { Date.now = originalNow; }
  }
});

for (const retry of [false, true]) {
  for (const cancellation of ['back', 'dispose', 'lock'] as const) {
    test(`${cancellation} during ${retry ? 'retry storage read' : 'final fee read'} revokes pending confirmation`, async () => {
      const f = await cancellationFixture();
      let hold: ReturnType<typeof f.hold> | undefined;
      let pending: Promise<void> | undefined;
      try {
        await f.transfers.prepare(RECIPIENT, '0.001');
        if (retry) {
          f.loseResponse();
          await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
          await f.transfers.recover(true);
        }
        const initialSignatures = f.signatures;
        const initialBroadcasts = f.broadcasts.length;
        const credentials = [f.authentications, f.hydrations];
        const journal = await f.readDurableJournal();
        hold = f.hold(retry ? 'storage-read' : 'requote');
        pending = f.transfers.confirm(f.transfers.getSnapshot().review!.id);
        const rejected = assert.rejects(pending, { code: 'CANCELLED' });
        await hold.started;
        if (cancellation === 'dispose') f.transfers.dispose();
        else if (cancellation === 'lock') f.authority.lock();
        else f.transfers.cancel();
        hold.finish();
        await rejected; pending = undefined;
        assert.equal(f.authority.getSnapshot().phase, cancellation === 'lock' ? 'locked' : 'ready');
        assert.equal(f.sdkUnlocked, cancellation !== 'lock');
        assert.equal(f.signatures, initialSignatures);
        assert.equal(f.broadcasts.length, initialBroadcasts);
        assert.equal(await f.readDurableJournal(), journal);
        assert.deepEqual([f.authentications, f.hydrations], credentials);
        if (cancellation === 'lock') await f.authority.unlock(PASSWORD);
        if (cancellation === 'dispose') f.replaceTransfers();
        await f.transfers.recover(retry);
        if (!retry) await f.transfers.prepare(RECIPIENT, '0.001');
        const before = [f.authentications, f.hydrations];
        await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
        assert.equal(f.signatures, initialSignatures + (retry ? 0 : 1));
        assert.equal(f.broadcasts.length, initialBroadcasts + 1);
        assert.deepEqual([f.authentications, f.hydrations], before);
        if (retry) assert.equal(f.broadcasts[0], f.broadcasts[1]);
      } finally {
        hold?.finish(); await pending?.catch(() => undefined); await f.close();
      }
    });
  }
}

test('background lock during final fee check invalidates review without signing or unlocking', async () => {
  const f = await cancellationFixture();
  let hold: ReturnType<typeof f.hold> | undefined;
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    const credentials = [f.authentications, f.hydrations];
    hold = f.hold('requote');
    const pending = f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    await hold.started; f.authority.lock(); hold.finish(); await rejected;
    assert.equal(f.sdkUnlocked, false);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.signatures, 0); assert.equal(f.broadcasts.length, 0);
    assert.equal(await f.readDurableJournal(), undefined);
    assert.deepEqual([f.authentications, f.hydrations], credentials);
  } finally { hold?.finish(); await f.close(); }
});

for (const repeated of [false, true]) {
  test(`${repeated ? 'repeated' : 'initial'} oversized receipt preserves the real journal regardless of nonce consumption`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      f.recovery.oversized = true;
      f.recovery.repeated = repeated;
      if (repeated) {
        // A prior valid receipt is a real observation; the next independent
        // observation must not turn an oversized body into successful evidence.
        await f.transfers.recover();
        assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
      }
      const retained = (await f.readJournal()) as TransferJournalEntry;
      assert(retained);
      assert.equal(retained.phase, repeated ? 'confirmed' : 'submitted');
      const retainedBytes = await f.readDurableJournal();
      assert(retainedBytes);
      const retainedRevision = inspectEvmSignedBundle(retainedBytes).revision;
      for (const consumed of [false, true]) {
        f.recovery.consumed = consumed;
        const before = f.requests.length;
        await assert.rejects(f.transfers.recover(true), { code: 'FAILED' });
        assert.equal(f.transfers.getSnapshot().phase, 'unavailable');
        assert.equal(f.transfers.getSnapshot().review, null);
        assert.deepEqual(await f.readJournal(), retained);
        assert.equal(await f.readDurableJournal(), retainedBytes);
        assert.equal(f.requests.slice(before).some((call) => call.method === 'eth_getTransactionCount'), false,
          'an oversized receipt does not admit a nonce fallback');
        assert.equal(f.signatures, 1);
        assert.equal(f.broadcasts.length, 1);
      }
      if (!repeated) await assert.rejects(f.transfers.prepare(RECIPIENT, '0.002'), { code: 'PENDING_TRANSFER' });
      // A later bounded null receipt can separately establish nonce use. Only
      // that real read enables the explicit higher-nonce send below.
      f.recovery.oversized = false;
      f.setRecovery({ receipt: null, nonce: '0x1', canonicalHash: '0x' + '8'.repeat(64) });
      await f.transfers.recover();
      assert.equal(f.transfers.getSnapshot().phase, 'nonce-consumed');
      assert.equal(f.transfers.getSnapshot().review, null);
      const after = (await f.readJournal()) as TransferJournalEntry;
      assert.deepEqual(after, { ...retained, phase: 'nonce-consumed' });
      assert.equal(inspectEvmSignedBundle((await f.readDurableJournal())!).revision, retainedRevision + 1);
      assert.match(f.transfers.getSnapshot().message!, /result is unavailable/i);
      assert.equal(after.rawTransaction, retained.rawTransaction);
      await f.transfers.prepare(RECIPIENT, '0.002');
      assert.equal(f.transfers.getSnapshot().review!.nonce, '1');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      assert.equal(f.signatures, 2);
      assert.equal(f.broadcasts.length, 2);
      assert.equal(Transaction.from(f.broadcasts[1]!).nonce, 1);
    } finally { await f.close(); }
  });
}

for (const phase of ['signed', 'submitted'] as const) {
  test(`cancelled post-sign ${phase} acknowledgement still quarantines the current authority`, async () => {
    const f = await cancellationFixture();
    let hold: ReturnType<typeof f.holdJournal> | undefined;
    let pending: Promise<void> | undefined;
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      hold = f.holdJournal(phase);
      pending = f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      const rejected = assert.rejects(pending, { code: 'CANCELLED' });
      await hold.started;
      assert.equal(f.signatures, 1);
      assert.equal(f.sdkUnlocked, true);
      const before = f.authority.getSnapshot();
      const retained = await f.readDurableJournal();
      assert(retained);
      assert.equal(JSON.parse(retained).entries[0].phase, phase);
      f.transfers.cancel();
      assert.equal(f.authority.getSnapshot(), before, 'Back after signing does not itself lock custody');
      hold.finish();
      await rejected; pending = undefined;
      assert.equal(f.authority.getSnapshot().phase, 'unavailable');
      assert.equal(f.authority.getSnapshot().error, 'UNAVAILABLE');
      assert.equal(f.authority.getSnapshot().account, null);
      assert.equal(f.sdkUnlocked, false, 'the actual SDK session is retired');
      await assert.rejects(f.runtime.session.readEthereumAddress(), /NOT_READY/);
      assert.equal(f.broadcasts.length, phase === 'signed' ? 0 : 1);
      assert.deepEqual(await f.readDurableJournal(), retained);
      await assert.rejects(f.runtime.backup.readPhrase(PASSWORD), /CLEANUP_FAILED/);
    } finally {
      hold?.finish();
      await pending?.catch(() => undefined);
      await f.close().catch(() => undefined);
    }
  });

  test(`a cancelled old-runtime ${phase} failure cannot lock the replacement authority`, async () => {
    const old = await cancellationFixture();
    const replacement = await cancellationFixture();
    let active = old;
    let locks = 0;
    const listeners = new Set<Parameters<typeof old.authority.subscribe>[0]>();
    const unsubscribe = [old, replacement].map((owner) => owner.authority.subscribe((snapshot) => {
      if (active === owner) for (const listener of listeners) listener(snapshot);
    }));
    const transfers = new NativeTransfers({
      getSnapshot: () => active.authority.getSnapshot(),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      lock() { locks++; active.authority.lock(); },
    }, () => active.runtime.transfers, { rpc: old.rpc });
    let hold: ReturnType<typeof old.holdJournal> | undefined;
    let pending: Promise<void> | undefined;
    try {
      await transfers.prepare(RECIPIENT, '0.001');
      hold = old.holdJournal(phase);
      pending = transfers.confirm(transfers.getSnapshot().review!.id);
      const rejected = assert.rejects(pending, { code: 'CANCELLED' });
      await hold.started;
      const retained = await old.readDurableJournal();
      transfers.cancel();
      old.authority.lock();
      active = replacement;
      const before = replacement.authority.getSnapshot();
      hold.finish();
      await rejected; pending = undefined;
      assert.equal(locks, 0, 'late failure must not forward a lock to a different runtime');
      assert.equal(replacement.authority.getSnapshot(), before);
      assert.equal(replacement.sdkUnlocked, true);
      assert.equal(await replacement.runtime.session.readEthereumAddress(), before.account!.address);
      assert.equal(await replacement.readDurableJournal(), undefined);
      assert.deepEqual(await old.readDurableJournal(), retained);
      assert.equal(old.sdkUnlocked, false);
      assert.equal(old.broadcasts.length, phase === 'signed' ? 0 : 1);
    } finally {
      hold?.finish();
      await pending?.catch(() => undefined);
      transfers.dispose(); unsubscribe.forEach((stop) => stop());
      await old.close().catch(() => undefined);
      await replacement.close();
    }
  });
}


for (const [status, phase] of [['0x1', 'confirmed'], ['0x0', 'reverted']] as const) {
  test(`orphan receipt cannot ${phase === 'confirmed' ? 'confirm' : 'revert'} a real journal even when another transaction used the nonce`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      const saved = await f.readJournal() as TransferJournalEntry;
      const entry = saved;
      const tx = Transaction.from(entry.rawTransaction);
      f.setRecovery({ receipt: { transactionHash: entry.hash, from: tx.from, to: RECIPIENT, status,
        blockNumber: '0x10', blockHash: '0x' + '1'.repeat(64) }, nonce: '0x1', canonicalHash: '0x' + '2'.repeat(64) });
      await assert.rejects(f.transfers.recover(), { code: 'FAILED' });
      assert.equal(f.transfers.getSnapshot().phase, 'unavailable');
      assert.equal(f.authority.getSnapshot().phase, 'ready');
      assert.deepEqual(await f.readJournal(), saved, 'the unresolved exact signed entry must remain recoverable');
      assert.equal(f.signatures, 1); assert.equal(f.broadcasts.length, 1);
    } finally { await f.close(); }
  });

  test(`canonical ${phase} receipt updates the matching real journal`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      const saved = await f.readJournal() as TransferJournalEntry;
      const entry = saved;
      f.setRecovery({ receipt: { transactionHash: entry.hash, from: Transaction.from(entry.rawTransaction).from, to: RECIPIENT, status,
        blockNumber: '0x10', blockHash: '0x' + '1'.repeat(64) }, nonce: '0x1', canonicalHash: '0x' + '1'.repeat(64) });
      await f.transfers.recover();
      assert.equal(f.transfers.getSnapshot().phase, phase);
      const next = await f.readJournal() as TransferJournalEntry;
      assert.equal(next.phase, phase);
      assert.equal(next.rawTransaction, entry.rawTransaction);
      assert.equal(f.signatures, 1); assert.equal(f.broadcasts.length, 1);
    } finally { await f.close(); }
  });
}

test('missing receipt with a consumed nonce records only nonce-consumed', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const before = await f.readJournal() as TransferJournalEntry;
    f.setRecovery({ receipt: null, nonce: '0x1', canonicalHash: '0x' + '1'.repeat(64) });
    await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'nonce-consumed');
    const after = await f.readJournal() as TransferJournalEntry;
    assert.equal(after.phase, 'nonce-consumed');
    assert.equal(after.rawTransaction, before.rawTransaction);
  } finally { await f.close(); }
});

test('canonical receipt confirms without an advanced nonce or settlement-tag read', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const saved = await f.readJournal() as TransferJournalEntry;
    const entry = saved;
    f.setRecovery({ receipt: { transactionHash: entry.hash, from: Transaction.from(entry.rawTransaction).from, to: RECIPIENT, status: '0x1',
      blockNumber: '0x10', blockHash: '0x' + '1'.repeat(64) }, nonce: '0x0', canonicalHash: '0x' + '1'.repeat(64) });
    const before = f.requests.length;
    await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    const after = await f.readJournal() as TransferJournalEntry;
    assert.equal(after.phase, 'confirmed');
    assert.equal(after.rawTransaction, entry.rawTransaction);
    assert.equal(f.requests.slice(before).some((request) => request.method === 'eth_getTransactionCount'), false);
    assert.equal(f.requests.slice(before).some((request) => request.params.includes('finalized') || request.params.includes('safe')), false);
    assert.equal(f.signatures, 1); assert.equal(f.broadcasts.length, 1);
  } finally { await f.close(); }
});

test('explicit predecessor replay survives a reorg and cold restart without another signature', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const first = (await f.readJournal())!;
    const receipt = (entry: TransferJournalEntry) => ({transactionHash:entry.hash,from:Transaction.from(entry.rawTransaction).from,to:RECIPIENT,status:'0x1',blockNumber:'0x10',blockHash:'0x'+'1'.repeat(64)});
    f.setRecovery({receipt:receipt(first),nonce:'0x1',canonicalHash:'0x'+'1'.repeat(64)});
    await f.transfers.recover();
    await f.transfers.prepare(RECIPIENT, '0.002');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const second=(await f.readJournal())!, signatures=f.signatures;
    assert.equal(second.nonce,1);
    f.setRecovery({receipt:null,nonce:'0x0',canonicalHash:'0x'+'1'.repeat(64)});
    await f.reopen();
    await f.transfers.recover(true,second.hash);
    assert.equal(f.transfers.getSnapshot().review!.replay!.missingNonce,'0');
    assert.deepEqual(f.transfers.getSnapshot().review!.replay!.predecessors.map(row=>row.hash),[first.hash]);
    await f.transfers.recover(true,first.hash);
    const review=f.transfers.getSnapshot().review!;
    assert.equal(review.replay!.hash,first.hash);
    await f.transfers.confirm(review.id);
    assert.equal(f.signatures,signatures);
    assert.equal(f.broadcasts.length,3);
    assert.equal(f.broadcasts[2],first.rawTransaction);
    f.setRecovery({receipt:receipt(first),nonce:'0x1',canonicalHash:'0x'+'1'.repeat(64)});
    await f.transfers.recover(false,first.hash);assert.equal(f.transfers.getSnapshot().phase,'confirmed');
    f.setRecovery({receipt:receipt(second),nonce:'0x2',canonicalHash:'0x'+'1'.repeat(64)});
    await f.transfers.recover(false,second.hash);assert.equal(f.transfers.getSnapshot().phase,'confirmed');
    assert.equal(f.broadcasts.length,3,'observing the later receipt never resends it');
    assert.equal(inspectEvmSignedBundle((await f.readDurableJournal())!).transactions,2);
  } finally { await f.close(); }
});
