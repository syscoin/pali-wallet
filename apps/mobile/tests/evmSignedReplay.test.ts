import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, Transaction } from 'ethers';
import type { EvmSignedSubmission } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import {
  projectSavedEvmTransaction,
  observeRetainedEvmTransaction,
} from '../../../source/wallet/evmSignedReplay.ts';
import { observeEvmTransaction } from '../../../source/shared/evmTransactionObservation.ts';
import { signedRecordTestSession } from './signedRecordTestSession.ts';
const wallet = new Wallet('0x' + '11'.repeat(32));
const recipient = '0x' + '22'.repeat(20),
  blockHash = '0x' + '33'.repeat(32);
async function fixture() {
  let raw: string | undefined,
    revoked = false,
    nonce = 0;
  let canonicalTransactions: string[] | undefined;
  const receipts = new Map<string, any>(), calls: string[] = [];
  let beforeObservation: (() => Promise<void>) | undefined;
  const port = {
    async read() {
      return raw;
    },
    async compareAndSet(
      _profile: string,
      before: string | undefined,
      next: string,
      check: () => void
    ) {
      check();
      if (raw !== before) return false;
      raw = next;
      return true;
    },
  };
  const session = signedRecordTestSession(() => {
    if (revoked) throw Error('revoked');
  });
  const records = new EvmSignedRecords(port, () => 1000);
  const context = {
    account: { id: 0, type: 'HDAccount', address: wallet.address },
    network: {
      kind: 'ethereum',
      chainId: 7654321,
      slip44: 60,
      url: 'https://offline.invalid',
    },
  };
  const read = async (method: string, params: readonly unknown[]) => {
    calls.push(method);
    if (method === 'eth_chainId') return '0x74cbb1';
    if (method === 'eth_getTransactionCount') return '0x' + nonce.toString(16);
    if (method === 'eth_getTransactionReceipt') {
      await beforeObservation?.();
      return receipts.get(params[0] as string) ?? null;
    }
    if (method === 'eth_getBlockByNumber')
      return {
        number: '0xa',
        hash: blockHash,
        gasLimit: '0x1c9c380',
        ...(canonicalTransactions && { transactions: canonicalTransactions }),
      };
    throw Error(method);
  };
  const get = (hash: string) => records.readExact(session, '7654321', wallet.address, hash);
  const observe = (hash: string) => observeRetainedEvmTransaction(
    records, session, '7654321', wallet.address, hash,
    expected => observeEvmTransaction(expected, read, session.assertCurrent),
    session.assertCurrent
  );
  const list = async (options: { maximum: number; beforeHash?: string }) => {
    const page = await records.readPage(session, '7654321', wallet.address, options);
    return { nextCursor: page.nextCursor, transactions: page.entries.map(projectSavedEvmTransaction) };
  };
  async function append(
    n: number,
    type = 2,
    to: string | null = recipient,
    data = '0x',
    options: {
      operation?: 'cancel' | 'speed-up';
      originalHash?: string;
      fee?: number;
      value?: number;
      chainId?: number;
      gasLimit?: number;
    } = {}
  ) {
    const { operation = 'send', originalHash, fee = 3, chainId = 7654321 } = options;
    const bytes = await wallet.signTransaction({
      type,
      chainId,
      nonce: n,
      to: operation === 'cancel' ? wallet.address : to,
      value: options.value ?? (operation === 'cancel' ? 0 : 1),
      gasLimit: options.gasLimit ?? (operation === 'cancel' ? 42000 : 100000),
      ...(type === 2
        ? { maxFeePerGas: fee, maxPriorityFeePerGas: 1 }
        : { gasPrice: fee }),
      data,
      ...(type === 1
        ? {
            accessList: [
              { address: recipient, storageKeys: ['0x' + '00'.repeat(32)] },
            ],
          }
        : {}),
    });
    const tx = Transaction.from(bytes);
    const signed: EvmSignedSubmission = {
      rawTransaction: bytes,
      hash: tx.hash!,
      from: wallet.address,
      chainId: String(chainId),
      nonce: n,
      type,
      context: { ...context, network: { ...context.network, chainId }, operation, ...(originalHash ? { originalHash } : {}) },
    };
    const binding = operation === 'send' ? undefined : await records.captureVerifiedReplacement(session, {
      chainId: String(chainId), from: wallet.address, nonce: n, operation, originalHash: originalHash!,
    });
    await records.append(session, signed, undefined, binding);
    return tx;
  }
  return {
    port,
    records,
    session,
    get,
    observe,
    list,
    append,
    calls,
    receipts,
    read,
    bytes: () => raw,
    canonicalTransactions(hashes: string[]) {
      canonicalTransactions = hashes;
    },
    beforeObservation(callback: () => Promise<void>) {
      beforeObservation = callback;
    },
    nonce(n: number) {
      nonce = n;
    },
    revoke() {
      revoked = true;
    },
  };
}

function hold() {
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (enter = resolve)),
    wait = new Promise<void>((resolve) => (release = resolve));
  return { started, release, run: () => { enter(); return wait; } };
}

test('sender pages authenticate once and keep exact values without raw bytes in public projections', async () => {
  const f = await fixture();
  for (let n = 0; n < 4; n++) await f.append(n);
  const first = await f.list({ maximum: 2 });
  assert.deepEqual(
    first.transactions.map((row) => row.nonce),
    [3, 2]
  );
  assert(first.nextCursor);
  const next = await f.list({ maximum: 2, beforeHash: first.nextCursor });
  assert.deepEqual(
    next.transactions.map((row) => row.nonce),
    [1, 0]
  );
  assert.equal(next.nextCursor, null);
  assert(!JSON.stringify(first).includes('rawTransaction'));
  assert.equal(first.transactions[0]!.value, '1');
});

test('shared observation rejects accessors before any read', async () => {
  const f = await fixture(),
    tx = await f.append(0);
  let getters = 0;
  const input = {
    chainId: '7654321',
    hash: tx.hash!,
    from: wallet.address,
    to: recipient,
    nonce: '0',
  };
  Object.defineProperty(input, 'hash', {
    enumerable: true,
    get() {
      getters++;
      return tx.hash;
    },
  });
  await assert.rejects(
    observeEvmTransaction(input, f.read, () => undefined),
    { code: 'INVALID_INPUT' }
  );
  assert.equal(getters, 0);
  assert.equal(f.calls.length, 0);
});

for (const phase of ['confirmed', 'reverted', 'nonce-consumed'] as const)
  test(`retained transaction observation preserves ${phase} policy`, async () => {
    const f = await fixture(),
      tx = await f.append(0);
    if (phase === 'nonce-consumed') f.nonce(1);
    else
      f.receipts.set(tx.hash!, {
        transactionHash: tx.hash,
        from: wallet.address,
        to: recipient,
        status: phase === 'confirmed' ? '0x1' : '0x0',
        blockNumber: '0xa',
        blockHash,
      });
    const result = await observeRetainedEvmTransaction(
      f.records,
      f.session,
      '7654321',
      wallet.address,
      tx.hash!,
      (expected) =>
        observeEvmTransaction(expected, f.read, f.session.assertCurrent),
      f.session.assertCurrent
    );
    assert.equal(result.terminalPhase, phase);
    assert.equal(result.entry.phase, phase);
    assert.equal(result.entry.rawTransaction, tx.serialized);
    assert.equal((await f.get(tx.hash!))!.phase, phase);
  });

test('overlapping terminal observations of distinct nonces both persist', async () => {
  const f = await fixture();
  const first = await f.append(0);
  const second = await f.append(1);
  f.nonce(2);
  const held = hold();
  let reads = 0;
  f.beforeObservation(async () => {
    if (++reads === 1) await held.run();
  });
  const pending = f.observe(first.hash!);
  await held.started;
  try {
    const observed = await f.observe(second.hash!);
    assert.equal(observed.terminalPhase, 'nonce-consumed');
  } finally {
    held.release();
  }
  assert.equal((await pending).terminalPhase, 'nonce-consumed');
  for (const tx of [first, second])
    assert.equal((await f.get(tx.hash!))!.phase, 'nonce-consumed');
});

for (const conflict of ['changed target phase', 'new same-nonce sibling'] as const)
  test(`terminal observation rejects a ${conflict}`, async () => {
    const f = await fixture();
    const tx = await f.append(0);
    f.nonce(1);
    const held = hold();
    f.beforeObservation(held.run);
    const pending = assert.rejects(f.observe(tx.hash!), {
      code: 'CONTEXT_CHANGED',
    });
    await held.started;
    try {
      if (conflict === 'changed target phase') {
        await f.records.updatePhase(
          f.session,
          '7654321',
          wallet.address,
          tx.hash!,
          'attempted'
        );
      } else {
        await f.append(0, 2, recipient, '0x', {
          operation: 'cancel',
          originalHash: tx.hash!,
          fee: 7,
        });
      }
    } finally {
      held.release();
    }
    await pending;
    assert.equal(
      (await f.get(tx.hash!))!.phase,
      conflict === 'changed target phase' ? 'attempted' : 'signed'
    );
  });

async function minedCancellationFixture() {
  const f = await fixture();
  const original = await f.append(0);
  const cancellation = await f.append(0, 2, recipient, '0x', {
    operation: 'cancel',
    originalHash: original.hash!,
    fee: 7,
  });
  const otherHash = '0x' + 'dd'.repeat(32);
  const receipt = {
    transactionHash: cancellation.hash,
    from: wallet.address,
    to: wallet.address,
    status: '0x1',
    blockNumber: '0xa',
    blockHash,
    transactionIndex: '0x1',
  };
  f.receipts.set(cancellation.hash!, receipt);
  f.canonicalTransactions([otherHash, cancellation.hash!]);
  return { f, original, cancellation, otherHash, receipt };
}

for (const readNumber of [1, 2]) {
  for (const fault of ['missing hash', 'wrong index'] as const) {
    test(`cancellation observation ${readNumber} refuses ${fault} in a canonical block`, async () => {
      const { f, cancellation, otherHash, receipt } = await minedCancellationFixture();
      const before = f.bytes();
      let reads = 0;
      f.beforeObservation(async () => {
        if (++reads !== readNumber) return;
        if (fault === 'missing hash') {
          f.canonicalTransactions([otherHash, otherHash]);
        } else {
          f.receipts.set(cancellation.hash!, {
            ...receipt,
            transactionIndex: '0x0',
          });
        }
      });

      await assert.rejects(f.observe(cancellation.hash!), {
        code: 'CONTEXT_CHANGED',
      });
      assert.equal(reads, readNumber);
      assert.equal(f.bytes(), before);
    });
  }
}

test('cancellation reorg before commit keeps the exact saved siblings and a fresh observation can reconcile them', async () => {
  const { f, original, cancellation, receipt } = await minedCancellationFixture();
  const before = f.bytes(), recheck = hold();
  let reads = 0;
  f.beforeObservation(async () => {
    if (++reads === 2) await recheck.run();
  });

  const denied = assert.rejects(f.observe(cancellation.hash!), {
    code: 'CONTEXT_CHANGED',
  });
  await recheck.started;
  f.receipts.delete(cancellation.hash!);
  recheck.release();
  await denied;
  assert.equal(f.bytes(), before);

  f.receipts.set(cancellation.hash!, receipt);
  const confirmed = await f.observe(cancellation.hash!);
  assert.equal(confirmed.terminalPhase, 'confirmed');
  const read = (hash: string) =>
    f.records.readExact(f.session, '7654321', wallet.address, hash);
  const savedOriginal = await read(original.hash!);
  const savedCancellation = await read(cancellation.hash!);
  assert.equal(savedOriginal?.phase, 'nonce-consumed');
  assert.equal(savedOriginal?.rawTransaction, original.serialized);
  assert.equal(savedCancellation?.phase, 'confirmed');
  assert.equal(savedCancellation?.rawTransaction, cancellation.serialized);
});

test('shared observation captures original stored tuple and refuses revocation before phase commit', async () => {
  const f = await fixture(),
    tx = await f.append(0),
    before = f.bytes();
  await assert.rejects(
    observeRetainedEvmTransaction(
      f.records,
      f.session,
      '7654321',
      wallet.address,
      tx.hash!,
      async (expected) => {
        assert.deepEqual(expected, {
          chainId: '7654321',
          hash: tx.hash,
          from: wallet.address,
          to: recipient,
          nonce: '0',
        });
        f.revoke();
        return {
          status: 'mined',
          outcome: 'confirmed',
          block: { hash: blockHash, number: '10' },
        };
      },
      f.session.assertCurrent
    )
  );
  assert.equal(f.bytes(), before);
});
