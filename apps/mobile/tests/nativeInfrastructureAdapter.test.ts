import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import {
  PALI_CREATE2_DEPLOYER_MIN_RUNTIME_BYTE_LENGTH,
  PALI_INFRASTRUCTURE_METADATA,
} from '../../../source/utils/smartAccount/deploymentMetadata.ts';
import { projectSmartAccountInfrastructureObservation } from '../../../source/utils/smartAccount/infrastructureObservation.ts';
import { createNativeInfrastructure, type NativeInfrastructureOwner } from '../src/custody/nativeInfrastructure.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import type { NativeInfrastructurePending } from '../src/custody/walletCatalogue.ts';

const payer = '0x1111111111111111111111111111111111111111';
const attemptId = `0x${'12'.repeat(32)}`;
const differentAttemptId = `0x${'34'.repeat(32)}`;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

/** Exercise the actual private adapter with constructor-trusted ports, without claiming SDK signing coverage. */
function fixture(error: Error, enterSigner: boolean) {
  const lifetime = new AbortController();
  const network = getNativeNetwork('ethereum');
  const observation = projectSmartAccountInfrastructureObservation(Number(network.chainId), [
    `0x${'01'.repeat(PALI_CREATE2_DEPLOYER_MIN_RUNTIME_BYTE_LENGTH)}`,
    ...PALI_INFRASTRUCTURE_METADATA.map(() => '0x'),
  ]);
  assert(observation);
  let pending: NativeInfrastructurePending | undefined;
  let quotes = 0, submitted = 0, signerEntries = 0;
  let preparedAttemptId: string | undefined;
  let admission: { attemptId: string; pending: NativeInfrastructurePending | null } | null = null;
  let afterReservation = async (_pending: NativeInfrastructurePending) => {};
  const tracked = new Set<Promise<unknown>>();
  const events: string[] = [];
  const reservations: NativeInfrastructurePending[] = [];
  const cleanupRequests: string[] = [];
  const owner: NativeInfrastructureOwner = {
    network,
    payer: { id: 'hd:60:0', label: 'Fee payer', address: payer, xpub: 'public-owner-reference' },
    admit<T>(work: () => Promise<T>): Promise<T> {
      assert(!admission, 'one owned confirmation at a time');
      assert(preparedAttemptId);
      const admitted = { attemptId: preparedAttemptId, pending: null as NativeInfrastructurePending | null };
      admission = admitted;
      events.push('admit');
      const task = Promise.resolve().then(work).finally(() => {
        if (admission === admitted) admission = null;
        tracked.delete(task);
      });
      // Admission is visible synchronously, before the first work await.
      tracked.add(task);
      return task;
    },
    async settleUnsent(id) {
      cleanupRequests.push(id);
      assert(admission && admission.attemptId === id, 'cleanup requires the original admitted attempt');
      if (!pending) return;
      assert(admission.pending, 'cleanup requires its captured durable reservation');
      assert.equal(pending.entry.attemptId, id, 'never clear a newer attempt');
      assert.deepEqual(pending, admission.pending, 'never clear changed ownership or transaction data');
      // This fixed-store cleanup deliberately outlives the retired view. It
      // represents the private exact-lease port, not current signing authority.
      pending = undefined;
      events.push('clear');
    },
    assertCurrent() { assert(!lifetime.signal.aborted, 'Owner retired'); },
    pending() { return pending; },
    async commit(next, expectedAttemptId) {
      assert.equal(expectedAttemptId, pending?.entry.attemptId ?? null);
      if (next && expectedAttemptId === null) {
        assert(admission && admission.attemptId === next.entry.attemptId);
        admission.pending = next;
      }
      events.push(next ? 'reserve' : 'clear');
      if (next) reservations.push(next);
      pending = next ?? undefined;
      if (next) await afterReservation(next);
    },
    async observe() { events.push('observe'); return observation; },
    async readReceipt() { events.push('receipt'); return null; },
    async readLatestNonce() { events.push('nonce'); return '0x7'; },
    async prepare(request, _signal, validateAuthority, deployment) {
      preparedAttemptId = deployment.attemptId;
      quotes++;
      events.push('quote');
      assert.equal(Object.hasOwn(request, 'nonce'), false, 'the existing planner owns automatic nonce selection');
      const transaction = snapshotPreparedEvmTransaction({
        ...request, chainId: network.chainId, nonce: '7', value: '0',
        gasLimit: '100000', type: 2, maxFeePerGas: '2', maxPriorityFeePerGas: '1', accessList: [],
      });
      return Object.freeze({
        transaction,
        feeComparison: { recommendationOnly: false },
        maximumFeeUnits: '200000', coveredFeeUnits: '0', maximumTotalUnits: '200000', approval: null,
        expiresAtMonotonicMilliseconds: performance.now() + 60000,
        async submit(assertCurrent: () => void) {
          submitted++;
          events.push('prepared-submit');
          assertCurrent();
          assert(pending, 'reservation must exist before shared prepared submission starts');
          assert.equal(pending.entry.nonce, 7, 'reservation uses the actual prepared transaction nonce');
          if (enterSigner) {
            await validateAuthority();
            signerEntries++;
          }
          throw error;
        },
      });
    },
    randomId: () => attemptId,
    submissionFailure: () => undefined,
  };
  const controller = createNativeInfrastructure().open(owner, lifetime.signal);
  return {
    controller, events, reservations, cleanupRequests, lifetime,
    get pending() { return pending; },
    get pendingWork() { return tracked.size; },
    get counts() { return { quotes, submitted, signerEntries }; },
    setAfterReservation(hook: typeof afterReservation) { afterReservation = hook; },
    replacePending(next: NativeInfrastructurePending) { pending = next; },
    review: () => controller.reviewNext(controller.getSnapshot().revision),
    refresh: () => controller.refresh(controller.getSnapshot().revision),
    confirm: () => controller.confirm(controller.getSnapshot().feeReview!.id),
  };
}

for (const message of ['Reviewed fee changed', 'Review expired']) {
  test(`private adapter releases the exact unsent reservation after prepared revalidation rejects: ${message}`, async () => {
    const f = fixture(new Error(message), false);
    try {
      await f.review();
      assert.equal(f.counts.submitted, 0);
      assert.equal(f.pending, undefined);
      await f.confirm();
      assert.equal(f.counts.submitted, 1);
      assert.equal(f.counts.signerEntries, 0);
      assert.equal(f.reservations.length, 1);
      assert.equal(f.reservations[0]!.entry.attemptId, attemptId);
      assert.equal(f.reservations[0]!.entry.nonce, 7);
      assert.equal(f.pending, undefined, 'a proven pre-sign refusal must not leave a durable unknown attempt');
      assert.equal(f.controller.getSnapshot().phase, 'failed', 'a proven unsent refusal is not an unknown submission');
      assert.equal(f.controller.getSnapshot().status?.pending, null, 'do not invent a phantom pending transaction');
      assert.equal(f.pendingWork, 0);
      assert.deepEqual(f.cleanupRequests, [attemptId]);
      assert.deepEqual(f.events.slice(-3), ['reserve', 'prepared-submit', 'clear']);
      await f.refresh();
      assert.equal(f.controller.getSnapshot().phase, 'ready');
      assert.equal(f.counts.submitted, 1);
      await f.review();
      assert.equal(f.counts.quotes, 2, 'the same live scope can explicitly review a fresh quote');
      assert.equal(f.counts.submitted, 1, 'fresh review does not authorize another submission');
    } finally { f.controller.dispose(); }
  });
}

test('private adapter retains an unclassified failure after private signer entry and never blindly re-quotes', async () => {
  const f = fixture(new Error('Unknown signing/submission outcome'), true);
  try {
    await f.review();
    await f.confirm();
    assert.equal(f.counts.signerEntries, 1);
    assert.equal(f.counts.submitted, 1);
    assert.equal(f.pending?.entry.attemptId, attemptId);
    assert.equal(f.pending?.entry.nonce, 7);
    assert.equal(f.pending?.entry.transactionHash, undefined);
    assert.deepEqual(f.cleanupRequests, []);
    assert.equal(f.pendingWork, 0);
    assert.equal(f.events.includes('clear'), false);
    await f.review();
    assert.equal(f.counts.quotes, 1);
    await f.refresh();
    assert.equal(f.controller.getSnapshot().phase, 'pending');
    assert.equal(f.pending?.entry.attemptId, attemptId);
    await f.review();
    assert.equal(f.counts.quotes, 1);
    assert.equal(f.counts.submitted, 1);
  } finally { f.controller.dispose(); }
});

test('view retirement after a durable reservation drains exact unsent cleanup before any prepared submission', async () => {
  const f = fixture(new Error('must not reach prepared submission'), true);
  const reserved = deferred(), release = deferred();
  f.setAfterReservation(async () => { reserved.resolve(); await release.promise; });
  try {
    await f.review();
    const confirming = f.confirm();
    assert.equal(f.pendingWork, 1, 'the confirmation span is owned before its first await');
    await reserved.promise;
    assert.equal(f.pending?.entry.attemptId, attemptId);
    f.lifetime.abort();
    release.resolve();
    await confirming;
    assert.equal(f.counts.submitted, 0);
    assert.equal(f.counts.signerEntries, 0);
    assert.equal(f.pending, undefined);
    assert.deepEqual(f.cleanupRequests, [attemptId]);
    assert.equal(f.pendingWork, 0);
    assert.equal(f.controller.getSnapshot().feeReview, null);
  } finally { release.resolve(); f.controller.dispose(); }
});

for (const change of ['new attempt', 'changed same attempt'] as const) {
  test(`retired unsent cleanup cannot erase a ${change}`, async () => {
    const f = fixture(new Error('must not reach prepared submission'), true);
    const reserved = deferred(), release = deferred();
    f.setAfterReservation(async () => { reserved.resolve(); await release.promise; });
    try {
      await f.review();
      const confirming = f.confirm();
      await reserved.promise;
      assert(f.pending);
      const replacement: NativeInfrastructurePending = Object.freeze({
        ...f.pending,
        entry: Object.freeze({ ...f.pending.entry,
          ...(change === 'new attempt' ? { attemptId: differentAttemptId } : { nonce: 8 }),
        }),
      });
      f.replacePending(replacement);
      f.lifetime.abort();
      release.resolve();
      await confirming;
      assert.equal(f.counts.submitted, 0);
      assert.equal(f.counts.signerEntries, 0);
      assert.equal(f.pending, replacement);
      assert.equal(f.events.includes('clear'), false);
      assert.deepEqual(f.cleanupRequests, [attemptId], 'retirement only asks to settle its original admission');
      assert.equal(f.pendingWork, 0);
    } finally { release.resolve(); f.controller.dispose(); }
  });
}
