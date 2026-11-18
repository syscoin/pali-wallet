import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePrivateWithdrawal } from '../src/custody/privateWithdrawal.ts';
import type { IPrivateNoteStatus } from '../../../source/utils/privacy/privateVaultTypes.ts';
import type {
  IPrivacyWithdrawalReview,
  IPrivacyWithdrawalStatus,
} from '../../../source/utils/privacy/withdrawTypes.ts';

const review = {
  intentId: 'review',
  noteId: 'owned-note',
  poolId: 'eth-1',
} as IPrivacyWithdrawalReview;
function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function fixture(canSign = true) {
  const owner = new AbortController();
  let prepares = 0,
    submits = 0,
    disposals = 0,
    discarded = 0,
    reads = 0;
  let failure: unknown;
  let retired = false;
  let afterSubmit: (() => void) | undefined;
  let delay: Promise<void> | undefined;
  let status: IPrivacyWithdrawalStatus = {
    noteId: 'owned-note',
    phase: 'none',
  };
  let noteStatus:IPrivateNoteStatus={phase:'verified'};
  const requests: unknown[] = [];
  const approvals: unknown[] = [];
  const model = new NativePrivateWithdrawal(
    {
      canSign,
      noteId: 'owned-note',
      poolId: 'eth-1',
      assertCurrent() {
        if (owner.signal.aborted || retired) throw new Error('retired');
      },
      createWithdrawals(onProgress) {
        return {
          close() {
            disposals++;
          },
          cancelPreparation() {},
          async discardWithdrawal() {
            discarded++;
          },
          async prepareWithdrawal(request) {
            requests.push(request);
            prepares++;
            onProgress({ stage: 'proving' });
            await delay;
            if (failure) throw failure;
            return { ...review, intentId: `review-${prepares}` };
          },
          async submitWithdrawal(intentId, approval) {
            approvals.push({ intentId, approval });
            submits++;
            afterSubmit?.();
            if (failure) throw failure;
            return {
              intentId,
              noteId: 'owned-note',
              phase: 'submitted',
              transactionHash: '0x' + 'ab'.repeat(32),
            };
          },
          async statusByNote() {
            return status;
          },
          async getRelayers() {
            return [
              {
                id: 'relayer',
                name: 'Service',
                health: 'reported-healthy',
                supportedPools: ['eth-1'],
              },
              {
                id: 'unsupported',
                name: 'Other pool',
                health: 'reported-healthy',
                supportedPools: ['eth-10'],
              },
            ];
          },
        };
      },
      async readNoteStatus() {
        reads++;
        await delay;
        return noteStatus;
      },
      async close() {},
    },
    owner.signal
  );
  return {
    model,
    owner,
    requests,
    approvals,
    counts: () => ({ prepares, submits, disposals, discarded, reads }),
    retireAfterSubmit() {
      afterSubmit = () => {
        retired = true;
      };
    },
    fail(error: unknown) {
      failure = error;
    },
    hold(promise: Promise<void>) {
      delay = promise;
    },
    poolStatus(next:IPrivateNoteStatus){noteStatus=next;},
    status(next: IPrivacyWithdrawalStatus) {
      status = next;
    },
  };
}

test('withdrawal model binds its note and requires one matching explicit confirmation', async () => {
  const f = fixture();
  await f.model.prepare({ recipient: 'recipient', mode: 'direct' });
  assert.deepEqual(f.requests, [
    { recipient: 'recipient', mode: 'direct', noteId: 'owned-note' },
  ]);
  await f.model.confirm('stale');
  assert.equal(f.counts().submits, 0);
  await Promise.all([f.model.confirm('review-1'), f.model.confirm('review-1')]);
  assert.equal(f.counts().submits, 1);
  assert.deepEqual(f.approvals, [{intentId:'review-1', approval:{acceptPreviousWithdrawalRisk:true}}]);
  assert.equal(f.model.getSnapshot().phase, 'submitted');
});

test('cancelled proof preparation cannot revive its review or submit', async () => {
  const f = fixture(),
    gate = held();
  f.hold(gate.promise);
  const preparing = f.model.prepare({ recipient: 'recipient', mode: 'direct' });
  assert.equal(f.model.getSnapshot().progress?.stage, 'proving');
  f.owner.abort();
  gate.release();
  await preparing;
  assert.notEqual(f.model.getSnapshot().phase, 'review');
  assert.equal(f.counts().submits, 0);
  assert.equal(f.counts().disposals, 1);
});

test('new preparation discards only its previous unsubmitted review', async () => {
  const f = fixture();
  await f.model.prepare({ recipient: 'first', mode: 'direct' });
  await f.model.prepare({ recipient: 'second', mode: 'direct' });
  assert.equal(f.counts().discarded, 1);
  assert.equal(f.model.getSnapshot().review?.intentId, 'review-2');
});

test('status refresh discards an unsigned quote and preserves existing journal status', async () => {
  const f = fixture();
  await f.model.prepare({ recipient: 'recipient', mode: 'direct' });
  f.status({
    noteId: 'owned-note',
    phase: 'unknown',
    transactionHash: '0x' + 'bc'.repeat(32),
  });
  await f.model.refresh();
  assert.equal(f.counts().discarded, 1);
  assert.equal(f.model.getSnapshot().review, null);
  assert.equal(f.model.getSnapshot().status?.phase, 'unknown');
  assert.equal(f.counts().submits, 0);
});

test('an unclassified submit failure stays unknown and exposes no provider message', async () => {
  const f = fixture();
  await f.model.prepare({ recipient: 'recipient', mode: 'direct' });
  f.fail(new Error('private provider secret body'));
  await f.model.confirm('review-1');
  assert.equal(f.model.getSnapshot().phase, 'unknown');
  assert.equal(f.model.getSnapshot().result?.noteId, 'owned-note');
  assert.equal(JSON.stringify(f.model.getSnapshot()).includes('secret'), false);
});

test('proven unsigned expiry is a failed review requiring a new preparation', async () => {
  const f = fixture();
  await f.model.prepare({ recipient: 'recipient', mode: 'direct' });
  f.fail(
    Object.assign(new Error('privacy_withdrawal_intent_expired'), {
      transactionNotBroadcast: true,
    })
  );
  await f.model.confirm('review-1');
  assert.equal(f.model.getSnapshot().phase, 'failed');
  assert.equal(f.model.getSnapshot().error, 'expired');
});

test('watch-only model can prepare relayed mode but cannot invoke direct mode', async () => {
  const f = fixture(false);
  await f.model.prepare({ recipient: 'recipient', mode: 'direct' });
  assert.equal(f.counts().prepares, 0);
  await f.model.prepare({
    recipient: 'recipient',
    mode: 'relayed',
    relayerId: 'relayer',
  });
  assert.equal(f.counts().prepares, 1);
});

test('status and directory reads remain serialized without an extra restoration action', async () => {
  const f = fixture(true),
    gate = held();
  f.hold(gate.promise);
  const reading = f.model.refresh();
  assert.equal(f.model.getSnapshot().checking, true);
  await f.model.loadRelayers();
  assert.equal(f.model.getSnapshot().relayers.length, 0);
  gate.release();
  await reading;
  await f.model.loadRelayers();
  assert.equal(f.model.getSnapshot().relayers.length, 1);
  assert.equal(f.model.getSnapshot().checking, false);
});

test('late owner retirement preserves an acknowledged transaction hash for recovery', async () => {
  const f = fixture();
  await f.model.prepare({ recipient: 'recipient', mode: 'direct' });
  f.retireAfterSubmit();
  await f.model.confirm('review-1');
  assert.equal(f.model.getSnapshot().phase, 'unknown');
  assert.equal(
    f.model.getSnapshot().result?.transactionHash,
    '0x' + 'ab'.repeat(32)
  );
});


test('a saved prior attempt remains visible while a new owned intent prepares and confirms separately', async () => {
  const f = fixture();
  const previous = {noteId:'owned-note',phase:'unknown' as const,transactionHash:'0x'+'bc'.repeat(32)};
  f.status(previous); await f.model.refresh();
  await f.model.prepare({recipient:'new-recipient',mode:'direct'});
  assert.equal(f.model.getSnapshot().phase,'review');
  assert.deepEqual(f.model.getSnapshot().status,previous);
  assert.equal(f.model.getSnapshot().result,null);
  assert.equal(f.counts().submits,0);
  await f.model.confirm('review-1');
  assert.deepEqual(f.approvals,[{intentId:'review-1',approval:{acceptPreviousWithdrawalRisk:true}}]);
  assert.equal(f.model.getSnapshot().result?.transactionHash,'0x'+'ab'.repeat(32));
  assert.equal(f.model.getSnapshot().status,null,'Confirm retires the old observed attempt');
  const refreshed={noteId:'owned-note',phase:'submitted' as const,transactionHash:'0x'+'de'.repeat(32)};
  f.status(refreshed);await f.model.refresh();
  assert.deepEqual(f.model.getSnapshot().status,refreshed);
  assert.equal(f.model.getSnapshot().result?.transactionHash,'0x'+'ab'.repeat(32));
});


test('fresh spent status retires the review and prevents another proof or stale confirmation', async()=>{
  const f=fixture();
  await f.model.prepare({recipient:'recipient',mode:'direct'});
  f.poolStatus({phase:'spent'}); await f.model.refresh();
  await f.model.confirm('review-1');
  await f.model.prepare({recipient:'recipient',mode:'direct'});
  assert.equal(f.counts().prepares,1); assert.equal(f.counts().submits,0);
  assert.equal(f.model.getSnapshot().review,null);
});
