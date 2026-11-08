import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCallsBundleRegistry,
  type CallsBundleStore,
} from '../../../source/wallet/dappCallsBundles.ts';
import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { createNativeEoaCalls } from '../src/connections/eoaCalls.ts';
import type { NativePreparedConnectionTransaction } from '../src/connections/transactionRuntime.ts';

const from = '0x' + '11'.repeat(20),
  first = '0x' + '22'.repeat(20),
  second = '0x' + '33'.repeat(20);
const hash = (nonce: string) =>
  '0x' + Number(nonce).toString(16).padStart(64, '0');
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
  const operation = createNativeEoaCalls({
    origin,
    bundleId: id,
    reservationId,
    registry,
    expiresAt: Date.now() + lifetime,
    assertCurrent: check,
    onBroadcast: (value) => {
      dispatched.push(value);
    },
    calls: {
      version: '2.0.0',
      atomicRequired: false,
      from,
      chainId: '1',
      calls: [
        { to: first, value: '1', data: '0x' },
        { to: second, value: '2', data: '0x' },
      ],
    },
    async prepare(input): Promise<NativePreparedConnectionTransaction> {
      const request = input as { nonce?: number; to: string; value: string };
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
        gasLimit: '21000',
        type: 2,
        accessList: [],
        maxFeePerGas: '2',
        maxPriorityFeePerGas: '1',
      });
      const deadline = performance.now() + feeLifetime;
      return {
        transaction,
        maximumFeeUnits: '42000',
        coveredFeeUnits: '0',
        maximumTotalUnits: String(42000n + BigInt(request.value)),
        expiresAtMonotonicMilliseconds: deadline,
        approval: null,
        async submit(guard, onBroadcast) {
          guard();
          await signingWait;
          guard();
          if (
            performance.now() >= deadline ||
            claimed.has(transaction.nonce) ||
            failBefore
          )
            throw new Error('PREFLIGHT');
          const value = hash(transaction.nonce);
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
    sent,
    dispatched,
    registry,
    origin,
    id,
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
  assert.deepEqual(f.saved()?.txHashes, [hash('0')]);
  assert.deepEqual(f.sent, []);
  await assert.rejects(f.operation.start(), /REVIEW_REQUIRED/);
});

test('closing the second review retains the successful prefix as a partial completion', async () => {
  const f = await fixture();
  await f.operation.start();
  await f.operation.approve(f.operation.getSnapshot().revision);
  f.operation.dispose();
  await tick();
  await tick();
  assert.deepEqual(f.saved()?.txHashes, [hash('0')]);
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
