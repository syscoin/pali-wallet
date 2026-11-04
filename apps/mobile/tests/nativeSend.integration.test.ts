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
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public native transfer fixture password';
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
    const rpc = new NativeTransferRpc({
      fetch: async (_url, init) => {
        const b = JSON.parse(String(init.body));
        let result: unknown;
        if (b.method === 'eth_chainId') result = '0x1';
        else if (b.method === 'eth_getTransactionCount') result = '0x0';
        else if (b.method === 'eth_getBalance') result = '0x10000000000000000';
        else if (b.method === 'eth_feeHistory')
          result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
        else if (b.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (b.method === 'eth_estimateGas') result = '0x5208';
        else if (b.method === 'eth_getTransactionReceipt') result = null;
        else if (b.method === 'eth_sendRawTransaction') {
          const persisted = (await storage!.keyringStorage.get(
            'native-evm-transfer-v1'
          )) as { phase: string; rawTransaction: string };
          assert(['attempted', 'submitted'].includes(persisted.phase));
          assert.equal(persisted.rawTransaction, b.params[0]);
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
    await transfers!.confirm(review.id, PASSWORD);
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
    await transfers!.confirm(retry.id, PASSWORD);
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
  let gate: {
    stage: 'password' | 'hydrate';
    entered(): void;
    release: Promise<void>;
  } | null = null;
  const pause = async (stage: 'password' | 'hydrate') => {
    const current = gate;
    if (current?.stage === stage) {
      current.entered();
      await current.release;
    }
  };
  // Run the actual SDK work, then pause its result at the runtime's await
  // boundary. Cancellation must revoke custody before that result is consumed.
  class ControlledKeyring extends sdk.SoftwareKeyring {
    constructor(host: ConstructorParameters<typeof sdk.SoftwareKeyring>[0]) {
      super(host);
      const hydrate = this.createFirstAccount;
      this.createFirstAccount = async (...args) => {
        const result = await hydrate(...args);
        await pause('hydrate');
        return result;
      };
    }
    async unlock(password: string) {
      const result = await super.unlock(password);
      await pause('password');
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
      storage = await SqliteWalletStorage.open(
        nodeConnection(file).connection,
        digest,
        INSTALLATION,
        true
      );
      return storage;
    },
    loadSdk: async () => ({ ...sdk, SoftwareKeyring: ControlledKeyring }),
  });
  const authority = new NativeCustodyAuthority({
    async open() {
      runtime = (await base.open()) as KeyringRuntime;
      return runtime;
    },
  });
  const broadcasts: string[] = [];
  let loseResponse = false;
  const recovery = {
    oversized: false,
    repeated: false,
    receiptReads: 0,
    consumed: false,
  };
  const rpc = new NativeTransferRpc({
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getTransactionCount') {
        result =
          recovery.oversized &&
          (request.params[1] === 'pending' ||
            recovery.consumed ||
            (request.params[1] === 'finalized' && recovery.repeated))
            ? '0x1'
            : '0x0';
      } else if (request.method === 'eth_getBalance')
        result = '0x10000000000000000';
      else if (request.method === 'eth_feeHistory')
        result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
      else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
      else if (request.method === 'eth_estimateGas') result = '0x5208';
      else if (request.method === 'eth_getTransactionReceipt') {
        if (!recovery.oversized) result = null;
        else {
          recovery.receiptReads++;
          const tx = Transaction.from(broadcasts[0]!);
          result = {
            transactionHash: tx.hash,
            from: tx.from,
            to: tx.to,
            status: '0x1',
            blockNumber: '0xa',
            blockHash: '0x' + '8'.repeat(64),
            ...(recovery.repeated && recovery.receiptReads % 2 === 1
              ? {}
              : {
                  logs: [
                    {
                      address: tx.to,
                      topics: [],
                      data: '0x' + 'ab'.repeat(10_000),
                    },
                  ],
                }),
          };
        }
      } else if (request.method === 'eth_getBlockByNumber') {
        result = { number: '0xb', hash: '0x' + '9'.repeat(64) };
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
    authority,
    runtime,
    broadcasts,
    recovery,
    get transfers() {
      return transfers;
    },
    get signatures() {
      return signatures;
    },
    loseResponse() {
      loseResponse = true;
    },
    hold(stage: 'password' | 'hydrate') {
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
    async readJournal() {
      return storage.keyringStorage.get('native-evm-transfer-v1');
    },
    async close() {
      transfers.dispose();
      await authority.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

for (const stage of ['password', 'hydrate'] as const) {
  for (const retry of [false, true]) {
    test(`cancelling ${
      retry ? 'retry authorization' : 'signing'
    } during ${stage} keeps real custody and SDK state aligned`, async () => {
      const f = await cancellationFixture();
      let hold: ReturnType<typeof f.hold> | undefined;
      let pending: Promise<void> | undefined;
      try {
        await f.transfers.prepare(RECIPIENT, '0.001');
        if (retry) {
          f.loseResponse();
          await f.transfers.confirm(
            f.transfers.getSnapshot().review!.id,
            PASSWORD
          );
          await f.transfers.recover(true);
        }
        const initialSignatures = f.signatures;
        const initialBroadcasts = f.broadcasts.length;
        const journal = await f.readJournal();
        const revision = f.authority.getSnapshot().revision;
        hold = f.hold(stage);
        pending = f.transfers.confirm(
          f.transfers.getSnapshot().review!.id,
          PASSWORD
        );
        const rejected = assert.rejects(pending, { code: 'CANCELLED' });
        await hold.started;
        // Dispose exercises the same revocation while removing the screen's
        // controller; the other cases exercise Back/edit cancellation.
        if (retry && stage === 'hydrate') f.transfers.dispose();
        else f.transfers.cancel();
        assert.equal(f.authority.getSnapshot().phase, 'locked');
        assert.equal(f.authority.getSnapshot().revision, revision + 1);
        assert.equal(f.authority.getSnapshot().account, null);
        hold.finish();
        await rejected;
        pending = undefined;
        assert.equal(f.authority.getSnapshot().phase, 'locked');
        await assert.rejects(
          f.runtime.session.readEthereumAddress(),
          /NOT_READY/
        );
        assert.equal(f.signatures, initialSignatures);
        assert.equal(f.broadcasts.length, initialBroadcasts);
        assert.deepEqual(await f.readJournal(), journal);

        await f.authority.unlock(PASSWORD);
        assert.equal(f.authority.getSnapshot().phase, 'ready');
        if (retry && stage === 'hydrate') f.replaceTransfers();
        await f.transfers.recover(retry);
        if (!retry) await f.transfers.prepare(RECIPIENT, '0.001');
        await f.transfers.confirm(
          f.transfers.getSnapshot().review!.id,
          PASSWORD
        );
        assert.equal(f.signatures, initialSignatures + (retry ? 0 : 1));
        assert.equal(f.broadcasts.length, initialBroadcasts + 1);
        if (retry) assert.equal(f.broadcasts[0], f.broadcasts[1]);
      } finally {
        hold?.finish();
        await pending?.catch(() => undefined);
        await f.close();
      }
    });
  }
}

for (const repeated of [false, true]) {
  test(`${
    repeated ? 'repeated' : 'initial'
  } oversized receipt preserves real SDK journal bytes until finalized nonce consumption permits a higher nonce`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id, PASSWORD);
      const pending = (await f.readJournal()) as {
        phase: string;
        hash: string;
        rawTransaction: string;
      };
      assert.equal(pending.phase, 'submitted');
      f.recovery.oversized = true;
      f.recovery.repeated = repeated;
      // A pending-state nonce alone must not release the saved transaction.
      await assert.rejects(f.transfers.recover(true), { code: 'FAILED' });
      assert.equal(f.transfers.getSnapshot().phase, 'unavailable');
      assert.equal(f.transfers.getSnapshot().review, null);
      assert.deepEqual(await f.readJournal(), pending);
      await assert.rejects(f.transfers.prepare(RECIPIENT, '0.002'), {
        code: 'PENDING_TRANSFER',
      });
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
      f.recovery.receiptReads = 0;
      f.recovery.consumed = true;
      await f.transfers.recover(true);
      assert.equal(f.transfers.getSnapshot().phase, 'nonce-consumed');
      assert.match(
        f.transfers.getSnapshot().message!,
        /result is unavailable/i
      );
      assert.equal(f.transfers.getSnapshot().review, null);
      assert.deepEqual(await f.readJournal(), {
        ...pending,
        phase: 'nonce-consumed',
      });
      await f.transfers.prepare(RECIPIENT, '0.002');
      assert.equal(f.transfers.getSnapshot().review!.nonce, '1');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id, PASSWORD);
      assert.equal(f.signatures, 2);
      assert.equal(f.broadcasts.length, 2);
      assert.equal(Transaction.from(f.broadcasts[1]!).nonce, 1);
    } finally {
      await f.close();
    }
  });
}
