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
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public ERC20 transfer fixture password!';
const CONTRACT = '0x2222222222222222222222222222222222222222';
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const TOKEN = {
  contractAddress: CONTRACT,
  name: 'Public fixture token',
  symbol: 'FIX',
  decimals: 2,
};
const word = (value: bigint | number) =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`;

test('real SDK and SQLite bind ERC20 intent, reject changed funding, and retry identical bytes after cold restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-erc20-send-'));
  const file = path.join(directory, 'wallet.sqlite');
  const originalFetch = globalThis.fetch;
  let networkLeaks = 0;
  globalThis.fetch = (async () => {
    networkLeaks++;
    throw Error('Public network forbidden');
  }) as typeof fetch;
  let storage: SqliteWalletStorage | undefined;
  let runtime: KeyringRuntime | undefined;
  let authority: NativeCustodyAuthority | undefined;
  let transfers: NativeTransfers | undefined;
  const sent: string[] = [];
  const values = {
    tokens: 10000n,
    decimals: 2,
    eth: 10n ** 18n,
    nonce: 0,
    base: 1,
    gas: 50000,
    loseResponse: true,
    finalized: false,
  };
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
        else if (b.method === 'eth_getBlockByNumber')
          result = {
            number:
              b.params[0] === 'latest' || b.params[0] === 'finalized'
                ? '0x123'
                : b.params[0],
            hash: '0x' + 'a'.repeat(64),
          };
        else if (b.method === 'eth_getCode') result = '0x6000';
        else if (b.method === 'eth_getTransactionCount')
          result = values.finalized ? '0x1' : `0x${values.nonce.toString(16)}`;
        else if (b.method === 'eth_getBalance')
          result = `0x${values.eth.toString(16)}`;
        else if (b.method === 'eth_feeHistory')
          result = {
            oldestBlock: '0x123',
            baseFeePerGas: [
              `0x${values.base.toString(16)}`,
              `0x${values.base.toString(16)}`,
            ],
          };
        else if (b.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (b.method === 'eth_estimateGas')
          result = `0x${values.gas.toString(16)}`;
        else if (b.method === 'eth_call')
          result =
            b.params[0].data === '0x313ce567'
              ? word(values.decimals)
              : b.params[0].data.startsWith('0x70a08231')
              ? word(values.tokens)
              : word(1);
        else if (b.method === 'eth_getTransactionReceipt')
          result = values.finalized
            ? {
                transactionHash: keccak256(sent[0]!),
                from: Transaction.from(sent[0]!).from,
                to: CONTRACT,
                blockNumber: '0x100',
                blockHash: '0x' + 'a'.repeat(64),
                status: '0x1',
              }
            : null;
        else if (b.method === 'eth_sendRawTransaction') {
          const stored = (await storage!.keyringStorage.get(
            'native-evm-transfer-v1'
          )) as any;
          const entry = stored.entries.find(
            (entry: any) => entry.registration.chainId === '1'
          );
          assert.equal(entry.rawTransaction, b.params[0]);
          assert.equal(entry.intent.amountUnits, '123');
          assert.equal(entry.intent.token.decimals, 2);
          assert.ok(['attempted', 'submitted'].includes(entry.phase));
          sent.push(b.params[0]);
          if (values.loseResponse)
            throw Error('Lost acknowledgement after acceptance');
          result = keccak256(b.params[0]);
        } else throw Error(`Unexpected fixture method ${b.method}`);
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
    await runtime!.tokens!.add(0, TOKEN, () => undefined);

    for (const kind of [
      'token',
      'precision',
      'nonce',
      'gas',
      'old-fee',
    ] as const) {
      Object.assign(values, {
        tokens: 10000n,
        decimals: 2,
        eth: 10n ** 18n,
        nonce: 0,
        base: 1,
        gas: 50000,
      });
      await transfers!.prepareToken(CONTRACT, RECIPIENT, '1.23');
      const review = transfers!.getSnapshot().review!;
      assert.equal(review.recipient, RECIPIENT);
      assert.equal(review.amountUnits, '123');
      assert.equal(review.totalUnits, '180000');
      if (kind === 'token') values.tokens = 122n;
      if (kind === 'precision') values.decimals = 3;
      if (kind === 'nonce') values.nonce = 1;
      if (kind === 'gas') values.gas = 100000;
      if (kind === 'old-fee') {
        values.base = 0;
        values.eth = 100000n;
      }
      await assert.rejects(transfers!.confirm(review.id, PASSWORD), {
        code:
          kind === 'token'
            ? 'INSUFFICIENT_TOKEN_BALANCE'
            : kind === 'precision'
            ? 'TOKEN_CHANGED'
            : kind === 'old-fee'
            ? 'INSUFFICIENT_BALANCE'
            : 'EXPIRED',
      });
      assert.equal(sent.length, 0);
      assert.equal(authority!.getSnapshot().phase, 'ready');
    }
    Object.assign(values, {
      tokens: 10000n,
      decimals: 2,
      eth: 10n ** 18n,
      nonce: 0,
      base: 1,
      gas: 50000,
    });
    await transfers!.prepareToken(CONTRACT, RECIPIENT, '1.23');
    await transfers!.confirm(transfers!.getSnapshot().review!.id, PASSWORD);
    assert.equal(transfers!.getSnapshot().phase, 'unknown');
    const raw = sent[0]!;
    const hash = keccak256(raw);
    assert.equal(Transaction.from(raw).to, CONTRACT);
    assert.equal(Transaction.from(raw).value, 0n);
    assert.equal(
      Transaction.from(raw).data,
      encodeErc20Transfer(RECIPIENT, '123')
    );
    await assert.rejects(transfers!.prepare(RECIPIENT, '0.001'), {
      code: 'PENDING_TRANSFER',
    });
    await runtime!.tokens!.remove(1, CONTRACT, () => undefined);
    await runtime!.tokens!.add(2, { ...TOKEN, decimals: 3 }, () => undefined);
    transfers!.dispose();
    await authority!.dispose();
    await open();
    await authority!.unlock(PASSWORD);
    await transfers!.recover(true);
    assert.equal(transfers!.getSnapshot().review!.intent!.token.decimals, 2);
    assert.equal(transfers!.getSnapshot().review!.intent!.amountUnits, '123');
    const saved = (await storage!.keyringStorage.get(
      'native-evm-transfer-v1'
    )) as any;
    const tampered = structuredClone(saved);
    tampered.entries[0].intent.token.decimals = 3;
    await storage!.keyringStorage.set('native-evm-transfer-v1', tampered);
    await assert.rejects(
      transfers!.confirm(transfers!.getSnapshot().review!.id, PASSWORD),
      { code: 'EXPIRED' }
    );
    assert.equal(sent.length, 1);
    await storage!.keyringStorage.set('native-evm-transfer-v1', saved);
    await transfers!.recover(true);
    values.loseResponse = false;
    await transfers!.confirm(transfers!.getSnapshot().review!.id, PASSWORD);
    assert.equal(sent.length, 2);
    assert.equal(sent[1], raw);
    assert.equal(transfers!.getSnapshot().hash, hash);
    assert.equal(transfers!.getSnapshot().phase, 'pending');
    values.finalized = true;
    await transfers!.recover();
    assert.equal(transfers!.getSnapshot().phase, 'confirmed');
    assert.match(transfers!.getSnapshot().message!, /Transaction confirmed/);
    assert.match(transfers!.getSnapshot().message!, /Check the token balance/);
    assert.equal(networkLeaks, 0);
  } finally {
    transfers?.dispose();
    await authority?.dispose().catch(() => undefined);
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
