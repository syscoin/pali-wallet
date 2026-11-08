import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NativeGuardianRecoveryController,
  type NativeGuardianRecoveryStatus,
} from '../src/smartAccount/guardianRecovery.ts';
import type { NativeGuardianRecoveryIntent } from '../src/custody/walletCatalogue.ts';

const hash = '0x' + '11'.repeat(32);
const intent = { operation: { hash } } as NativeGuardianRecoveryIntent;
function fixture() {
  let status = {
    intent,
    observation: {},
    action: 'schedule',
    terminal: null,
    transactionHash: null,
    canAbandon: true,
  } as NativeGuardianRecoveryStatus;
  let preparations = 0,
    submissions = 0,
    reconciliations = 0,
    retirements = 0;
  let rejected: Error | null = null,
    reconciliationError: Error | null = null;
  let hold: Promise<void> | undefined;
  let unknownFailure = false;
  const parent = new AbortController();
  const controller = new NativeGuardianRecoveryController(
    {
      assertCurrent() {
        assert(!parent.signal.aborted);
      },
      dispose() {
        retirements++;
      },
      submissionFailure(error) {
        if (unknownFailure) return undefined;
        return {
          transactionNotBroadcast: !!(error as { knownRefusal?: boolean })
            ?.knownRefusal,
          signedTransactionHash: hash,
        };
      },
      async observe() {
        return status;
      },
      async prepare() {
        preparations++;
        await hold;
        return {
          transaction: {},
          maximumFeeUnits: '1',
          maximumTotalUnits: '1',
          coveredFeeUnits: '0',
          approval: null,
          expiresAtMonotonicMilliseconds: 100000,
          async submit(check: () => void, onBroadcast: (hash: string) => void) {
            submissions++;
            check();
            onBroadcast(hash);
            if (rejected) throw rejected;
            status = {
              ...status,
              action: null,
              canAbandon: false,
              transactionHash: hash,
            };
            return hash;
          },
        } as never;
      },
      async reconcile() {
        reconciliations++;
        if (reconciliationError) throw reconciliationError;
      },
      async abandon() {
        retirements++;
      },
    },
    parent.signal,
    () => 1
  );
  return {
    controller,
    parent,
    set(value: Partial<NativeGuardianRecoveryStatus>) {
      status = { ...status, ...value };
    },
    unknownFailure() { unknownFailure = true; },
    reject(error: Error) {
      rejected = error;
    },
    hold(value: Promise<void>) {
      hold = value;
    },
    failReconciliation(value: Error | null) {
      reconciliationError = value;
    },
    counts: () => ({ preparations, submissions, reconciliations, retirements }),
  };
}

test('a fee review requires explicit confirmation and cannot submit twice', async () => {
  const f = fixture();
  try {
    await f.controller.prepare();
    assert.equal(f.counts().preparations, 0);
    await f.controller.review();
    assert.equal(f.controller.getSnapshot().phase, 'review');
    const id = f.controller.getSnapshot().feeReview!.id;
    await f.controller.confirm(id);
    await f.controller.confirm(id);
    assert.equal(f.counts().submissions, 1);
    assert.equal(f.controller.getSnapshot().transactionHash, hash);
  } finally {
    f.controller.dispose();
  }
});

test('unknown submission retains its saved hash and does not re-sign while pending', async () => {
  const f = fixture();
  try {
    f.reject(new Error('network unavailable'));
    await f.controller.review();
    await f.controller.confirm(f.controller.getSnapshot().feeReview!.id);
    assert.equal(f.controller.getSnapshot().phase, 'unknown');
    assert.equal(f.controller.getSnapshot().transactionHash, hash);
    f.set({ transactionHash: hash, action: null, canAbandon: false });
    await f.controller.refresh();
    await f.controller.review();
    assert.equal(f.counts().preparations, 1);
    assert.equal(f.counts().submissions, 1);
  } finally {
    f.controller.dispose();
  }
});

test('a ready operation takes precedence over a retained schedule hash', async () => {
  const f = fixture();
  try {
    f.set({ action: 'finalize', transactionHash: hash });
    await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().phase, 'ready');
  } finally {
    f.controller.dispose();
  }
});

test('completed recovery preserves acknowledgement and retries only metadata', async () => {
  const f = fixture();
  try {
    f.set({
      terminal: 'executed',
      action: null,
      transactionHash: hash,
      canAbandon: false,
    });
    f.failReconciliation(new Error('storage unavailable'));
    await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().phase, 'complete');
    assert.equal(f.controller.getSnapshot().metadataRefresh, 'failed');
    f.failReconciliation(null);
    await f.controller.retryMetadata();
    assert.equal(f.controller.getSnapshot().metadataRefresh, 'complete');
    assert.equal(f.controller.getSnapshot().error, null);
    assert.equal(f.controller.getSnapshot().transactionHash, hash);
    assert.equal(f.counts().preparations, 0);
    assert.equal(f.counts().submissions, 0);
  } finally {
    f.controller.dispose();
  }
});

test('disposal during a held quote retires its host and cannot publish a review', async () => {
  const f = fixture();
  let release!: () => void;
  f.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const pending = f.controller.review();
  await new Promise((resolve) => setTimeout(resolve, 0));
  f.controller.dispose();
  release();
  await pending;
  assert.equal(f.controller.getSnapshot().feeReview, null);
  assert.equal(f.counts().retirements, 1);
});

test('provider error bodies never appear in the public recovery snapshot', async () => {
  const f = fixture();
  try {
    f.reject(new Error('private provider body '.repeat(5000)));
    await f.controller.review();
    await f.controller.confirm(f.controller.getSnapshot().feeReview!.id);
    assert(f.controller.getSnapshot().error!.length < 120);
    assert(!f.controller.getSnapshot().error!.includes('provider body'));
  } finally {
    f.controller.dispose();
  }
});

test('a proven submission refusal preserves the saved recovery route without a second signature', async () => {
  const f = fixture();
  try {
    f.reject(Object.assign(new Error('refused'), { knownRefusal: true }));
    await f.controller.review();
    await f.controller.confirm(f.controller.getSnapshot().feeReview!.id);
    assert.equal(f.controller.getSnapshot().phase, 'failed');
    assert.equal(f.controller.getSnapshot().transactionHash, hash);
    f.set({ transactionHash: hash, action: null, canAbandon: false });
    await f.controller.refresh();
    await f.controller.review();
    assert.equal(f.counts().submissions, 1);
    assert.equal(f.counts().preparations, 1);
  } finally {
    f.controller.dispose();
  }
});


test('an unrecognized SDK error after submission entry remains unknown', async () => {
  const f = fixture();
  f.unknownFailure();
  f.reject(new Error('unrecognized transport failure'));
  await f.controller.review();
  await f.controller.confirm(f.controller.getSnapshot().feeReview!.id);
  assert.equal(f.controller.getSnapshot().phase, 'unknown');
  assert.equal(f.counts().submissions, 1);
});

test('executed recovery with unreconciled metadata can clear only local tracking', async () => {
  const f = fixture();
  try {
    f.set({
      terminal: 'executed',
      action: null,
      transactionHash: hash,
      canAbandon: true,
    });
    f.failReconciliation(new Error('Recovery metadata has not caught up'));
    await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().phase, 'complete');
    assert.equal(f.controller.getSnapshot().metadataRefresh, 'failed');
    assert.equal(f.controller.getSnapshot().canAbandon, true);
    await f.controller.abandon();
    assert.equal(f.controller.getSnapshot().phase, 'cleared');
    assert.equal(f.counts().preparations, 0);
    assert.equal(f.counts().submissions, 0);
    assert.equal(f.counts().reconciliations, 1);
  } finally {
    f.controller.dispose();
  }
});
