import type { EvmDappPreparedQuote } from './evmDappPreparation';
import {
  prepareAndSubmitEvmDappReview,
  prepareEvmDappReview,
  type EvmDappReview,
  type EvmDappReviewPorts,
} from './evmDappReview';

const from = `0x${'11'.repeat(20)}`;
const to = `0x${'22'.repeat(20)}`;
const hash = `0x${'ab'.repeat(32)}`;
const request = { from, to, value: '0x0', data: '0x1234' };

function fixture() {
  const abort = new AbortController();
  let current = true;
  let now = 10;
  let changed = false;
  let atSend: (() => void) | undefined;
  const check = () => {
    if (!current) throw new Error('retired');
  };
  const prepare = jest.fn(async (_input, guard, _nonceContext, _approved) => {
    void _nonceContext;
    void _approved;
    guard();
    const transaction = {
      from,
      to,
      chainId: '1',
      nonce: '3',
      value: '0',
      data: '0x1234',
      gasLimit: changed ? '42000' : '21000',
      type: 2 as const,
      accessList: [],
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    };
    return Object.freeze({
      balanceUnits: '1000000000000000000',
      coveredFeeUnits: '0',
      maximumFeeUnits: (BigInt(transaction.gasLimit) * BigInt(3)).toString(),
      maximumTotalUnits: (BigInt(transaction.gasLimit) * BigInt(3)).toString(),
      expiresAtMonotonicMilliseconds: 90010,
      feeComparison: { recommendationOnly: true },
      transaction,
    }) satisfies EvmDappPreparedQuote;
  });
  const send = jest.fn(async (_transaction, guard, refresh, onBroadcast) => {
    atSend?.();
    await refresh('dispatch', guard);
    guard();
    onBroadcast(hash);
    return hash;
  });
  const ports: EvmDappReviewPorts<string, string> = {
    assertCurrent: check,
    chainId: '1',
    nonceContext: 'review',
    now: () => now,
    prepare,
    scope: 'selected-wallet-network',
    send,
    signal: abort.signal,
  };
  const onBroadcast = jest.fn();
  const immediate = (onPrepared: (review: EvmDappReview<string>) => void) =>
    prepareAndSubmitEvmDappReview(request, ports, {
      assertCurrent: check,
      onBroadcast,
      onPrepared,
      submission: { kind: 'transaction' },
    });
  return {
    abort,
    check,
    immediate,
    onBroadcast,
    ports,
    prepare,
    send,
    growEstimate() {
      changed = true;
    },
    retire() {
      current = false;
    },
    expire() {
      now = 90010;
    },
    atSend(callback: () => void) {
      atSend = callback;
    },
  };
}

describe('immediate owned EVM submission', () => {
  test('a display-only quote never grants the immediate admission shortcut', async () => {
    const f = fixture();
    const display = await f.prepare(request, f.check, 'review', undefined);
    f.prepare.mockClear();
    const prepareDisplay = jest.fn(async () => display);
    await expect(
      prepareAndSubmitEvmDappReview(
        request,
        {
          ...f.ports,
          prepareDisplay,
        },
        {
          assertCurrent: f.check,
          onBroadcast: f.onBroadcast,
          onPrepared: () => expect(f.prepare).not.toHaveBeenCalled(),
          submission: { kind: 'transaction' },
        }
      )
    ).resolves.toBe(hash);
    expect(prepareDisplay).toHaveBeenCalledTimes(1);
    expect(f.prepare.mock.calls.map((call) => call[2])).toEqual([
      'review',
      'dispatch',
    ]);
  });
  test('prepares once before entering send and retains the later dispatch refresh', async () => {
    const f = fixture();
    let admitted: EvmDappReview<string> | undefined;
    f.atSend(() => expect(f.prepare).toHaveBeenCalledTimes(1));
    await expect(
      f.immediate((review) => {
        expect(f.prepare).toHaveBeenCalledTimes(1);
        expect(f.send).not.toHaveBeenCalled();
        expect(review.maximumFeeUnits).toBe('63000');
        admitted = review;
      })
    ).resolves.toBe(hash);
    expect(f.prepare).toHaveBeenCalledTimes(2);
    expect(f.prepare.mock.calls[0][2]).toBe('review');
    expect(f.prepare.mock.calls[0][3]).toBeUndefined();
    expect(f.prepare.mock.calls[1][2]).toBe('dispatch');
    expect(f.prepare.mock.calls[1][3]).toBeDefined();
    expect(f.onBroadcast).toHaveBeenCalledWith(hash);
    await expect(
      admitted!.submit(f.check, f.onBroadcast, { kind: 'transaction' })
    ).rejects.toThrow('REVIEW_REQUIRED');
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  test('ordinary deferred reviews still refresh before entering send', async () => {
    const f = fixture();
    const review = await prepareEvmDappReview(request, f.ports);
    f.atSend(() => expect(f.prepare).toHaveBeenCalledTimes(2));
    await expect(
      review.submit(f.check, f.onBroadcast, { kind: 'transaction' })
    ).resolves.toBe(hash);
    expect(f.prepare).toHaveBeenCalledTimes(3);
  });

  test('rejects an asynchronous admission callback before send', async () => {
    const f = fixture();
    await expect(f.immediate(async () => undefined)).rejects.toThrow(
      'guard must be synchronous'
    );
    expect(f.send).not.toHaveBeenCalled();
    expect(f.onBroadcast).not.toHaveBeenCalled();
  });

  test('rejects a changed fee ceiling in synchronous host admission', async () => {
    const f = fixture();
    await expect(
      f.immediate((review) => {
        if (BigInt(review.maximumFeeUnits) > BigInt(50000))
          throw new Error('REVIEW_REQUIRED');
      })
    ).rejects.toThrow('REVIEW_REQUIRED');
    expect(f.send).not.toHaveBeenCalled();
  });

  test.each(['cancel', 'retire', 'expire'] as const)(
    'rechecks %s after synchronous admission before send',
    async (change) => {
      const f = fixture();
      await expect(
        f.immediate(() => {
          if (change === 'cancel') f.abort.abort();
          if (change === 'retire') f.retire();
          if (change === 'expire') f.expire();
        })
      ).rejects.toThrow();
      expect(f.send).not.toHaveBeenCalled();
      expect(f.onBroadcast).not.toHaveBeenCalled();
    }
  );

  test('refuses fee drift at the later dispatch boundary', async () => {
    const f = fixture();
    f.atSend(() => f.growEstimate());
    await expect(f.immediate(() => undefined)).rejects.toThrow(
      'EVM fee approval changed'
    );
    expect(f.prepare).toHaveBeenCalledTimes(2);
    expect(f.onBroadcast).not.toHaveBeenCalled();
  });

  test('refuses cancellation during the later signing/dispatch boundary', async () => {
    const f = fixture();
    f.atSend(() => f.abort.abort());
    await expect(f.immediate(() => undefined)).rejects.toThrow('CANCELLED');
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.onBroadcast).not.toHaveBeenCalled();
  });
});
