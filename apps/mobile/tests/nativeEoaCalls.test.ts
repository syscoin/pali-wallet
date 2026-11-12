import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import {
  createCallsBundleRegistry,
  type CallsBundleStore,
} from '../../../source/wallet/dappCallsBundles.ts';
import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { createNativeEoaCalls, createNativeEoaCallsContinuation } from '../src/connections/eoaCalls.ts';
import type { NativePreparedConnectionTransaction } from '../src/connections/transactionRuntime.ts';

const wallet = new Wallet('0x' + '01'.repeat(32));
const from = wallet.address,
  first = '0x' + '22'.repeat(20),
  second = '0x' + '33'.repeat(20);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture({ lifetime = 60_000 } = {}) {
  let saved: CallsBundleStore = {},
    serial = 0,
    current = true,
    nonce = 0;
  let quoteWait = Promise.resolve(),
    feeLifetime = 60_000;
  let signingWait = Promise.resolve();
  let failBefore = false,
    failAfter = false;
  const claimed = new Set<string>();
  const retained = new Map<string, { rawTransaction: string; hash: string }>();
  const hash = (nonce: string) => retained.get(nonce)!.hash;
  const quoteRequests: Record<string, unknown>[] = [];
  const quotes: string[] = [],
    sent: string[] = [],
    dispatched: string[] = [];
  const registry = createCallsBundleRegistry({
    assertCurrent() {},
    now: Date.now,
    randomBytes: (length) => new Uint8Array(length).fill(++serial),
    storage: {
      read: async () => structuredClone(saved),
      write: async (value, guard) => {
        guard();
        saved = structuredClone(value);
      },
    },
  });
  const id = registry.generateWalletBundleId(),
    reservationId = registry.generateWalletBundleId(),
    origin = 'https://dapp.example';
  await registry.reserveSendCallsBundle(
    origin,
    id,
    { atomic: false, smartAccount: false, chainId: 1 },
    reservationId,
    from
  );
  const check = () => {
    if (!current) throw new Error('CANCELLED');
  };
  const calls = {
      version: '2.0.0' as const,
      atomicRequired: false,
      from,
      chainId: '1',
      calls: [
        { to: first, value: '1', data: '0x' },
        { to: second, value: '2', data: '0x' },
      ],
  };
  const operation = createNativeEoaCalls({
    continuation: createNativeEoaCallsContinuation({ calls, origin, bundleId: id, reservationId }),
    origin,
    bundleId: id,
    reservationId,
    registry,
    expiresAt: Date.now() + lifetime,
    assertCurrent: check,
    onBroadcast: (value) => {
      dispatched.push(value);
    },
    persistStopped: (submissionId, attempt) =>
      registry.recordStoppedEoaAttempt(
        origin,
        id,
        reservationId,
        submissionId,
        attempt,
        async () => retained.get(attempt.transaction.nonce)?.rawTransaction
      ),
    calls,
    async prepare(input): Promise<NativePreparedConnectionTransaction> {
      const request = input as {
        nonce?: number;
        to: string;
        value: string;
        gasLimit?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
      };
      quoteRequests.push({ ...request });
      quotes.push(request.to);
      await quoteWait;
      check();
      const transaction = snapshotPreparedEvmTransaction({
        from,
        to: request.to,
        value: BigInt(request.value).toString(),
        data: '0x',
        chainId: '1',
        nonce: String(request.nonce ?? nonce),
        gasLimit: request.gasLimit ?? '21000',
        type: 2,
        accessList: [],
        maxFeePerGas: request.maxFeePerGas ?? '2',
        maxPriorityFeePerGas: request.maxPriorityFeePerGas ?? '1',
      });
      const deadline = performance.now() + feeLifetime;
      return {
        transaction,
        feeComparison: { recommendationOnly: true },
        maximumFeeUnits: '42000',
        coveredFeeUnits: '0',
        maximumTotalUnits: String(42000n + BigInt(request.value)),
        expiresAtMonotonicMilliseconds: deadline,
        approval: null,
        async submit(guard, onBroadcast, submission) {
          assert.equal(submission.kind, 'eoa-calls');
          if (submission.kind !== 'eoa-calls') throw new Error('Missing calls association');
          assert.equal(submission.attempt.origin, origin);
          assert.equal(submission.attempt.bundleId, id);
          assert.equal(submission.attempt.reservationId, reservationId);
          assert.equal(submission.attempt.submissionId, saved[origin]![id]!.submissionId);
          guard();
          await signingWait;
          guard();
          if (
            performance.now() >= deadline ||
            claimed.has(transaction.nonce) ||
            failBefore
          )
            throw new Error('PREFLIGHT');
          const raw = Transaction.from({
            ...transaction,
            from: undefined,
            nonce: Number(transaction.nonce),
            accessList:
              transaction.type === 2
                ? transaction.accessList.map((entry) => ({
                    address: entry.address,
                    storageKeys: [...entry.storageKeys],
                  }))
                : undefined,
          });
          raw.signature = wallet.signingKey.sign(raw.unsignedHash);
          const value = raw.hash!;
          retained.set(transaction.nonce, {
            rawTransaction: raw.serialized,
            hash: value,
          });
          onBroadcast(value);
          if (failAfter) throw new Error('RESPONSE_LOST');
          claimed.add(transaction.nonce);
          nonce = Number(transaction.nonce) + 1;
          sent.push(transaction.to!);
          return value;
        },
      };
    },
  });
  return {
    operation,
    quotes,
    quoteRequests,
    sent,
    dispatched,
    registry,
    origin,
    id,
    hash,
    saved: () => saved[origin]?.[id],
    lock: () => {
      current = false;
      operation.dispose();
    },
    waitForQuote: (wait: Promise<void>) => {
      quoteWait = wait;
    },
    expireFees: () => {
      feeLifetime = 5;
    },
    waitForSigning: (wait: Promise<void>) => {
      signingWait = wait;
    },
    failBefore: (value: boolean) => {
      failBefore = value;
    },
    failAfter: () => {
      failAfter = true;
    },
    claimNonce: (value: string) => {
      claimed.add(value);
      nonce = Number(value) + 1;
    },
  };
}

test('two calls require two exact fee consents and no attempt begins before consent', async () => {
  const f = await fixture();
  await f.operation.start();
  assert.equal(f.saved()?.submissionStarted, undefined);
  assert.deepEqual(f.quotes, [first]);
  assert.equal(
    f.operation.getSnapshot().phase,
    'review',
    String(f.operation.getSnapshot().progress[1]?.failure?.cause)
  );
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.deepEqual(f.sent, [first]);
  assert.equal(f.operation.getSnapshot().index, 1);
  assert.equal(
    f.operation.getSnapshot().phase,
    'review',
    String(f.operation.getSnapshot().progress[1]?.failure?.cause)
  );
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.equal(f.operation.getSnapshot().phase, 'complete');
  assert.deepEqual(f.sent, [first, second]);
  assert.equal(f.saved()?.txHashes.length, 2);
  assert.equal(f.saved()?.submissionCompleted, true);
});

test('a stale confirmation cannot approve the promoted call', async () => {
  const f = await fixture();
  await f.operation.start();
  const stale = f.operation.getSnapshot().revision;
  await f.operation.approve(stale);
  await assert.rejects(f.operation.approve(stale), /REVIEW_REQUIRED/);
  assert.deepEqual(f.sent, [first]);
  f.operation.dispose();
  await tick();
});

test('a held quote cannot publish or begin after lock', async () => {
  const f = await fixture(),
    held = Promise.withResolvers<void>();
  f.waitForQuote(held.promise);
  const started = f.operation.start();
  await tick();
  f.lock();
  held.resolve();
  await started;
  await tick();
  assert.equal(f.saved()?.submissionStarted, undefined);
  assert.deepEqual(f.dispatched, []);
  assert.equal(f.operation.getSnapshot().prepared, null);
});

test('expired fees fail before dispatch and retry requires a fresh confirmation', async () => {
  const f = await fixture();
  f.expireFees();
  await f.operation.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(f.operation.getSnapshot().phase, 'failed');
  assert.deepEqual(f.dispatched, []);
  await f.operation.start();
  assert.equal(f.operation.getSnapshot().phase, 'review');
  assert.deepEqual(f.dispatched, []);
  f.operation.dispose();
  await tick();
});

test('retry after a definitive failure never resends the acknowledged prefix', async () => {
  const f = await fixture();
  await f.operation.start();
  await f.operation.approve(f.operation.getSnapshot().revision);
  f.failBefore(true);
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.equal(f.operation.getSnapshot().phase, 'failed');
  f.failBefore(false);
  await f.operation.start();
  assert.equal(f.operation.getSnapshot().index, 1);
  assert.deepEqual(f.sent, [first]);
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.deepEqual(f.sent, [first, second]);
  assert.deepEqual(f.quotes, [first, second, second]);
});

test('a nonce claimed while call two is held requires a fresh suffix quote', async () => {
  const f = await fixture();
  await f.operation.start();
  await f.operation.approve(f.operation.getSnapshot().revision);
  f.claimNonce('1');
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.equal(f.operation.getSnapshot().phase, 'failed');
  await f.operation.start();
  assert.equal(f.operation.getSnapshot().prepared?.transaction.nonce, '2');
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.deepEqual(f.sent, [first, second]);
});

test('wire admission followed by lost response stays unknown and keeps its attempted hash', async () => {
  const f = await fixture();
  await f.operation.start();
  f.failAfter();
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.equal(f.operation.getSnapshot().phase, 'unknown');
  assert.equal(f.saved()?.submissionStarted, true);
  assert.deepEqual(f.saved()?.txHashes, [f.hash('0')]);
  assert.deepEqual(f.sent, []);
  await assert.rejects(f.operation.start(), /REVIEW_REQUIRED/);
});

for (const lostAt of [0, 1]) {
  for (const receiptStatus of [0, 1]) {
    test(`stopped call ${
      lostAt + 1
    } resolves its lost acknowledgement from receipt ${receiptStatus}`, async () => {
      const f = await fixture();
      await f.operation.start();
      if (lostAt === 1)
        await f.operation.approve(f.operation.getSnapshot().revision);
      f.failAfter();
      await f.operation.approve(f.operation.getSnapshot().revision);
      assert.equal(f.operation.getSnapshot().phase, 'unknown');
      const status = await f.registry.resolveCallsStatus(
        {
          assertCurrent() {},
          forChain: () => ({
            async getBlockHash() {
              return '0x' + 'ab'.repeat(32);
            },
            async getTransactionReceipt(transactionHash) {
              return {
                hash: transactionHash,
                status:
                  transactionHash === f.hash(String(lostAt))
                    ? receiptStatus
                    : 1,
                blockHash: '0x' + 'ab'.repeat(32),
                blockNumber: 7,
                gasUsed: 21000n,
                logs: [],
              };
            },
          }),
        },
        f.origin,
        f.id
      );
      assert.equal(
        status.status,
        receiptStatus === 0
          ? lostAt === 0
            ? 500
            : 600
          : lostAt === 0
          ? 600
          : 200
      );
      assert.equal(status.receipts?.length, lostAt + 1);
      await assert.rejects(f.operation.start(), /REVIEW_REQUIRED/);
    });
  }
}

test('closing the second review retains the successful prefix as a partial completion', async () => {
  const f = await fixture();
  await f.operation.start();
  await f.operation.approve(f.operation.getSnapshot().revision);
  f.operation.dispose();
  await tick();
  await tick();
  assert.deepEqual(f.saved()?.txHashes, [f.hash('0')]);
  assert.equal(f.saved()?.failed, true);
  assert.equal(f.saved()?.submissionCompleted, true);
  assert.deepEqual(f.sent, [first]);
});

test('expiry after consent but before wire admission is a definite failure with fresh-review retry', async () => {
  const f = await fixture(),
    held = Promise.withResolvers<void>();
  f.expireFees();
  f.waitForSigning(held.promise);
  await f.operation.start();
  const confirming = f.operation.approve(f.operation.getSnapshot().revision);
  await new Promise((resolve) => setTimeout(resolve, 15));
  held.resolve();
  await confirming;
  assert.equal(f.operation.getSnapshot().phase, 'failed');
  assert.deepEqual(f.dispatched, []);
  assert.equal(f.saved()?.submissionStarted, false);
  await f.operation.start();
  assert.equal(f.operation.getSnapshot().phase, 'review');
  assert.deepEqual(f.dispatched, []);
  f.operation.dispose();
  await tick();
});

test('a quote completing after request expiry cannot start an attempt', async () => {
  const f = await fixture({ lifetime: 5 }),
    held = Promise.withResolvers<void>();
  f.waitForQuote(held.promise);
  const started = f.operation.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  held.resolve();
  await started;
  assert.equal(f.operation.getSnapshot().phase, 'failed');
  assert.equal(f.saved()?.submissionStarted, undefined);
  assert.deepEqual(f.dispatched, []);
  f.operation.dispose();
});

test('requoting a fee replaces only the current unsigned consent', async () => {
  const f = await fixture();
  await f.operation.start();
  const old = f.operation.getSnapshot().revision;
  await f.operation.requote(old, {
    gasLimit: '21000',
    maxFeePerGas: '9007199254740993',
    maxPriorityFeePerGas: '0',
  });
  assert.deepEqual(f.sent, []);
  assert.equal(f.saved()?.submissionStarted, undefined);
  const firstQuote = f.operation.getSnapshot().prepared;
  assert(firstQuote?.transaction.type === 2);
  assert.equal(firstQuote.transaction.maxFeePerGas, '9007199254740993');
  await assert.rejects(f.operation.approve(old), /REVIEW_REQUIRED/);
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.deepEqual(f.sent, [first]);
  assert.equal(f.operation.getSnapshot().index, 1);
  const nextQuote = f.operation.getSnapshot().prepared;
  assert(nextQuote?.transaction.type === 2);
  assert.equal(nextQuote.transaction.maxFeePerGas, '2');
  f.operation.dispose();
  await tick();
});

test('a second-call requote keeps the acknowledged prefix and cannot resend it', async () => {
  const f = await fixture();
  await f.operation.start();
  await f.operation.approve(f.operation.getSnapshot().revision);
  const acknowledged = [...f.saved()!.txHashes];
  await f.operation.requote(f.operation.getSnapshot().revision, {
    gasLimit: '22000',
    maxFeePerGas: '3',
    maxPriorityFeePerGas: '1',
  });
  assert.equal(f.operation.getSnapshot().index, 1);
  assert.deepEqual(f.saved()!.txHashes, acknowledged);
  assert.deepEqual(f.sent, [first]);
  await f.operation.approve(f.operation.getSnapshot().revision);
  assert.deepEqual(f.sent, [first, second]);
  assert.deepEqual(
    f.quoteRequests.map((row) => row.to),
    [first, second, second]
  );
});

test('a held fee requote cannot publish after lock', async () => {
  const f = await fixture();
  await f.operation.start();
  const gate = Promise.withResolvers<void>();
  f.waitForQuote(gate.promise);
  const pending = f.operation.requote(f.operation.getSnapshot().revision, {
    gasLimit: '21000',
    maxFeePerGas: '3',
    maxPriorityFeePerGas: '1',
  });
  assert.equal(f.operation.getSnapshot().phase, 'preparing');
  f.lock();
  gate.resolve();
  await assert.rejects(pending, /CANCELLED/);
  assert.deepEqual(f.sent, []);
  assert.equal(f.saved()?.submissionStarted, undefined);
});

test('an expired current quote cannot be replaced after its consent deadline', async () => {
  const f = await fixture();
  f.expireFees();
  await f.operation.start();
  const gate = Promise.withResolvers<void>();
  f.waitForQuote(gate.promise);
  const pending = f.operation.requote(f.operation.getSnapshot().revision, {
    gasLimit: '21000',
    maxFeePerGas: '3',
    maxPriorityFeePerGas: '1',
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  gate.resolve();
  await assert.rejects(pending, /REVIEW_REQUIRED/);
  assert.deepEqual(f.sent, []);
  assert.equal(f.saved()?.submissionStarted, undefined);
  f.operation.dispose();
});

test('a requote cannot change the nonce underlying the remaining sequence', async () => {
  const f = await fixture();
  await f.operation.start();
  f.claimNonce('0');
  await assert.rejects(
    f.operation.requote(f.operation.getSnapshot().revision, {
      gasLimit: '21000',
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    }),
    /REVIEW_REQUIRED/
  );
  await tick();
  assert.equal(f.operation.getSnapshot().phase, 'failed');
  assert.deepEqual(f.sent, []);
  await f.operation.start();
  assert.equal(f.operation.getSnapshot().prepared?.transaction.nonce, '1');
  f.operation.dispose();
});
