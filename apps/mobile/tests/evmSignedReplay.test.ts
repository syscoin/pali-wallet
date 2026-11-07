import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, Transaction, sha256 } from 'ethers';
import type { EvmSignedSubmission } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import {
  EvmSignedReplay,
  observeRetainedEvmTransaction,
} from '../../../source/wallet/evmSignedReplay.ts';
import { observeEvmTransaction } from '../../../source/shared/evmTransactionObservation.ts';
import { historicalSignedBundle, signedRecordTestSession } from './signedRecordTestSession.ts';
const wallet = new Wallet('0x' + '11'.repeat(32));
const recipient = '0x' + '22'.repeat(20),
  blockHash = '0x' + '33'.repeat(32);
async function fixture() {
  let raw: string | undefined,
    clock = 10,
    revoked = false,
    nonce = 0,
    lost = false;
  let canonicalTransactions: string[] | undefined;
  const receipts = new Map<string, any>(),
    dispatched: string[] = [],
    calls: string[] = [];
  let beforeObservation: (() => Promise<void>) | undefined,
    beforeAdmission: (() => Promise<void>) | undefined,
    afterAdmission: ((admission: Promise<string>) => Promise<string>) | undefined,
    beforeRecordsRead: (() => Promise<void>) | undefined,
    beforeSend: (() => void) | undefined,
    beforeAck: (() => Promise<void>) | undefined,
    ordinaryPreflight: () => Promise<void> = async () => undefined,
    cancellationCheck: (() => Promise<void>) | undefined = async () => undefined;
  const port = {
    async read() {
      await beforeRecordsRead?.();
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
  const create = () =>
    new EvmSignedReplay(
      records,
      () => ({
        recordSession: session,
        context,
        assertCurrent: session.assertCurrent,
        observe: (expected) =>
          observeEvmTransaction(expected, read, session.assertCurrent),
        async dispatch(bytes, admit, context) {
          assert(Object.isFrozen(context));
          assert.equal(context.hash, Transaction.from(bytes).hash);
          await beforeAdmission?.();
          const admission = admit(() => {
            beforeSend?.();
            dispatched.push(bytes);
            return (async () => {
              await beforeAck?.();
              if (lost) throw Error('lost');
              return Transaction.from(bytes).hash!;
            })();
          }, context.operation === 'cancel' || context.requiresPayerCheck ? cancellationCheck! : ordinaryPreflight);
          return afterAdmission?.(admission) ?? admission;
        },
      }),
      () => clock,
      (n) => new Uint8Array(n).fill(9)
    );
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
      historical?: true;
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
    if (options.historical) {
      assert(raw);
      const bundle = JSON.parse(raw);
      const { entries: [historical] } = JSON.parse(await historicalSignedBundle(session, bytes, 'signed'));
      const { chunks, ...summary } = historical;
      const entries = [...bundle.entries, { ...summary, operation, ...(originalHash ? { originalHash } : {}), chunks }];
      const revision = bundle.revision + 1;
      const root = await session.keyring.encryptPrivateRecord({
        domain: bundle.root.domain,
        recordId: bundle.root.recordId,
        plaintext: new TextEncoder().encode(JSON.stringify({
          version: 1, revision, transactions: entries.length,
          entriesHash: sha256(new TextEncoder().encode(JSON.stringify(entries))),
        })),
      });
      raw = JSON.stringify({ ...bundle, revision, root, entries });
    } else {
      const binding = operation === 'send' ? undefined : await records.captureVerifiedReplacement(session, {
        chainId: String(chainId), from: wallet.address, nonce: n, operation, originalHash: originalHash!,
      });
      await records.append(session, signed, undefined, binding);
    }
    return tx;
  }
  return {
    records,
    session,
    create,
    append,
    dispatched,
    calls,
    receipts,
    read,
    context,
    bytes: () => raw,
    canonicalTransactions(hashes: string[]) {
      canonicalTransactions = hashes;
    },
    beforeObservation(callback: () => Promise<void>) {
      beforeObservation = callback;
    },
    beforeAdmission(callback: () => Promise<void>) {
      beforeAdmission = callback;
    },
    afterAdmission(callback: (admission: Promise<string>) => Promise<string>) {
      afterAdmission = callback;
    },
    beforeRecordsRead(callback: () => Promise<void>) {
      beforeRecordsRead = callback;
    },
    beforeOrdinaryReplay(callback: () => Promise<void>) {
      ordinaryPreflight = callback;
    },
    beforeCancellation(callback: (() => Promise<void>) | undefined) {
      cancellationCheck = callback;
    },
    beforeSend(callback: () => void) {
      beforeSend = callback;
    },
    beforeAck(callback: () => Promise<void>) {
      beforeAck = callback;
    },
    nonce(n: number) {
      nonce = n;
    },
    expire() {
      clock += 90001;
    },
    advance(ms: number) {
      clock += ms;
    },
    revoke() {
      revoked = true;
    },
    lost() {
      lost = true;
    },
  };
}

function hold() {
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (enter = resolve)),
    wait = new Promise<void>((resolve) => (release = resolve));
  return { started, release, run: () => { enter(); return wait; } };
}

test('a saved cancellation suppresses every older payment variant for its nonce, but preserves canonical history', async () => {
  const f = await fixture(), original = await f.append(0),
    faster = await f.append(0, 2, recipient, '0x', { operation: 'speed-up', originalHash: original.hash!, fee: 5 });
  const replay = f.create();
  assert.equal((await replay.prepare(original.hash!)).status, 'review');
  const cancel = await f.append(0, 2, recipient, '0x', { operation: 'cancel', originalHash: faster.hash!, fee: 7 });
  for (const tx of [original, faster]) {
    await assert.rejects(replay.prepare(tx.hash!), { code: 'CONTEXT_CHANGED' });
    assert.equal((await replay.get(tx.hash!))?.hash, tx.hash);
  }
  const later = await f.append(1), gap = await replay.prepare(later.hash!);
  if (gap.status !== 'review') throw Error('review');
  assert.equal(gap.review.missingNonce, '0');
  assert.deepEqual(gap.review.predecessors.map((entry) => entry.hash), [cancel.hash]);
  assert.deepEqual((await replay.list({ nonce: 0 })).transactions.map((entry) => entry.hash), [cancel.hash]);
  assert.deepEqual((await replay.list()).transactions.map((entry) => entry.hash), [later.hash, cancel.hash, faster.hash, original.hash]);
  const retry = await replay.prepare(cancel.hash!);
  if (retry.status !== 'review') throw Error('review');
  await replay.confirm(retry.review.id);
  assert.deepEqual(f.dispatched, [cancel.serialized]);
  f.receipts.set(original.hash!, { transactionHash: original.hash, from: wallet.address, to: recipient, status: '0x1', blockNumber: '0xa', blockHash });
  assert.equal((await replay.prepare(original.hash!)).status, 'confirmed');
});

for (const stage of ['prepare', 'confirm'] as const) {
  test(`a cancellation saved while ${stage} is observing cannot release the original`, async () => {
    const f = await fixture(), original = await f.append(0), replay = f.create();
    const begin = await replay.prepare(original.hash!);
    if (begin.status !== 'review') throw Error('review');
    const observation = hold();
    f.beforeObservation(observation.run);
    const pending = stage === 'prepare' ? replay.prepare(original.hash!) : replay.confirm(begin.review.id);
    const rejected = assert.rejects(pending, { code: 'CONTEXT_CHANGED' });
    await observation.started;
    await f.append(0, 2, recipient, '0x', { operation: 'cancel', originalHash: original.hash!, fee: 7 });
    observation.release();
    await rejected;
    assert.equal(f.dispatched.length, 0);
  });
}

for (const change of ['cancel', 'revoke'] as const) {
  test(`late ${change} during transport preflight stops the original before request admission`, async () => {
    const f = await fixture(), original = await f.append(0), replay = f.create();
    const prepared = await replay.prepare(original.hash!);
    if (prepared.status !== 'review') throw Error('review');
    const preflight = hold();
    f.beforeAdmission(preflight.run);
    const pending = replay.confirm(prepared.review.id);
    const rejected = assert.rejects(pending, change === 'cancel' ? { code: 'CONTEXT_CHANGED' } : /revoked/);
    await preflight.started;
    if (change === 'cancel')
      await f.append(0, 2, recipient, '0x', { operation: 'cancel', originalHash: original.hash!, fee: 7 });
    else f.revoke();
    preflight.release();
    await rejected;
    assert.equal(f.dispatched.length, 0);
    await assert.rejects(replay.confirm(prepared.review.id), { code: 'EXPIRED' });
  });
}

test('ordinary replay checks inside admission and releases the queue before acknowledgment', async () => {
  const f = await fixture(), original = await f.append(0), replay = f.create();
  const prepared = await replay.prepare(original.hash!);
  if (prepared.status !== 'review') throw Error('review');
  const retainedRead = hold(), preflight = hold(), ack = hold();
  let checked = false;
  f.beforeAdmission(async () => f.beforeRecordsRead(retainedRead.run));
  f.beforeOrdinaryReplay(async () => {
    checked = true;
    await preflight.run();
  });
  f.beforeAck(ack.run);
  const pending = replay.confirm(prepared.review.id);
  await retainedRead.started;
  assert.equal(checked, false);
  retainedRead.release();
  await preflight.started;
  assert.deepEqual(f.dispatched, []);
  preflight.release();
  await ack.started;
  await f.append(0, 2, recipient, '0x', { operation: 'cancel', originalHash: original.hash!, fee: 7 });
  ack.release();
  assert.equal((await pending).status, 'submitted');
  assert.deepEqual(f.dispatched, [original.serialized]);
  await assert.rejects(replay.prepare(original.hash!), { code: 'CONTEXT_CHANGED' });
});

async function cancellationFixture(operation: 'cancel' | 'speed-up' = 'cancel') {
  const f = await fixture();
  const original = operation === 'cancel' ? await f.append(0) : await f.append(0, 2, wallet.address, '0x', { value: 0 });
  const cancellation = await f.append(0, 2, wallet.address, '0x', { operation, originalHash: original.hash!, fee: 7, value: 0 });
  const replay = f.create(), prepared = await replay.prepare(cancellation.hash!);
  if (prepared.status !== 'review') throw Error('review');
  return { f, replay, id: prepared.review.id, cancellation };
}

test('only an exact empty self fee replacement enters late payer readiness', async () => {
  for (const self of [false, true]) {
    const f = await fixture();
    const original = await f.append(0, 2, self ? wallet.address : recipient, '0x', { value: self ? 0 : 1 });
    const replacement = await f.append(0, 2, self ? wallet.address : recipient, '0x', {
      operation: 'speed-up', originalHash: original.hash!, value: self ? 0 : 1, fee: 9,
    });
    let checked = 0;
    f.beforeCancellation(async () => { checked++; throw Error('delegated payer'); });
    const replay = f.create(), prepared = await replay.prepare(replacement.hash!);
    if (prepared.status !== 'review') throw Error('review');
    const confirm = replay.confirm(prepared.review.id);
    if (self) {
      await assert.rejects(confirm, /delegated payer/);
      assert.deepEqual(f.dispatched, []);
    } else {
      assert.equal((await confirm).status, 'submitted');
      assert.deepEqual(f.dispatched, [replacement.serialized]);
    }
    assert.equal(checked, self ? 1 : 0);
  }
});

test('cancellation preflight sees delegation that became live during the authenticated records read', async () => {
  const { f, replay, id } = await cancellationFixture();
  const record = hold();
  let code = '0x', checks = 0;
  f.beforeAdmission(async () => f.beforeRecordsRead(record.run));
  f.beforeCancellation(async () => {
    checks++;
    if (code !== '0x') throw Error('payer has delegated code');
  });
  const denied = assert.rejects(replay.confirm(id), /payer has delegated code/);
  await record.started;
  assert.equal(checks, 0);
  code = '0xef0100' + '55'.repeat(20);
  record.release();
  await denied;
  assert.equal(checks, 1);
  assert.deepEqual(f.dispatched, []);
});

test('cancellation holds records through the late check but releases them before transport acknowledgment', async () => {
  const { f, replay, id, cancellation } = await cancellationFixture();
  const late = hold(), ack = hold();
  f.beforeCancellation(late.run);
  f.beforeAck(ack.run);
  const pending = replay.confirm(id);
  await late.started;
  let done = false;
  const queued = f.records.validate(f.session).then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  assert.deepEqual(f.dispatched, []);
  late.release();
  await ack.started;
  await queued;
  ack.release();
  assert.equal((await pending).status, 'submitted');
  assert.deepEqual(f.dispatched, [cancellation.serialized]);
});

for (const [operation, reason] of [['cancel', 'review expiry'], ['cancel', 'transport timeout'], ['speed-up', 'review expiry']] as const) {
  test(`${operation} skips journal reads when ${reason} ends admission in the queue`, async (t) => {
    const { f, replay, id } = await cancellationFixture(operation);
    const record = hold(), stop = hold();
    const profile = t.mock.method(f.session.keyring, 'getPrivateRecordProfileId');
    let reads = 0, enqueued!: () => void, blocker!: Promise<number>;
    const queued = new Promise<void>((resolve) => { enqueued = resolve; });
    f.beforeAdmission(async () => {
      f.beforeRecordsRead(async () => {
        if (++reads === 1) await record.run();
      });
      blocker = f.records.validate(f.session);
      await record.started;
    });
    f.afterAdmission((admission) => {
      enqueued();
      return reason === 'review expiry' ? admission : Promise.race([
        admission,
        stop.run().then(() => { throw Error('transport timed out'); }),
      ]);
    });
    const denied = assert.rejects(replay.confirm(id), reason === 'review expiry'
      ? { code: 'EXPIRED' } : /transport timed out/);
    await queued;
    const profilesBefore = profile.mock.callCount();
    if (reason === 'review expiry') f.expire();
    else {
      stop.release();
      await denied;
    }
    record.release();
    await blocker;
    await denied;
    // Drain the abandoned admission and count only the blocker and this read.
    await f.records.validate(f.session);
    assert.equal(reads, 2);
    assert.equal(profile.mock.callCount(), profilesBefore + 1);
    assert.deepEqual(f.dispatched, []);
  });
}

for (const budget of [5, 12000]) {
  test(`a hung cancellation preflight releases the records queue at ${budget}ms`, async (t) => {
    const { f, replay, id } = await cancellationFixture();
    if (budget === 5) f.advance(89995);
    const late = hold();
    f.beforeCancellation(late.run);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const denied = assert.rejects(replay.confirm(id), { code: 'EXPIRED' });
    await late.started;
    let done = false;
    const queued = f.records.validate(f.session).then(() => { done = true; });
    t.mock.timers.tick(budget - 1);
    await Promise.resolve();
    assert.equal(done, false);
    t.mock.timers.tick(1);
    await denied;
    await queued;
    late.release();
    await Promise.resolve();
    assert.deepEqual(f.dispatched, []);
  });
}

test('a preflight result cannot outlive the monotonic deadline if the timeout callback was delayed', async () => {
  const { f, replay, id } = await cancellationFixture();
  f.beforeCancellation(async () => f.advance(12000));
  await assert.rejects(replay.confirm(id), { code: 'EXPIRED' });
  assert.deepEqual(f.dispatched, []);
});

test('cancellation checks the same owner after late preflight and preserves pre-POST failures', async () => {
  const stale = await cancellationFixture(), late = hold();
  stale.f.beforeCancellation(late.run);
  const denied = assert.rejects(stale.replay.confirm(stale.id), /revoked/);
  await late.started;
  stale.f.revoke();
  late.release();
  await denied;
  assert.deepEqual(stale.f.dispatched, []);

  const stopped = await cancellationFixture();
  stopped.f.beforeSend(() => { throw Error('stopped before fetch'); });
  await assert.rejects(stopped.replay.confirm(stopped.id), /stopped before fetch/);
  assert.deepEqual(stopped.f.dispatched, []);
});

test('cancellation cannot be admitted without a late checker', async () => {
  const { f, replay, id } = await cancellationFixture();
  f.beforeCancellation(undefined);
  await assert.rejects(replay.confirm(id), { code: 'CONTEXT_CHANGED' });
  assert.deepEqual(f.dispatched, []);
});

test('Cancel bars payment replay in its own nonce scope, including historical appends after Cancel', async () => {
  const f = await fixture(), original = await f.append(0), replay = f.create();
  const witness = (originalHash: string) => f.records.readPendingCancellation(f.session, {
    chainId: '7654321', from: wallet.address, nonce: 0, originalHash,
  });
  await f.append(1, 2, recipient, '0x', { operation: 'cancel', originalHash: '0x' + '44'.repeat(32), fee: 7 });
  await f.append(0, 2, recipient, '0x', { operation: 'cancel', originalHash: '0x' + '55'.repeat(32), fee: 7, chainId: 1 });
  assert.equal(await witness(original.hash!), null);
  assert.equal((await replay.prepare(original.hash!)).status, 'review');
  const cancel = await f.append(0, 2, recipient, '0x', { operation: 'cancel', originalHash: original.hash!, fee: 7 });
  assert.equal(await witness(cancel.hash!), cancel.serialized);
  await assert.rejects(witness(original.hash!), /ORIGINAL_CHANGED/);
  const fenced = f.bytes();
  await assert.rejects(f.append(0, 2, recipient, '0x', { fee: 8 }), {
    name: 'EvmSignedRecordCancellationFence', recoveryHash: cancel.hash,
  });
  assert.equal(f.bytes(), fenced);
  await assert.rejects(f.append(0, 2, recipient, '0x', { operation: 'speed-up', originalHash: original.hash!, fee: 9 }), /ORIGINAL_CHANGED/);
  const historical = await f.append(0, 2, recipient, '0x', {
    operation: 'speed-up', originalHash: cancel.hash!, fee: 9, historical: true,
  });
  assert.equal((await f.records.readExact(f.session, '7654321', wallet.address, historical.hash!))?.rawTransaction, historical.serialized);
  await assert.rejects(replay.prepare(historical.hash!), { code: 'CONTEXT_CHANGED' });
  const reprice = await f.append(0, 2, wallet.address, '0x', {
    operation: 'speed-up', originalHash: cancel.hash!, fee: 10, value: 0, gasLimit: 42000,
  });
  assert.equal(await witness(reprice.hash!), reprice.serialized);
  await assert.rejects(witness(cancel.hash!), /ORIGINAL_CHANGED/);
  assert.equal((await replay.prepare(reprice.hash!)).status, 'review');
  const repeatCancel = await f.append(0, 2, wallet.address, '0x', {
    operation: 'cancel', originalHash: reprice.hash!, fee: 12, gasLimit: 42000,
  });
  await assert.rejects(f.records.assertSpendingNonce(f.session, '7654321', wallet.address, 0), {
    name: 'EvmSignedRecordCancellationFence', recoveryHash: repeatCancel.hash,
  });
  await f.records.assertSpendingNonce(f.session, '7654321', wallet.address, 2);
  assert.equal((await replay.prepare(repeatCancel.hash!)).status, 'review');
  await assert.rejects(replay.prepare(original.hash!), { code: 'CONTEXT_CHANGED' });
});

test('reorg and cold reopen select predecessor by hash and replay exact bytes without signing', async () => {
  const f = await fixture(),
    first = await f.append(0),
    second = await f.append(1);
  await f.records.updatePhase(
    f.session,
    '7654321',
    wallet.address,
    first.hash!,
    'confirmed'
  );
  await f.records.updatePhase(
    f.session,
    '7654321',
    wallet.address,
    second.hash!,
    'submitted'
  );
  const reopened = f.create(),
    later = await reopened.prepare(second.hash!);
  assert.equal(later.status, 'review');
  if (later.status !== 'review') return;
  assert.equal(later.review.missingNonce, '0');
  assert.deepEqual(
    later.review.predecessors.map((v) => v.hash),
    [first.hash]
  );
  const before = f.bytes(),
    previous = await reopened.prepare(first.hash!);
  assert.equal(previous.status, 'review');
  if (previous.status !== 'review') return;
  assert.equal(previous.review.hash, first.hash);
  await reopened.confirm(previous.review.id);
  assert.deepEqual(f.dispatched, [first.serialized]);
  assert.equal(
    (await f.records.readExact(
      f.session,
      '7654321',
      wallet.address,
      second.hash!
    ))!.rawTransaction,
    second.serialized
  );
  f.nonce(2);
  for (const tx of [first, second])
    f.receipts.set(tx.hash!, {
      transactionHash: tx.hash,
      from: wallet.address,
      to: recipient,
      status: '0x1',
      blockNumber: '0xa',
      blockHash,
    });
  assert.equal((await reopened.prepare(second.hash!)).status, 'confirmed');
  assert.equal(f.dispatched.length, 1);
  assert.notEqual(f.bytes(), before);
});
for (const type of [0, 1, 2])
  test(`type ${type} contract creation and large calldata keep exact wire bytes`, async () => {
    const f = await fixture(),
      tx = await f.append(0, type, null, '0x' + '60'.repeat(10000)),
      replay = f.create();
    const result = await replay.prepare(tx.hash!);
    assert.equal(result.status, 'review');
    if (result.status !== 'review') return;
    assert.equal(result.review.to, null);
    assert.equal(result.review.dataBytes, 10000);
    assert.equal(result.review.accessListEntries, type === 1 ? 1 : 0);
    await replay.confirm(result.review.id);
    assert.equal(f.dispatched[0], tx.serialized);
  });
test('review cancellation is ID scoped, confirmation is one-use, and expiry prevents dispatch', async () => {
  const f = await fixture(),
    tx = await f.append(0),
    replay = f.create();
  let result = await replay.prepare(tx.hash!);
  if (result.status !== 'review') throw Error('review');
  replay.cancel('unrelated');
  await replay.confirm(result.review.id);
  await assert.rejects(replay.confirm(result.review.id), { code: 'EXPIRED' });
  assert.equal(f.dispatched.length, 1);
  result = await replay.prepare(tx.hash!);
  if (result.status !== 'review') throw Error('review');
  f.expire();
  await assert.rejects(replay.confirm(result.review.id), { code: 'EXPIRED' });
  assert.equal(f.dispatched.length, 1);
});
test('lost dispatch acknowledgement is unknown and exact bytes stay retained', async () => {
  const f = await fixture(),
    tx = await f.append(0),
    replay = f.create(),
    result = await replay.prepare(tx.hash!);
  if (result.status !== 'review') throw Error('review');
  f.lost();
  assert.deepEqual(await replay.confirm(result.review.id), {
    status: 'unknown',
    hash: tx.hash,
  });
  assert.equal(f.dispatched.length, 1);
  assert.equal(
    (await f.records.readExact(f.session, '7654321', wallet.address, tx.hash!))!
      .rawTransaction,
    tx.serialized
  );
});
test('canonical receipt identity and current chain are mandatory', async () => {
  const f = await fixture(),
    tx = await f.append(0);
  f.receipts.set(tx.hash!, {
    transactionHash: tx.hash,
    from: wallet.address,
    to: recipient,
    status: '0x1',
    blockNumber: '0xa',
    blockHash: '0x' + '44'.repeat(32),
  });
  await assert.rejects(f.create().prepare(tx.hash!));
  assert.equal(f.dispatched.length, 0);
  await assert.rejects(
    observeEvmTransaction(
      {
        hash: tx.hash!,
        from: wallet.address,
        to: recipient,
        chainId: '1',
        nonce: '0',
      },
      f.read,
      () => undefined
    )
  );
});

test('an old review cannot cancel a newer review, while matching cancellation revokes in-flight confirmation', async () => {
  const f = await fixture(),
    tx = await f.append(0),
    replay = f.create();
  const a = await replay.prepare(tx.hash!),
    b = await replay.prepare(tx.hash!);
  if (a.status !== 'review' || b.status !== 'review') throw Error('review');
  assert.notEqual(a.review.id, b.review.id);
  replay.cancel(a.review.id);
  const original = f.session.keyring.decryptPrivateRecord.bind(
    f.session.keyring
  );
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    started = new Promise<void>((resolve) => (entered = resolve));
  f.session.keyring.decryptPrivateRecord = async (args) => {
    entered();
    await gate;
    return original(args);
  };
  const work = replay.confirm(b.review.id);
  await started;
  replay.cancel(b.review.id);
  release();
  await assert.rejects(work, { code: 'CONTEXT_CHANGED' });
  assert.equal(f.dispatched.length, 0);
});
test('sender pages authenticate once and keep exact values without raw bytes in public projections', async () => {
  const f = await fixture();
  for (let n = 0; n < 4; n++) await f.append(n);
  const replay = f.create(),
    first = await replay.list({ maximum: 2 });
  assert.deepEqual(
    first.transactions.map((row) => row.nonce),
    [3, 2]
  );
  assert(first.nextCursor);
  const next = await replay.list({ maximum: 2, beforeHash: first.nextCursor });
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
  test(`a missing ${phase} outcome is revised before canceled or lost-ack review`, async () => {
    const f = await fixture(),
      tx = await f.append(0);
    await f.records.updatePhase(
      f.session,
      '7654321',
      wallet.address,
      tx.hash!,
      phase
    );
    const replay = f.create(),
      review = await replay.prepare(tx.hash!);
    if (review.status !== 'review') throw Error('review');
    replay.cancel(review.review.id);
    const reopened = f.create();
    assert.equal((await reopened.get(tx.hash!))!.phase, 'submitted');
    assert.equal(f.dispatched.length, 0);
    const retry = await reopened.prepare(tx.hash!);
    if (retry.status !== 'review') throw Error('review');
    f.lost();
    assert.equal((await reopened.confirm(retry.review.id)).status, 'unknown');
    assert.equal((await f.create().get(tx.hash!))!.phase, 'submitted');
    assert.equal(
      (await f.records.readExact(
        f.session,
        '7654321',
        wallet.address,
        tx.hash!
      ))!.rawTransaction,
      tx.serialized
    );
  });

for (const outcome of ['confirmed', 'reverted', 'nonce-consumed'] as const)
  test(`public ${outcome} observation matches its persisted transaction phase`, async () => {
    const f = await fixture(),
      tx = await f.append(0);
    if (outcome === 'nonce-consumed') f.nonce(1);
    else
      f.receipts.set(tx.hash!, {
        transactionHash: tx.hash,
        from: wallet.address,
        to: recipient,
        status: outcome === 'confirmed' ? '0x1' : '0x0',
        blockNumber: '0xa',
        blockHash,
      });
    const result = await f.create().prepare(tx.hash!);
    assert.equal(result.status, outcome);
    assert.equal(result.transaction.phase, outcome);
    assert.equal(
      (await f.records.readExact(
        f.session,
        '7654321',
        wallet.address,
        tx.hash!
      ))!.phase,
      outcome
    );
  });

for (const phase of ['confirmed', 'reverted', 'nonce-consumed'] as const)
  test(`shared observation without a replay review preserves ${phase} policy`, async () => {
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
    assert.equal(f.dispatched.length, 0);
    assert.equal((await f.create().get(tx.hash!))!.phase, phase);
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
  const pending = f.create().prepare(first.hash!);
  await held.started;
  try {
    const observed = await f.create().prepare(second.hash!);
    assert.equal(observed.status, 'nonce-consumed');
  } finally {
    held.release();
  }
  assert.equal((await pending).status, 'nonce-consumed');
  for (const tx of [first, second])
    assert.equal((await f.create().get(tx.hash!))!.phase, 'nonce-consumed');
});

for (const conflict of ['changed target phase', 'new same-nonce sibling'] as const)
  test(`terminal observation rejects a ${conflict}`, async () => {
    const f = await fixture();
    const tx = await f.append(0);
    f.nonce(1);
    const held = hold();
    f.beforeObservation(held.run);
    const pending = assert.rejects(f.create().prepare(tx.hash!), {
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
      (await f.create().get(tx.hash!))!.phase,
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

      await assert.rejects(f.create().prepare(cancellation.hash!), {
        code: 'CONTEXT_CHANGED',
      });
      assert.equal(reads, readNumber);
      assert.equal(f.bytes(), before);
      assert.deepEqual(f.dispatched, []);
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

  const denied = assert.rejects(f.create().prepare(cancellation.hash!), {
    code: 'CONTEXT_CHANGED',
  });
  await recheck.started;
  f.receipts.delete(cancellation.hash!);
  recheck.release();
  await denied;
  assert.equal(f.bytes(), before);
  assert.deepEqual(f.dispatched, []);

  f.receipts.set(cancellation.hash!, receipt);
  const confirmed = await f.create().prepare(cancellation.hash!);
  assert.equal(confirmed.status, 'confirmed');
  const read = (hash: string) =>
    f.records.readExact(f.session, '7654321', wallet.address, hash);
  const savedOriginal = await read(original.hash!);
  const savedCancellation = await read(cancellation.hash!);
  assert.equal(savedOriginal?.phase, 'nonce-consumed');
  assert.equal(savedOriginal?.rawTransaction, original.serialized);
  assert.equal(savedCancellation?.phase, 'confirmed');
  assert.equal(savedCancellation?.rawTransaction, cancellation.serialized);
  assert.deepEqual(f.dispatched, []);
});

test('a hung cancellation observation releases the journal at its deadline and discards a late canonical response', async (t) => {
  const { f, cancellation } = await minedCancellationFixture();
  const before = f.bytes(), recheck = hold();
  const lateResponse = Promise.withResolvers<void>();
  let observations = 0;
  f.beforeObservation(async () => {
    if (observations === 2) await recheck.run();
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const attempt = observeRetainedEvmTransaction(
    f.records,
    f.session,
    '7654321',
    wallet.address,
    cancellation.hash!,
    async (expected) => {
      const rechecking = ++observations === 2;
      const observed = await observeEvmTransaction(
        expected, f.read, f.session.assertCurrent
      );
      if (rechecking) {
        assert.equal(observed.status, 'mined');
        lateResponse.resolve();
      }
      return observed;
    },
    f.session.assertCurrent
  );
  const denied = assert.rejects(attempt, { code: 'CONTEXT_CHANGED' });
  await recheck.started;
  let released = false;
  const queued = f.records.validate(f.session).then(() => { released = true; });
  try {
    t.mock.timers.tick(11_999);
    await Promise.resolve();
    assert.equal(released, false);
    t.mock.timers.tick(1);
    await denied;
    await queued;
    assert.equal(released, true);
  } finally {
    recheck.release();
  }

  // A genuine late response may finish reading, but it no longer owns the write.
  await lateResponse.promise;
  await f.records.validate(f.session);
  assert.equal(f.bytes(), before);
  assert.deepEqual(f.dispatched, []);
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
  assert.equal(f.dispatched.length, 0);
});

test('queued revocation after retained helper resolves is checked again by replay prepare', async () => {
  const f = await fixture(), tx = await f.append(0);
  f.receipts.set(tx.hash!, {transactionHash:tx.hash,from:wallet.address,to:recipient,status:'0x1',blockNumber:'0xa',blockHash});
  const update = f.records.updateObservedPhase.bind(f.records);
  let armed=false, queued=false;
  f.records.updateObservedPhase=async (...args) => { const result=await update(...args);armed=true;return result; };
  const check=f.session.assertCurrent;
  f.session.assertCurrent=()=>{check();if(armed&&!queued){queued=true;queueMicrotask(()=>f.revoke());}};
  await assert.rejects(f.create().prepare(tx.hash!), /revoked/);
  assert.equal(queued,true);assert.equal(f.dispatched.length,0);
});
