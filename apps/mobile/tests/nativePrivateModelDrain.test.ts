import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePrivateDeposit } from '../src/custody/privateDeposit.ts';
import { NativePrivateWithdrawal } from '../src/custody/privateWithdrawal.ts';
import type { IPrivacyDepositReview } from '../../../source/utils/privacy/transactionTypes.ts';
import type { IPrivacyWithdrawalReview } from '../../../source/utils/privacy/withdrawTypes.ts';

type Operation =
  | 'prepare'
  | 'confirm'
  | 'refresh'
  | 'loadRelayers'
  | 'reviewRestored';
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function fixture(kind: 'deposit' | 'withdrawal') {
  const events: string[] = [];
  const hooks: Partial<
    Record<Operation | 'cleanup' | 'retire', () => Promise<void> | void>
  > = {};
  const run = async (operation: Operation | 'cleanup') => {
    events.push(operation);
    await hooks[operation]?.();
  };
  const retire = () => {
    events.push('retire');
    hooks.retire?.();
  };
  const result = {
    intentId: 'review',
    noteId: 'note',
    phase: 'submitted' as const,
    transactionHash: '0x' + 'ab'.repeat(32),
  };
  const submit = async () => {
    await run('confirm');
    events.push('ack');
    return result;
  };
  const signal = new AbortController().signal;
  if (kind === 'deposit') {
    const model = new NativePrivateDeposit(
      {
        assertCurrent() {},
        transactions: {
          close: retire,
          async discardDeposit() {},
          async prepareDeposit() {
            await run('prepare');
            return {
              intentId: 'review',
              noteId: 'note',
              poolId: 'eth-1',
            } as IPrivacyDepositReview;
          },
          submitDeposit: submit,
        },
        async readStatus() {
          await run('refresh');
          return { phase: 'verified' };
        },
        close: () => run('cleanup'),
      },
      signal
    );
    return {
      model,
      events,
      hooks,
      actions: {
        prepare: () => model.prepare({ poolId: 'eth-1' }),
        confirm: () => model.confirm('review'),
        refresh: () => model.refresh(),
      } as Partial<Record<Operation, () => Promise<void>>>,
    };
  }
  const model = new NativePrivateWithdrawal(
    {
      assertCurrent() {},
      canSign: true,
      restored: true,
      noteId: 'note',
      poolId: 'eth-1',
      createWithdrawals() {
        return {
          close: retire,
          cancelPreparation() {},
          async discardWithdrawal() {},
          async prepareWithdrawal() {
            await run('prepare');
            return {
              intentId: 'review',
              noteId: 'note',
              poolId: 'eth-1',
            } as IPrivacyWithdrawalReview;
          },
          submitWithdrawal: submit,
          async statusByNote() {
            return { noteId: 'note', phase: 'none' };
          },
          async getRelayers() {
            await run('loadRelayers');
            return [];
          },
        };
      },
      async readNoteStatus() {
        await run('refresh');
        return { phase: 'verified' };
      },
      reviewRestored: () => run('reviewRestored'),
      close: () => run('cleanup'),
    },
    signal
  );
  return {
    model,
    events,
    hooks,
    actions: {
      prepare: () => model.prepare({ recipient: 'recipient', mode: 'direct' }),
      confirm: () => model.confirm('review'),
      refresh: () => model.refresh(),
      loadRelayers: () => model.loadRelayers(),
      reviewRestored: () => model.reviewRestored('password'),
    } as Partial<Record<Operation, () => Promise<void>>>,
  };
}

for (const kind of ['deposit', 'withdrawal'] as const) {
  const operations: Operation[] =
    kind === 'deposit'
      ? ['prepare', 'confirm', 'refresh']
      : ['prepare', 'confirm', 'refresh', 'loadRelayers', 'reviewRestored'];
  for (const operation of operations) {
    test(`${kind} disposal drains ${operation} and concurrent host cleanup`, async () => {
      const f = fixture(kind);
      if (
        operation === 'confirm' ||
        (operation === 'refresh' && kind === 'deposit')
      )
        await f.actions.prepare!();
      if (operation === 'refresh' && kind === 'deposit')
        await f.actions.confirm!();
      const entered = gate(),
        work = gate(),
        cleanup = gate();
      f.hooks[operation] = async () => {
        entered.release();
        await work.promise;
      };
      f.hooks.cleanup = () => cleanup.promise;
      const active = f.actions[operation]!();
      await entered.promise;
      let publications = 0;
      f.model.subscribe(() => {
        publications++;
      });
      const closing = f.model.dispose();
      assert.equal(f.model.dispose(), closing);
      assert(f.events.includes('retire'));
      assert(f.events.includes('cleanup'));
      let closed = false;
      void closing.then(() => {
        closed = true;
      });
      await Promise.resolve();
      assert.equal(closed, false);
      cleanup.release();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(closed, false);
      work.release();
      await Promise.all([active, closing]);
      assert.equal(publications, 0);
      assert.equal(f.events.filter((event) => event === 'cleanup').length, 1);
      if (operation === 'confirm') assert.equal(f.events.at(-1), 'ack');
    });
  }

  test(`${kind} cleanup failure still waits for active work to settle`, async () => {
    const f = fixture(kind),
      entered = gate(),
      work = gate();
    f.hooks.prepare = async () => {
      entered.release();
      await work.promise;
    };
    f.hooks.cleanup = () => {
      throw new Error('cleanup failed');
    };
    const preparing = f.actions.prepare!();
    await entered.promise;
    let settled = false;
    const closing = f.model.dispose();
    void closing.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, false);
    work.release();
    await preparing;
    await assert.rejects(closing, /cleanup failed/);
  });

  test(`${kind} synchronous retirement failure cannot skip host cleanup`, async () => {
    const f = fixture(kind);
    f.hooks.retire = () => {
      throw new Error('retirement failed');
    };
    await assert.rejects(f.model.dispose(), /retirement failed/);
    assert(f.events.includes('cleanup'));
  });

  test(`${kind} disposal during publication never enters host work or awaits itself`, async () => {
    const f = fixture(kind);
    let closing: Promise<void> | undefined;
    f.model.subscribe(() => {
      closing ??= f.model.dispose();
    });
    await f.actions.prepare!();
    await closing;
    assert.equal(f.events.includes('prepare'), false);
    assert.equal(f.events.filter((event) => event === 'cleanup').length, 1);
  });
}

test('unsubmitted deposit refresh drains its delegated preparation without a self-cycle', async () => {
  const f = fixture('deposit');
  await f.actions.prepare!();
  const entered = gate(),
    work = gate();
  f.hooks.prepare = async () => {
    entered.release();
    await work.promise;
  };
  const refresh = f.actions.refresh!();
  await entered.promise;
  const closing = f.model.dispose();
  work.release();
  await Promise.all([refresh, closing]);
});
