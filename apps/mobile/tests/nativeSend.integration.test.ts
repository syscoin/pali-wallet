import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
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
// Custody revokes synchronously; quarantine is published after cleanup drains.
async function expectUnavailable(authority: NativeCustodyAuthority, action: () => Promise<unknown>): Promise<void> {
  let resolve!: () => void, reject!: (error: Error) => void;
  const unavailable = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
  void unavailable.catch(() => undefined);
  const unsubscribe = authority.subscribe(snapshot => { if (snapshot.phase === 'unavailable') resolve(); });
  const timer = setTimeout(() => reject(Error('Custody did not publish quarantine')), 2000);
  try {
    await action();
    if (authority.getSnapshot().phase === 'unavailable') resolve();
    await unavailable;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public native transfer fixture password 1!';
const RECIPIENT = '0x1111111111111111111111111111111111111111';

test('shared SDK and SQLite admit a different pending nonce and retain reorg predecessors across restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-native-send-'));
  const file = path.join(directory, 'wallet.sqlite');
  const oldFetch = globalThis.fetch;
  let leakedNetwork = 0;
  let loseResponse = true;
  let pendingNonce = '0x0';
  let latestNonce = '0x0';
  let mined: string | null = null;
  globalThis.fetch = (async () => {
    leakedNetwork++;
    throw Error('Public network forbidden');
  }) as typeof fetch;
  let storage: SqliteWalletStorage | undefined;
  let runtime: KeyringRuntime | undefined;
  let authority: NativeCustodyAuthority | undefined;
  let transfers: NativeTransfers | undefined;
  const submitted: string[] = [];
  const factory = createKeyringRuntimeFactory({ privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
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
    const rpc = new NativeTransferRpc({
      networkId: 'ethereum',
      fetch: async (_url, init) => {
        const b = JSON.parse(String(init.body));
        let result: unknown;
        if (b.method === 'eth_chainId') result = '0x1';
        else if (b.method === 'eth_getTransactionCount') result = b.params[1] === 'pending' ? pendingNonce : latestNonce;
        else if (b.method === 'eth_getBalance') result = '0x10000000000000000';
        else if (b.method === 'eth_gasPrice') result = '0x2';
        else if (b.method === 'eth_feeHistory')
          result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
        else if (b.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (b.method === 'eth_estimateGas') result = '0x5208';
        else if (b.method === 'eth_getTransactionByHash') result = null;
        else if (b.method === 'eth_getTransactionReceipt') {
          const tx = mined === b.params[0] ? Transaction.from(submitted[0]!) : null;
          result = tx ? { transactionHash: mined, from: tx.from, to: tx.to, status: '0x1',
            blockNumber: '0x10', blockHash: '0x' + 'f'.repeat(64) } : null;
        }
        else if (b.method === 'eth_getBlockByNumber')
          result = {
            number: b.params[0] === 'latest' ? '0x20' : b.params[0],
            hash: '0x' + 'f'.repeat(64),
            baseFeePerGas: '0x1',
            gasLimit: '0x1c9c380',
          };
        else if (b.method === 'eth_sendRawTransaction') {
          const identity = await storage!.recovery.readIdentity();
          assert(identity?.root);
          const persisted = await storage!.signedRecords.read(
            identity.root.profileId
          );
          assert(persisted);
          const hash = keccak256(b.params[0]);
          const expectedRecords = new Set([...submitted, b.params[0]]).size;
          assert.equal(inspectEvmSignedBundle(persisted, identity.root.profileId).transactions, expectedRecords);
          const entry = await (
            await runtime!.transfers!.journal(() => undefined)
          ).load(hash);
          assert(entry && ['signed', 'submitted'].includes(entry.phase));
          assert.equal(entry.rawTransaction, b.params[0]);
          assert(
            !persisted.includes(b.params[0]),
            'physical bundle keeps wire bytes encrypted'
          );
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
    await assert.rejects(transfers!.prepare(RECIPIENT, '0.002'), { code: 'PENDING_TRANSFER' });
    assert.equal(transfers!.getSnapshot().hash, firstHash);
    assert.equal(submitted.length, 1);

    // The original still has no receipt, but the peer now knows its nonce.
    pendingNonce = '0x1';
    loseResponse = false;
    await transfers!.prepare(RECIPIENT, '0.002');
    const successor = transfers!.getSnapshot().review!;
    assert.equal(successor.nonce, '1');
    await transfers!.confirm(successor.id);
    const secondHash = transfers!.getSnapshot().hash!;
    assert.equal(transfers!.getSnapshot().phase, 'pending');
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted.map((raw) => Transaction.from(raw).nonce), [0, 1]);

    mined = firstHash;
    latestNonce = '0x1';
    await transfers!.recover(false, firstHash!);
    assert.equal(transfers!.getSnapshot().phase, 'confirmed');
    mined = null;
    latestNonce = '0x0';
    pendingNonce = '0x0';
    transfers!.dispose();
    await authority!.dispose();
    await open();
    await authority!.unlock(PASSWORD);

    await transfers!.recover(true, secondHash);
    const gap = transfers!.getSnapshot().review?.replay;
    assert.equal(gap?.missingNonce, '0');
    assert.ok(gap?.predecessors.some((entry) => entry.hash === firstHash));
    await assert.rejects(transfers!.prepare(RECIPIENT, '0.003'), { code: 'PENDING_TRANSFER' });
    assert.equal(transfers!.getSnapshot().hash, firstHash);
    assert.equal(submitted.length, 2);

    await transfers!.recover(true, firstHash!);
    const retry = transfers!.getSnapshot().review!;
    assert.equal(retry.retry, true);
    assert.equal(retry.replay?.hash, firstHash);
    await transfers!.confirm(retry.id);
    assert.equal(submitted.length, 3);
    assert.equal(submitted[2], submitted[0]);
    assert.equal(transfers!.getSnapshot().phase, 'pending');
    assert.equal(transfers!.getSnapshot().hash, firstHash);
    const journal = await runtime!.transfers!.journal(() => undefined);
    assert.equal((await journal.load(secondHash))?.rawTransaction, submitted[1]);
    assert.equal(leakedNetwork, 0);
  } finally {
    transfers?.dispose();
    await authority?.dispose();
    globalThis.fetch = oldFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

async function cancellationFixture(type: 0 | 2 = 2) {
  const sdk = await loadNativeKeyringSdk();
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-send-cancel-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  let signatures = 0;
  let authentications = 0;
  let hydrations = 0;
  const sdkInstances: InstanceType<typeof sdk.HostKeyring>[] = [];
  let journalGate: {
    phase: 'signed' | 'submitted' | 'confirmed';
    written: boolean;
    entered(): void;
    release: Promise<void>;
  } | null = null;
  let gate: {
    stage: 'storage-read' | 'requote' | 'cancellation-dispatch' | 'cancellation-original';
    entered(): void;
    release: Promise<void>;
  } | null = null;
  const pause = async (stage: NonNullable<typeof gate>['stage']) => {
    const current = gate;
    if (current?.stage === stage) {
      current.entered();
      await current.release;
    }
  };
  // Keep the real SDK signer; pause only storage/RPC boundaries that still exist
  // in the unlocked-session flow. There is no per-send password or hydration.
  class ControlledKeyring extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...options);
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
        InstanceType<typeof sdk.HostKeyring>['signPreparedEvmTransaction']
      >
    ) {
      signatures++;
      return super.signPreparedEvmTransaction(...args);
    }
  }
  const base = createKeyringRuntimeFactory({ privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
    async observeActivity(_network, expected, signal, guard) {
      guard();
      const result = await rpc.observation(
        {
          hash: expected.hash,
          from: expected.from,
          to: expected.to,
          nonce: expected.nonce,
        },
        signal
      );
      guard();
      return result;
    },
    async ensureCryptoReady() {
      assert.ok(globalThis.crypto.subtle);
    },
    async openStorage() {
      const fresh = !existsSync(file);
      let native!: ReturnType<typeof nodeConnection>;
      native = nodeConnection(file, {
        after: async (kind, sql) => {
          if (kind === 'all' && sql.includes('FROM evm_signed_records'))
            await pause('storage-read');
          const current = journalGate;
          if (!current) return;
          if (
            kind === 'run' &&
            sql.startsWith('INSERT INTO evm_signed_records')
          ) {
            const row = native.database
              .prepare('SELECT value FROM evm_signed_records')
              .get() as { value: string };
            const value = JSON.parse(row.value) as {
              entries: { phase: string }[];
            };
            current.written = value.entries.some(
              (entry) => entry.phase === current.phase
            );
          }
          if (current.written && kind === 'exec' && sql === 'COMMIT') {
            current.entered();
            await current.release;
            throw Error('Lost signed-bundle commit acknowledgement');
          }
        },
      });
      storage = await SqliteWalletStorage.open(
        native.connection,
        digest,
        INSTALLATION,
        fresh
      );
      return storage;
    },
    loadSdk: async () => ({ ...sdk, HostKeyring: ControlledKeyring }),
  });
  const createAuthority = () =>
    new NativeCustodyAuthority({
      async open() {
        runtime = (await base.open()) as KeyringRuntime;
        return runtime;
      },
    });
  let authority = createAuthority();
  const broadcasts: string[] = [];
  let loseResponse = false;
  let nativeBalance = '0x10000000000000000';
  const replacement = { pending: false, delegated: false, baseFee: '0x1', substituteHash: undefined as string | undefined };
  const largeReceipt = {
    oversized: false,
    repeated: false,
    receiptReads: 0,
    consumed: false,
  };
  let recovery:
    | {
        receipt: Record<string, unknown> | null;
        nonce: string;
        canonicalHash: string;
      }
    | undefined;
  const requests: { method: string; params: unknown[] }[] = [];
  const rpc = new NativeTransferRpc({
    networkId: 'ethereum',
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getTransactionByHash') {
        if (signatures > 1) await pause('cancellation-original');
        const tx = broadcasts[0] && Transaction.from(broadcasts[0]);
        result = replacement.pending && tx && tx.hash === request.params[0]
          ? { hash: replacement.substituteHash ?? tx.hash, from: tx.from, to: tx.to, value: `0x${tx.value.toString(16)}`,
              nonce: `0x${tx.nonce.toString(16)}`, blockNumber: null, blockHash: null, transactionIndex: null }
          : null;
      } else if (request.method === 'eth_getCode') {
        if (signatures > 1 && request.params[1] === 'pending') await pause('cancellation-dispatch');
        result = replacement.delegated ? `0xef0100${'33'.repeat(20)}` : '0x';
      }
      else if (request.method === 'eth_getTransactionCount') {
        result = largeReceipt.oversized
          ? request.params[1] === 'pending' ||
            largeReceipt.consumed ||
            (largeReceipt.repeated && largeReceipt.receiptReads === 1)
            ? '0x1'
            : '0x0'
          : recovery?.nonce ?? '0x0';
      } else if (request.method === 'eth_getBalance')
        result = nativeBalance;
      else if (request.method === 'eth_gasPrice') result = '0x2';
      else if (request.method === 'eth_feeHistory')
        result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
      else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
      else if (request.method === 'eth_estimateGas') {
        await pause('requote');
        result = '0x5208';
      } else if (request.method === 'eth_getTransactionReceipt') {
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
            ...(largeReceipt.repeated && largeReceipt.receiptReads === 1
              ? {}
              : {
                  logs: [
                    {
                      address: tx.to,
                      topics: [],
                      // Exceed the shared reader's 1 MiB receipt budget.
                      data: '0x' + 'ab'.repeat(1024 * 1024),
                    },
                  ],
                }),
          };
        }
      } else if (request.method === 'eth_getBlockByNumber') {
        if (largeReceipt.oversized) {
          assert(
            !['finalized', 'safe'].includes(request.params[0]),
            'ordinary sends never request a settlement tag'
          );
          const number = request.params[0];
          result = {
            number: number === 'latest' ? '0x20' : number,
            hash: '0x' + (number === '0xa' ? '8' : '9').repeat(64),
            ...(type === 2 ? { baseFeePerGas: replacement.baseFee } : {}),
            gasLimit: '0x1c9c380',
          };
        } else {
          const current = recovery;
          assert(
            !['finalized', 'safe'].includes(request.params[0]),
            'ordinary sends never request a settlement tag'
          );
          const number = request.params[0];
          result = {
            number: number === 'latest' ? '0x20' : number,
            hash:
              current && number === current.receipt?.blockNumber
                ? current.canonicalHash
                : '0x' + 'f'.repeat(64),
            ...(type === 2 ? { baseFeePerGas: replacement.baseFee } : {}),
            gasLimit: '0x1c9c380',
          };
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
    get authority() {
      return authority;
    },
    get runtime() {
      return runtime;
    },
    broadcasts,
    setBalance(value: bigint) { nativeBalance = `0x${value.toString(16)}`; },
    recovery: largeReceipt,
    requests,
    replacement,
    get transfers() {
      return transfers;
    },
    rpc,
    get signatures() {
      return signatures;
    },
    get authentications() {
      return authentications;
    },
    get hydrations() {
      return hydrations;
    },
    get sdkUnlocked() {
      return sdkInstances.some((instance) => instance.isUnlocked());
    },
    holdJournal(phase: 'signed' | 'submitted' | 'confirmed') {
      let entered!: () => void;
      let resume!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const release = new Promise<void>((resolve) => {
        resume = resolve;
      });
      journalGate = { phase, written: false, entered, release };
      return {
        started,
        finish() {
          journalGate = null;
          resume();
        },
      };
    },
    async readDurableJournal() {
      // Observe durable bytes independently of the quarantined runtime port.
      const { DatabaseSync } = await import('node:sqlite');
      const observer = new DatabaseSync(file, { readOnly: true });
      try {
        const row = observer
          .prepare('SELECT value FROM evm_signed_records')
          .get() as { value: string } | undefined;
        if (row) inspectEvmSignedBundle(row.value);
        return row?.value;
      } finally {
        observer.close();
      }
    },
    loseResponse() {
      loseResponse = true;
    },
    setRecovery(value: NonNullable<typeof recovery>) {
      recovery = structuredClone(value);
    },
    hold(stage: NonNullable<typeof gate>['stage']) {
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
    async reopenAfterQuarantine() {
      transfers.dispose();
      await assert.rejects(authority.dispose(), { code: 'CLEANUP_FAILED' });
      authority = createAuthority();
      await authority.initialize();
      await authority.unlock(PASSWORD);
      transfers = new NativeTransfers(authority, () => runtime.transfers, { rpc });
    },
    async reopen() {
      transfers.dispose();
      await authority.dispose();
      authority = createAuthority();
      await authority.initialize();
      await authority.unlock(PASSWORD);
      transfers = new NativeTransfers(authority, () => runtime.transfers, {
        rpc,
      });
    },
    async readJournal() {
      return (
        (await (await runtime.transfers!.journal(() => undefined)).load()) ??
        undefined
      );
    },
    async close() {
      transfers.dispose();
      try {
        await authority.dispose();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

test('queued pending cancellation reports the earlier nonce without signing', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001', '1');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const originalHash = f.transfers.getSnapshot().hash!;
    f.replacement.pending = true;
    await assert.rejects(f.transfers.prepareCancellation(originalHash), { code: 'CANCELLATION_QUEUED' });
    assert.equal(f.transfers.getSnapshot().message,
      'This cancellation must wait for earlier transactions. Check Activity before trying again.');
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    await f.close();
  }
});

async function prepareSavedCancellation(f: Awaited<ReturnType<typeof cancellationFixture>>) {
  await f.transfers.prepare(RECIPIENT, '0.001');
  await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
  const originalHash = f.transfers.getSnapshot().hash!;
  f.replacement.pending = true;
  await f.transfers.prepareCancellation(originalHash);
  return { originalHash, review: f.transfers.getSnapshot().review! };
}

test('an acknowledged ordinary send can be followed by the next nonce while pending RPC lags', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    assert.equal(f.transfers.getSnapshot().phase, 'pending');

    // The same captured endpoint still reports zero for both counts and has
    // no by-hash sighting. Its exact POST acknowledgement bridges this lag.
    await f.transfers.prepare(RECIPIENT, '0.002');
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.nonce, '1');
    await f.transfers.confirm(review.id);
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert.deepEqual(f.broadcasts.map((raw) => Transaction.from(raw).nonce), [0, 1]);
    const saved = JSON.parse((await f.readDurableJournal())!);
    assert.deepEqual(saved.entries.map((entry: { hash: string }) => entry.hash), f.broadcasts.map((raw) => keccak256(raw)));
  } finally {
    await f.close();
  }
});

for (const type of [0, 2] as const) {
  test(`Speed Up type ${type} retains execution and saves linked exact bytes before POST`, async () => {
    const f = await cancellationFixture(type);
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      const originalHash = f.transfers.getSnapshot().hash!;
      const original = Transaction.from(f.broadcasts[0]!);
      f.replacement.pending = true;
      await f.transfers.prepareSpeedUp(originalHash);
      const review = f.transfers.getSnapshot().review!;
      assert.equal(review.replacement?.mode, 'speed-up');
      assert.equal(review.replacement?.originalHash, originalHash);
      assert.equal(review.recipient, RECIPIENT);
      assert.equal(review.amountUnits, original.value.toString());
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
      const originalFee = original.gasPrice ?? original.maxFeePerGas!;
      assert.equal(review.replacement?.originalMaximumFeeUnits, (original.gasLimit * originalFee).toString());
      assert(BigInt(review.maximumFeeUnits) > original.gasLimit * originalFee);
      const gate = f.hold('cancellation-original');
      const submit = f.transfers.confirm(review.id);
      try {
        await Promise.race([gate.started, submit.then(() => assert.fail('POST preflight was not held'))]);
        assert.equal(f.broadcasts.length, 1);
        const stored = JSON.parse((await f.readDurableJournal())!);
        assert.equal(stored.entries.length, 2);
        assert.equal(stored.entries[1].operation, 'speed-up');
        assert.equal(stored.entries[1].originalHash, originalHash);
      } finally {
        gate.finish();
        await submit;
      }
      assert.equal(f.broadcasts.length, 2);
      const replaced = Transaction.from(f.broadcasts[1]!);
      assert.deepEqual([replaced.from, replaced.to, replaced.value, replaced.nonce, replaced.data, replaced.type],
        [original.from, original.to, original.value, original.nonce, original.data, type]);
      assert.equal(replaced.gasLimit * (replaced.gasPrice ?? replaced.maxFeePerGas!), BigInt(review.maximumFeeUnits));
      await f.reopen();
      const journal = await f.runtime.transfers!.journal(() => undefined);
      assert.equal((await journal.load(originalHash))?.rawTransaction, f.broadcasts[0]);
      assert.equal((await journal.load(replaced.hash!))?.rawTransaction, f.broadcasts[1]);
      await assert.rejects(f.transfers.prepareSpeedUp(originalHash), { code: 'EXPIRED' });
    } finally { await f.close(); }
  });
}

test('Speed Up refuses POST when the saved original disappears after the new signature is persisted', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const originalHash = f.transfers.getSnapshot().hash!;
    f.replacement.pending = true;
    await f.transfers.prepareSpeedUp(originalHash);
    const gate = f.hold('cancellation-original');
    const refused = assert.rejects(f.transfers.confirm(f.transfers.getSnapshot().review!.id), { code: 'EXPIRED' });
    try {
      await Promise.race([gate.started, refused.then(() => assert.fail('POST preflight was not held'))]);
      f.replacement.pending = false;
    } finally {
      gate.finish();
      await refused;
    }
    const entries = JSON.parse((await f.readDurableJournal())!).entries;
    assert.equal(entries[1].operation, 'speed-up');
    assert.equal(entries[1].originalHash, originalHash);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.transfers.getSnapshot().hash, entries[1].hash);
  } finally { await f.close(); }
});

test('a saved Speed Up blocked by a higher base fee can be reviewed again after restart', async () => {
  const f = await cancellationFixture(2);
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const originalHash = f.transfers.getSnapshot().hash!;
    f.replacement.pending = true;
    await f.transfers.prepareSpeedUp(originalHash);
    const gate = f.hold('cancellation-original');
    const refused = assert.rejects(f.transfers.confirm(f.transfers.getSnapshot().review!.id), { code: 'EXPIRED' });
    try {
      await Promise.race([gate.started, refused.then(() => assert.fail('POST preflight was not held'))]);
      f.replacement.baseFee = '0x3e8';
    } finally { gate.finish(); await refused; }
    const savedHash = f.transfers.getSnapshot().hash!;
    assert.equal(f.broadcasts.length, 1);

    await f.reopen();
    const journal = await f.runtime.transfers!.journal(() => undefined);
    const original = await journal.load(originalHash);
    const saved = await journal.load(savedHash);
    assert(saved && original);
    assert.equal(saved.phase, 'signed');
    assert.equal((await journal.load())?.hash, savedHash);
    await f.transfers.recover(true, savedHash);
    await assert.rejects(f.transfers.confirm(f.transfers.getSnapshot().review!.id), { code: 'EXPIRED' });
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.signatures, 2);

    await f.transfers.prepareCancellation(originalHash);
    assert.equal(f.transfers.getSnapshot().review?.replacement?.originalHash, originalHash);
    f.transfers.cancel();
    await f.transfers.prepareSpeedUp(originalHash);
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.replacement?.originalHash, originalHash);
    assert.equal(review.amountUnits, Transaction.from(original.rawTransaction).value.toString());
    assert(BigInt(review.maximumFeePerGas) >= BigInt(f.replacement.baseFee) + BigInt(review.priorityFeePerGas!));
    assert(BigInt(review.priorityFeePerGas!) > Transaction.from(saved.rawTransaction).maxPriorityFeePerGas!);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.signatures, 2);

    f.replacement.baseFee = '0x3e9';
    await assert.rejects(f.transfers.confirm(review.id), { code: 'EXPIRED' });
    assert.equal(f.signatures, 2);
    assert.equal(f.broadcasts.length, 1);
    f.replacement.baseFee = '0x3e8';
    await f.transfers.prepareSpeedUp(originalHash);
    const renewed = f.transfers.getSnapshot().review!;
    f.replacement.baseFee = '0x3e7';
    await f.transfers.confirm(renewed.id);
    assert.equal(f.broadcasts.length, 2);
    assert.equal(f.signatures, 3);
    const repriced = Transaction.from(f.broadcasts[1]!);
    assert.equal(repriced.maxFeePerGas?.toString(), renewed.maximumFeePerGas);
    assert.equal((await journal.load(savedHash))?.rawTransaction, saved.rawTransaction);
    assert.equal((await journal.load(originalHash))?.rawTransaction, original.rawTransaction);
    await assert.rejects(f.transfers.prepareSpeedUp(originalHash), { code: 'EXPIRED' });
  } finally { await f.close(); }
});

test('new cancellation signs the saved nonce once and persists both linked exact envelopes before POST', async () => {
  const f = await cancellationFixture();
  try {
    const { originalHash, review } = await prepareSavedCancellation(f);
    assert.equal(review.replacement?.mode, 'cancel');
    assert.equal(review.replacement?.originalHash, originalHash);
    assert.equal(review.recipient, review.from);
    assert.equal(review.amountUnits, '0');
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
    const gate = f.hold('cancellation-dispatch');
    const submit = f.transfers.confirm(review.id);
    try {
      await Promise.race([gate.started, submit.then(() => assert.fail('POST preflight was not held'))]);
      assert.equal(f.broadcasts.length, 1);
      const stored = JSON.parse((await f.readDurableJournal())!);
      assert.equal(stored.entries.length, 2);
      assert.equal(stored.entries[0].hash, originalHash);
      assert.equal(stored.entries[1].operation, 'cancel');
      assert.equal(stored.entries[1].originalHash, originalHash);
      await assert.rejects(f.transfers.confirm(review.id), { code: 'BUSY' });
    } finally {
      gate.finish();
      await submit;
    }
    assert.equal(f.broadcasts.length, 2);
    const [old, replacement] = f.broadcasts.map((raw) => Transaction.from(raw));
    assert.equal(replacement!.nonce, old!.nonce);
    assert.equal(replacement!.from, old!.from);
    assert.equal(replacement!.to, old!.from);
    assert.equal(replacement!.data, '0x');
    assert.equal(replacement!.value, 0n);
    assert.equal(replacement!.gasLimit * replacement!.maxFeePerGas!, BigInt(review.maximumFeeUnits));
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    await f.reopen();
    const journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal((await journal.load(originalHash))?.rawTransaction, f.broadcasts[0]);
    assert.equal((await journal.load(replacement!.hash!))?.rawTransaction, f.broadcasts[1]);
    await assert.rejects(f.transfers.prepareCancellation(originalHash), { code: 'EXPIRED' });
  } finally {
    await f.close();
  }
});

test('new cancellation refuses a missing original or increased fee without creating another signature', async () => {
  const f = await cancellationFixture();
  try {
    const { originalHash, review } = await prepareSavedCancellation(f);
    f.replacement.baseFee = '0x100';
    await assert.rejects(f.transfers.confirm(review.id), { code: 'EXPIRED' });
    f.replacement.pending = false;
    await assert.rejects(f.transfers.prepareCancellation(originalHash), { code: 'EXPIRED' });
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally {
    await f.close();
  }
});

test('new cancellation keeps signed evidence and sends nothing when payer delegation appears after persistence', async () => {
  const f = await cancellationFixture();
  try {
    const { originalHash, review } = await prepareSavedCancellation(f);
    const gate = f.hold('cancellation-dispatch');
    const submit = f.transfers.confirm(review.id);
    const refused = assert.rejects(submit, { code: 'EXPIRED' });
    try {
      await Promise.race([gate.started, refused.then(() => assert.fail('POST preflight was not held'))]);
      f.replacement.delegated = true;
    } finally {
      gate.finish();
      await refused;
    }
    assert.equal(f.broadcasts.length, 1);
    const saved = JSON.parse((await f.readDurableJournal())!).entries;
    assert.equal(saved[1].operation, 'cancel');
    assert.equal(saved[1].originalHash, originalHash);
    assert.equal(f.transfers.getSnapshot().hash, saved[1].hash);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally {
    await f.close();
  }
});

for (const change of ['dropped', 'replaced'] as const) {
  test(`new cancellation refuses a ${change} exact original during final preflight with the payer nonce unchanged`, async () => {
    const f = await cancellationFixture();
    try {
      const { originalHash, review } = await prepareSavedCancellation(f);
      const gate = f.hold('cancellation-dispatch');
      const submit = f.transfers.confirm(review.id);
      try {
        await Promise.race([gate.started, submit.then(() => assert.fail('POST preflight was not held'))]);
        if (change === 'dropped') f.replacement.pending = false;
        else f.replacement.substituteHash = '0x' + '9'.repeat(64);
      } finally {
        gate.finish();
      }
      await assert.rejects(submit, { code: 'EXPIRED' });
      assert.equal(f.broadcasts.length, 1);
      const saved = JSON.parse((await f.readDurableJournal())!).entries;
      assert.equal(saved.length, 2);
      assert.equal(saved[0].hash, originalHash);
      assert.equal(saved[1].originalHash, originalHash);
      assert.equal(f.transfers.getSnapshot().hash, saved[1].hash);
    } finally {
      await f.close();
    }
  });
}

test('new cancellation rechecks payer delegation after the final original observation', async () => {
  const f = await cancellationFixture();
  try {
    const { originalHash, review } = await prepareSavedCancellation(f);
    const gate = f.hold('cancellation-original');
    const submit = f.transfers.confirm(review.id);
    try {
      await Promise.race([gate.started, submit.then(() => assert.fail('Original observation was not held'))]);
      f.replacement.delegated = true;
    } finally {
      gate.finish();
    }
    await assert.rejects(submit, { code: 'EXPIRED' });
    assert.equal(f.broadcasts.length, 1);
    const saved = JSON.parse((await f.readDurableJournal())!).entries;
    assert.equal(saved.length, 2);
    assert.equal(saved[0].hash, originalHash);
    assert.equal(saved[1].originalHash, originalHash);
    assert.equal(f.transfers.getSnapshot().hash, saved[1].hash);
  } finally {
    await f.close();
  }
});

test('a previously confirmed saved transaction can be canceled after a fresh reorg observation', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const original = Transaction.from(f.broadcasts[0]!);
    const blockHash = '0x' + '8'.repeat(64);
    f.setRecovery({
      receipt: { transactionHash: original.hash, from: original.from, to: original.to,
        status: '0x1', blockNumber: '0xa', blockHash },
      nonce: '0x1', canonicalHash: blockHash,
    });
    await f.transfers.recover(false, original.hash!);
    assert.equal((await f.readJournal())?.phase, 'confirmed');

    f.setRecovery({ receipt: null, nonce: '0x0', canonicalHash: blockHash });
    f.replacement.pending = true;
    await f.transfers.prepareCancellation(original.hash!);
    assert.equal((await f.readJournal())?.phase, 'submitted');
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.replacement?.mode, 'cancel');
    assert.equal(review.replacement?.originalHash, original.hash);
    await f.transfers.confirm(review.id);
    assert.equal(f.broadcasts.length, 2);
    assert.equal(Transaction.from(f.broadcasts[1]!).nonce, original.nonce);
  } finally {
    await f.close();
  }
});

test('locking during the final cancellation preflight prevents POST and keeps both signed records', async () => {
  const f = await cancellationFixture();
  try {
    const { review } = await prepareSavedCancellation(f);
    const gate = f.hold('cancellation-dispatch');
    const refused = assert.rejects(f.transfers.confirm(review.id), { code: 'CANCELLED' });
    try {
      await Promise.race([gate.started, refused.then(() => assert.fail('POST preflight was not held'))]);
      f.authority.lock();
    } finally {
      gate.finish();
      await refused;
    }
    assert.equal(f.broadcasts.length, 1);
    const saved = JSON.parse((await f.readDurableJournal())!).entries;
    assert.equal(saved.length, 2);
    assert.equal(saved[1].operation, 'cancel');
    assert.equal(f.authority.getSnapshot().phase, 'locked');
  } finally {
    await f.close();
  }
});

test('wall-clock rollback cannot hide an unresolved signed transfer after a cold reopen', async () => {
  const originalNow = Date.now;
  let wallClock = 2_000_000_000_000;
  Date.now = () => wallClock;
  let f: Awaited<ReturnType<typeof cancellationFixture>> | undefined;
  try {
    f = await cancellationFixture();
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const older = (await f.readJournal()) as TransferJournalEntry;
    const first = Transaction.from(older.rawTransaction);
    f.setRecovery({
      receipt: {
        transactionHash: older.hash,
        from: first.from,
        to: RECIPIENT,
        status: '0x1',
        blockNumber: '0x10',
        blockHash: '0x' + '1'.repeat(64),
      },
      nonce: '0x1',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.transfers.recover();
    assert.equal((await f.readJournal())!.phase, 'confirmed');

    // Move only the wall-clock presentation timestamp backwards. Consent
    // deadlines continue to use the controller's actual monotonic clock.
    wallClock -= 60 * 60 * 1000;
    f.setRecovery({
      receipt: null,
      nonce: '0x1',
      canonicalHash: '0x' + '1'.repeat(64),
    });
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
    const unresolved = (
      JSON.parse(retained!).entries as {
        hash: string;
        createdAt: number;
        phase: string;
      }[]
    ).find((entry) => entry.hash === unresolvedHash)!;
    assert.equal(unresolved.phase, 'submitted');
    assert(unresolved.createdAt < older.createdAt);

    await f.reopen();
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal((await f.readJournal())!.hash, unresolvedHash);
    const beforeRequests = f.requests.length;
    await assert.rejects(f.transfers.prepare(RECIPIENT, '0.003'), { code: 'PENDING_TRANSFER' });
    assert.equal(f.transfers.getSnapshot().hash, unresolvedHash);
    assert.equal(f.transfers.getSnapshot().review, null);
    assert(f.requests.slice(beforeRequests).some((call) =>
      call.method === 'eth_getTransactionCount' && call.params[1] === 'pending'));
    assert.equal(f.signatures, signatures);
    assert.deepEqual(f.broadcasts, broadcasts);
    const beforeRecovery = f.requests.length;
    await f.transfers.recover();
    const receiptReads = f.requests
      .slice(beforeRecovery)
      .filter((request) => request.method === 'eth_getTransactionReceipt');
    assert.deepEqual(
      receiptReads.map((request) => request.params[0]),
      [unresolvedHash]
    );
    assert.equal(f.transfers.getSnapshot().hash, unresolvedHash);
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
    await f.transfers.recover(true);
    assert.equal(f.transfers.getSnapshot().hash, unresolvedHash);
    assert.equal(f.transfers.getSnapshot().review!.retry, true);
    assert.equal(f.transfers.getSnapshot().review!.nonce, '1');
    assert.equal(f.signatures, signatures);
    assert.deepEqual(f.broadcasts, broadcasts);
    assert.equal(
      await f.readDurableJournal(),
      retained,
      'status/retry review preserves both exact signed records'
    );
  } finally {
    try {
      await f?.close();
    } finally {
      Date.now = originalNow;
    }
  }
});

for (const retry of [false, true]) {
  for (const cancellation of ['back', 'dispose', 'lock'] as const) {
    test(`${cancellation} during ${
      retry ? 'retry storage read' : 'final fee read'
    } revokes pending confirmation`, async () => {
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
        await rejected;
        pending = undefined;
        assert.equal(
          f.authority.getSnapshot().phase,
          cancellation === 'lock' ? 'locked' : 'ready'
        );
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
        hold?.finish();
        await pending?.catch(() => undefined);
        await f.close();
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
    await hold.started;
    f.authority.lock();
    hold.finish();
    await rejected;
    assert.equal(f.sdkUnlocked, false);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.signatures, 0);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(await f.readDurableJournal(), undefined);
    assert.deepEqual([f.authentications, f.hydrations], credentials);
  } finally {
    hold?.finish();
    await f.close();
  }
});

for (const repeated of [false, true]) {
  test(`${
    repeated ? 'repeated' : 'initial'
  } oversized receipt preserves the real journal regardless of nonce consumption`, async () => {
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
        assert.equal(
          f.requests
            .slice(before)
            .some((call) => call.method === 'eth_getTransactionCount'),
          false,
          'an oversized receipt does not admit a nonce fallback'
        );
        assert.equal(f.signatures, 1);
        assert.equal(f.broadcasts.length, 1);
      }
      if (!repeated) {
        await f.transfers.prepare(RECIPIENT, '0.002');
        assert.equal(f.transfers.getSnapshot().review?.nonce, '1');
        assert.deepEqual(await f.readJournal(), retained);
        assert.equal(f.broadcasts.length, 1);
      }
      // A bounded null receipt can independently update the older saved row.
      // Neither a new quote nor a malformed receipt changes its observation.
      f.recovery.oversized = false;
      f.setRecovery({
        receipt: null,
        nonce: '0x1',
        canonicalHash: '0x' + '8'.repeat(64),
      });
      await f.transfers.recover();
      assert.equal(f.transfers.getSnapshot().phase, 'nonce-consumed');
      assert.equal(f.transfers.getSnapshot().review, null);
      const after = (await f.readJournal()) as TransferJournalEntry;
      assert.deepEqual(after, { ...retained, phase: 'nonce-consumed' });
      assert.equal(
        inspectEvmSignedBundle((await f.readDurableJournal())!).revision,
        retainedRevision + 1
      );
      assert.match(
        f.transfers.getSnapshot().message!,
        /result is unavailable/i
      );
      assert.equal(after.rawTransaction, retained.rawTransaction);
      await f.transfers.prepare(RECIPIENT, '0.002');
      assert.equal(f.transfers.getSnapshot().review!.nonce, '1');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      assert.equal(f.signatures, 2);
      assert.equal(f.broadcasts.length, 2);
      assert.equal(Transaction.from(f.broadcasts[1]!).nonce, 1);
    } finally {
      await f.close();
    }
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
      assert.equal(
        f.authority.getSnapshot(),
        before,
        'Back after signing does not itself lock custody'
      );
      await expectUnavailable(f.authority, async () => {
        hold!.finish();
        await rejected;
      });
      pending = undefined;
      assert.equal(f.authority.getSnapshot().phase, 'unavailable');
      assert.equal(f.authority.getSnapshot().error, 'UNAVAILABLE');
      assert.equal(f.authority.getSnapshot().account, null);
      assert.equal(f.sdkUnlocked, false, 'the actual SDK session is retired');
      await assert.rejects(
        f.runtime.session.readSelectedAddress(),
        /NOT_READY/
      );
      assert.equal(f.broadcasts.length, phase === 'signed' ? 0 : 1);
      assert.deepEqual(await f.readDurableJournal(), retained);
      await assert.rejects(
        f.runtime.backup.readPhrase(PASSWORD),
        /CLEANUP_FAILED/
      );
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
    const unsubscribe = [old, replacement].map((owner) =>
      owner.authority.subscribe((snapshot) => {
        if (active === owner)
          for (const listener of listeners) listener(snapshot);
      })
    );
    const transfers = new NativeTransfers(
      {
        getSnapshot: () => active.authority.getSnapshot(),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        lock() {
          locks++;
          active.authority.lock();
        },
      },
      () => active.runtime.transfers,
      { rpc: old.rpc }
    );
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
      await rejected;
      pending = undefined;
      assert.equal(
        locks,
        0,
        'late failure must not forward a lock to a different runtime'
      );
      assert.equal(replacement.authority.getSnapshot(), before);
      assert.equal(replacement.sdkUnlocked, true);
      assert.equal(
        await replacement.runtime.session.readSelectedAddress(),
        before.account!.address
      );
      assert.equal(await replacement.readDurableJournal(), undefined);
      assert.deepEqual(await old.readDurableJournal(), retained);
      assert.equal(old.sdkUnlocked, false);
      assert.equal(old.broadcasts.length, phase === 'signed' ? 0 : 1);
    } finally {
      hold?.finish();
      await pending?.catch(() => undefined);
      transfers.dispose();
      unsubscribe.forEach((stop) => stop());
      await old.close().catch(() => undefined);
      await replacement.close();
    }
  });
}

for (const [status, phase] of [
  ['0x1', 'confirmed'],
  ['0x0', 'reverted'],
] as const) {
  test(`orphan receipt cannot ${
    phase === 'confirmed' ? 'confirm' : 'revert'
  } a real journal even when another transaction used the nonce`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      const saved = (await f.readJournal()) as TransferJournalEntry;
      const entry = saved;
      const tx = Transaction.from(entry.rawTransaction);
      f.setRecovery({
        receipt: {
          transactionHash: entry.hash,
          from: tx.from,
          to: RECIPIENT,
          status,
          blockNumber: '0x10',
          blockHash: '0x' + '1'.repeat(64),
        },
        nonce: '0x1',
        canonicalHash: '0x' + '2'.repeat(64),
      });
      await assert.rejects(f.transfers.recover(), { code: 'FAILED' });
      assert.equal(f.transfers.getSnapshot().phase, 'unavailable');
      assert.equal(f.authority.getSnapshot().phase, 'ready');
      assert.deepEqual(
        await f.readJournal(),
        saved,
        'the unresolved exact signed entry must remain recoverable'
      );
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
    } finally {
      await f.close();
    }
  });

  test(`canonical ${phase} receipt updates the matching real journal`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
      const saved = (await f.readJournal()) as TransferJournalEntry;
      const entry = saved;
      f.setRecovery({
        receipt: {
          transactionHash: entry.hash,
          from: Transaction.from(entry.rawTransaction).from,
          to: RECIPIENT,
          status,
          blockNumber: '0x10',
          blockHash: '0x' + '1'.repeat(64),
        },
        nonce: '0x1',
        canonicalHash: '0x' + '1'.repeat(64),
      });
      await f.transfers.recover();
      assert.equal(f.transfers.getSnapshot().phase, phase);
      const next = (await f.readJournal()) as TransferJournalEntry;
      assert.equal(next.phase, phase);
      assert.equal(next.rawTransaction, entry.rawTransaction);
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
    } finally {
      await f.close();
    }
  });
}

test('missing receipt with a consumed nonce records only nonce-consumed', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const before = (await f.readJournal()) as TransferJournalEntry;
    f.setRecovery({
      receipt: null,
      nonce: '0x1',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'nonce-consumed');
    const after = (await f.readJournal()) as TransferJournalEntry;
    assert.equal(after.phase, 'nonce-consumed');
    assert.equal(after.rawTransaction, before.rawTransaction);
  } finally {
    await f.close();
  }
});

test('canonical receipt confirms without an advanced nonce or settlement-tag read', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const saved = (await f.readJournal()) as TransferJournalEntry;
    const entry = saved;
    f.setRecovery({
      receipt: {
        transactionHash: entry.hash,
        from: Transaction.from(entry.rawTransaction).from,
        to: RECIPIENT,
        status: '0x1',
        blockNumber: '0x10',
        blockHash: '0x' + '1'.repeat(64),
      },
      nonce: '0x0',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    const before = f.requests.length;
    await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    const after = (await f.readJournal()) as TransferJournalEntry;
    assert.equal(after.phase, 'confirmed');
    assert.equal(after.rawTransaction, entry.rawTransaction);
    assert.equal(
      f.requests
        .slice(before)
        .some((request) => request.method === 'eth_getTransactionCount'),
      false
    );
    assert.equal(
      f.requests
        .slice(before)
        .some(
          (request) =>
            request.params.includes('finalized') ||
            request.params.includes('safe')
        ),
      false
    );
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    await f.close();
  }
});

test('explicit predecessor replay survives a reorg and cold restart without another signature', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const first = (await f.readJournal())!;
    const receipt = (entry: TransferJournalEntry) => ({
      transactionHash: entry.hash,
      from: Transaction.from(entry.rawTransaction).from,
      to: RECIPIENT,
      status: '0x1',
      blockNumber: '0x10',
      blockHash: '0x' + '1'.repeat(64),
    });
    f.setRecovery({
      receipt: receipt(first),
      nonce: '0x1',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.transfers.recover();
    await f.transfers.prepare(RECIPIENT, '0.002');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const second = (await f.readJournal())!,
      signatures = f.signatures;
    assert.equal(second.nonce, 1);
    f.setRecovery({
      receipt: null,
      nonce: '0x0',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.reopen();
    await f.transfers.recover(true, second.hash);
    assert.equal(f.transfers.getSnapshot().review!.replay!.missingNonce, '0');
    assert.deepEqual(
      f.transfers
        .getSnapshot()
        .review!.replay!.predecessors.map((row) => row.hash),
      [first.hash]
    );
    await f.transfers.recover(true, first.hash);
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.replay!.hash, first.hash);
    await f.transfers.confirm(review.id);
    assert.equal(f.signatures, signatures);
    assert.equal(f.broadcasts.length, 3);
    assert.equal(f.broadcasts[2], first.rawTransaction);
    f.setRecovery({
      receipt: receipt(first),
      nonce: '0x1',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.transfers.recover(false, first.hash);
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    f.setRecovery({
      receipt: receipt(second),
      nonce: '0x2',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.transfers.recover(false, second.hash);
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    assert.equal(
      f.broadcasts.length,
      3,
      'observing the later receipt never resends it'
    );
    assert.equal(
      inspectEvmSignedBundle((await f.readDurableJournal())!).transactions,
      2
    );
  } finally {
    await f.close();
  }
});

test('actual SDK custody activity observes only its retained tuple through the common observer and retains raw bytes', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const tx = Transaction.from(f.broadcasts[0]!),
      before = f.signatures;
    const activity = f.runtime.activity!;
    const loaded = await activity.load(() => undefined);
    assert.equal(loaded.locals.length, 1);
    const local = loaded.locals[0]!;
    f.setRecovery({
      receipt: {
        transactionHash: tx.hash,
        from: tx.from,
        to: tx.to,
        status: '0x1',
        blockNumber: '0xa',
        blockHash: '0x' + '8'.repeat(64),
      },
      nonce: '0x1',
      canonicalHash: '0x' + '8'.repeat(64),
    });
    const start = f.requests.length;
    const observed = await activity.observeLocal!(
      local,
      () => undefined,
      new AbortController().signal
    );
    assert.equal(observed.status, 'mined');
    assert.equal(
      (await activity.load(() => undefined)).locals[0]!.phase,
      'confirmed'
    );
    const receiptCalls = f.requests
      .slice(start)
      .filter((row) => row.method === 'eth_getTransactionReceipt');
    assert.deepEqual(
      receiptCalls.map((row) => row.params),
      [[tx.hash]]
    );
    assert.equal(f.signatures, before);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(
      (await (await f.runtime.transfers!.journal(() => undefined)).load())!
        .rawTransaction,
      tx.serialized
    );
    f.authority.lock();
    await assert.rejects(
      activity.observeLocal!(
        local,
        () => undefined,
        new AbortController().signal
      )
    );
  } finally {
    await f.close();
  }
});

test('lost retained-observation phase acknowledgement locks the actual SDK and preserves its signed bytes', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id);
    const tx = Transaction.from(f.broadcasts[0]!);
    const activity = f.runtime.activity!, local = (await activity.load(() => undefined)).locals[0]!;
    f.setRecovery({receipt:{transactionHash:tx.hash,from:tx.from,to:tx.to,status:'0x1',blockNumber:'0xa',blockHash:'0x'+'8'.repeat(64)},nonce:'0x1',canonicalHash:'0x'+'8'.repeat(64)});
    const gate = f.holdJournal('confirmed');
    const work = activity.observeLocal!(local, () => undefined, new AbortController().signal);
    const rejected = assert.rejects(work, {code:'CLEANUP_FAILED'});
    await gate.started; gate.finish(); await rejected;
    assert.equal(f.sdkUnlocked, false);
    assert(await f.readDurableJournal());
    assert.equal(f.broadcasts.length, 1);
    await f.reopenAfterQuarantine();
    const retained = await f.readJournal();
    assert.equal(retained?.rawTransaction, tx.serialized);
    assert.equal(retained?.phase, 'confirmed');
  } finally { await f.close(); }
});


test('manual native gap filling obeys the same retained spend budget as automatic sends', async () => {
  const f = await cancellationFixture();
  try {
    f.setBalance(1000000n);
    await f.transfers.prepare(RECIPIENT, '0.0000000000007', '1');
    const first = f.transfers.getSnapshot().review!;
    assert.equal(first.nonce, '1');
    await f.transfers.confirm(first.id);
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
    for (const nonce of [undefined, '0']) {
      await assert.rejects(f.transfers.prepare(RECIPIENT, '0.0000000000006', nonce), { code: 'INSUFFICIENT_BALANCE' });
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
    }
    await f.transfers.prepare(RECIPIENT, '0.0000000000001', '0');
    const next = f.transfers.getSnapshot().review!;
    assert.equal(next.nonce, '0');
    await f.transfers.confirm(next.id);
    assert.equal(f.signatures, 2);
    assert.deepEqual(f.broadcasts.map(raw => Transaction.from(raw).nonce), [1, 0]);
  } finally { await f.close(); }
});
