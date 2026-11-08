import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePrivateDeposit } from '../src/custody/privateDeposit.ts';
import type { IPrivacyDepositReview } from '../../../source/utils/privacy/transactionTypes.ts';

const review = { intentId: 'first', noteId: 'note', poolId: 'eth-1' } as IPrivacyDepositReview;
function fixture() {
  const abort = new AbortController();
  let preparations = 0,
    submissions = 0,
    closed = 0,
    reads = 0,
    discarded = 0;
  let quote: (() => Promise<void>) | undefined;
  let discard: (() => Promise<void>) | undefined;
  let failure: Error | undefined;
  const model = new NativePrivateDeposit(
    {
      assertCurrent() {
        if (abort.signal.aborted) throw Error('cancelled');
      },
      transactions: {
        close() {
          closed++;
        },
        async discardDeposit() {
          discarded++;
          await discard?.();
        },
        async prepareDeposit() {
          preparations++;
          await quote?.();
          return { ...review, intentId: `quote-${preparations}` };
        },
        async submitDeposit(id) {
          submissions++;
          if (failure) throw failure;
          return {
            intentId: id,
            noteId: 'note',
            phase: 'submitted',
            transactionHash: '0x' + 'ab'.repeat(32),
          };
        },
      },
      async readStatus() {
        reads++;
        return { phase: 'verified' };
      },
      async close() {},
    },
    abort.signal
  );
  return {
    model,
    abort,
    counts: () => ({ preparations, submissions, closed, reads, discarded }),
    quote(fn: () => Promise<void>) {
      quote = fn;
    },
    discard(fn: () => Promise<void>) {
      discard = fn;
    },
    fail(error: Error) {
      failure = error;
    },
  };
}
function hold() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}

test('deposit requires explicit matching review and submits at most once', async () => {
  const f = fixture();
  await f.model.prepare({ poolId: 'eth-1' });
  await f.model.confirm('stale');
  assert.equal(f.counts().submissions, 0);
  const id = f.model.getSnapshot().review!.intentId;
  await Promise.all([f.model.confirm(id), f.model.confirm(id)]);
  assert.equal(f.counts().submissions, 1);
  await f.model.refresh();
  assert.equal(f.counts().reads, 1);
  assert.equal(f.counts().preparations, 1);
  assert.equal(f.model.getSnapshot().status?.phase, 'verified');
});

test('cancelled delayed preparation cannot revive a review', async () => {
  const f = fixture(),
    gate = hold();
  f.quote(() => gate.promise);
  const preparing = f.model.prepare({ poolId: 'eth-1' });
  f.abort.abort();
  gate.release();
  await preparing;
  assert.notEqual(f.model.getSnapshot().phase, 'review');
  assert.equal(f.counts().submissions, 0);
  assert.equal(f.counts().closed, 1);
});

test('refresh serializes held quote retirement and preserves the same note', async () => {
  const f = fixture(),
    gate = hold();
  await f.model.prepare({ poolId: 'eth-1' });
  f.discard(() => gate.promise);
  const refresh = f.model.refresh();
  await f.model.refresh();
  gate.release();
  await refresh;
  assert.equal(f.counts().preparations, 2);
  assert.equal(f.model.getSnapshot().review?.noteId, 'note');
});

test('proven unsigned expiry can be re-reviewed without treating provider text as public copy', async () => {
  const f = fixture();
  await f.model.prepare({ poolId: 'eth-1' });
  f.fail(
    Object.assign(new Error('privacy_deposit_intent_expired'), { transactionNotBroadcast: true })
  );
  await f.model.confirm(f.model.getSnapshot().review!.intentId);
  assert.equal(f.model.getSnapshot().error, 'expired');
  assert.equal(f.model.getSnapshot().phase, 'failed');
  await f.model.refresh();
  assert.equal(f.model.getSnapshot().phase, 'review');
});


test('changing amount retires only an earlier unsubmitted review', async () => {
  const f = fixture();
  await f.model.prepare({ poolId: 'eth-1' });
  await f.model.prepare({ poolId: 'eth-10' });
  assert.equal(f.counts().discarded, 1);
  await f.model.confirm(f.model.getSnapshot().review!.intentId);
  await f.model.prepare({ poolId: 'eth-1' });
  assert.equal(f.counts().discarded, 1);
});
