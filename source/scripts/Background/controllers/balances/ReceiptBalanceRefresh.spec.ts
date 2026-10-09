jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(),
}));

import { Contract, id } from 'utils/ethersV6Compat';

import {
  ReceiptBalanceRefresh,
  readTrackedTokenBalance,
  receiptBalanceTargets,
} from './ReceiptBalanceRefresh';

const A = `0x${'11'.repeat(20)}`;
const B = `0x${'22'.repeat(20)}`;
const T = `0x${'33'.repeat(20)}`;
const SA = `0x${'44'.repeat(20)}`;
const topic = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('receipt balance queue', () => {
  let queue: ReceiptBalanceRefresh;
  beforeEach(() => {
    jest.useFakeTimers();
    queue = new ReceiptBalanceRefresh();
  });
  afterEach(() => {
    queue.cancel();
    jest.useRealTimers();
  });

  it('is silent while idle and coalesces duplicate/lower-block events', async () => {
    const read = jest.fn().mockResolvedValue(undefined);
    expect(jest.getTimerCount()).toBe(0);
    queue.schedule('chain:account:token', 3, read);
    queue.schedule('chain:account:token', 3, read);
    queue.schedule('chain:account:token', 2, read);
    await jest.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(1);
    queue.schedule('chain:account:token', 3, read);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries errors finitely, but never retries a successful same balance', async () => {
    const failing = jest
      .fn()
      .mockRejectedValue(new Error('node behind receipt'));
    const unchanged = jest.fn().mockResolvedValue(undefined);
    queue.schedule('bad', 4, failing);
    queue.schedule('same-balance', 4, unchanged);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(failing).toHaveBeenCalledTimes(4);
    expect(unchanged).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('limits concurrent reads to three and does not block unrelated keys', async () => {
    const gate = deferred();
    const read = jest.fn().mockReturnValue(gate.promise);
    for (let i = 0; i < 10; i++) queue.schedule(`${i}`, 4, read);
    await jest.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(3);
    gate.resolve();
    await jest.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(10);
  });

  it('invalidates an in-flight older block and account/chain-cancelled result', async () => {
    const gate = deferred();
    const committed: number[] = [];
    queue.schedule('same', 4, async (current) => {
      await gate.promise;
      if (current()) committed.push(4);
    });
    await jest.advanceTimersByTimeAsync(100);
    queue.schedule('same', 5, async (current) => {
      if (current()) committed.push(5);
    });
    await jest.advanceTimersByTimeAsync(100);
    gate.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(committed).toEqual([5]);
    const cancelled = deferred();
    queue.schedule('other', 6, async (current) => {
      await cancelled.promise;
      if (current()) committed.push(6);
    });
    await jest.advanceTimersByTimeAsync(100);
    queue.cancel();
    cancelled.resolve();
    await jest.advanceTimersByTimeAsync(100);
    expect(committed).toEqual([5]);
  });

  it('aborts hung transports at the deadline and releases all three worker slots', async () => {
    const signals: AbortSignal[] = [];
    const hung = jest.fn((_current, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const healthy = jest.fn().mockResolvedValue(undefined);
    for (let i = 0; i < 3; i++) queue.schedule(`hung-${i}`, 10, hung);
    queue.schedule('healthy', 10, healthy);
    await jest.advanceTimersByTimeAsync(100);
    expect(hung).toHaveBeenCalledTimes(3);
    expect(healthy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(signals.slice(0, 3).every((signal) => signal.aborted)).toBe(true);
    expect(healthy).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(124_250);
    expect(hung).toHaveBeenCalledTimes(12); // four attempts for each key
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(hung).toHaveBeenCalledTimes(12);
  });

  it('aborts replacements and context cancellation without late writes or retries', async () => {
    const gates = [deferred(), deferred()];
    const signals: AbortSignal[] = [];
    const committed: number[] = [];
    queue.schedule('same', 10, async (current, signal) => {
      signals.push(signal);
      await gates[0].promise; // even a broken transport that ignores abort
      if (current()) committed.push(10);
    });
    await jest.advanceTimersByTimeAsync(100);
    queue.schedule('same', 11, async (current, signal) => {
      signals.push(signal);
      await gates[1].promise;
      if (current()) committed.push(11);
    });
    expect(signals[0].aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(100);
    expect(signals).toHaveLength(2);
    queue.cancel();
    expect(signals[1].aborted).toBe(true);
    gates.forEach((gate) => gate.resolve());
    await jest.advanceTimersByTimeAsync(300_000);
    expect(committed).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not allow a timed-out response to commit during a newer retry', async () => {
    const old = deferred();
    const committed: number[] = [];
    const read = jest
      .fn()
      .mockImplementationOnce(async (current) => {
        await old.promise;
        if (current()) committed.push(1);
      })
      .mockImplementationOnce(async (current) => {
        if (current()) committed.push(2);
      });
    queue.schedule('token', 10, read);
    await jest.advanceTimersByTimeAsync(30_350);
    expect(read).toHaveBeenCalledTimes(2);
    old.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(committed).toEqual([2]);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('receipt affected-key planning', () => {
  it('ignores malformed log/hint rows without losing a valid receipt event', () => {
    const result = receiptBalanceTargets({
      balanceRefreshTokenAddresses: {},
      logs: [
        null,
        1,
        { topics: [42] },
        {
          address: T,
          topics: [id('Transfer(address,address,uint256)'), topic(A), topic(B)],
        },
      ],
    });
    expect(result.tokens.has(T)).toBe(true);
    expect([...result.owners]).toEqual([A, B]);
  });
  it('uses the EOA payer and ERC20 event sender/recipient, not unrelated balances', () => {
    const result = receiptBalanceTargets({
      from: A,
      to: T,
      value: '0',
      logs: [
        {
          address: T,
          topics: [id('Transfer(address,address,uint256)'), topic(A), topic(B)],
        },
      ],
    });
    expect([...result.native]).toEqual([A]);
    expect(result.owners.has(A)).toBe(true);
    expect(result.owners.has(B)).toBe(true);
    expect(result.tokens.has(T)).toBe(true);
  });
  it('handles AA inner token/native targets and the actual outer payer', () => {
    const result = receiptBalanceTargets({
      from: A,
      to: B,
      smartAccountExecutionFrom: SA,
      balanceRefreshTokenAddresses: [T],
      balanceRefreshNativeAddresses: [SA],
      value: '0',
    });
    expect([...result.native]).toEqual([A, SA]);
    expect(result.owners.has(SA)).toBe(true);
    expect(result.tokens.has(T)).toBe(true);
  });
  it('handles incoming explorer token rows without charging the recipient native gas', () => {
    const result = receiptBalanceTargets({
      from: A,
      to: B,
      contractAddress: T,
      value: '100',
    });
    expect([...result.native]).toEqual([A]);
    expect(result.owners.has(B)).toBe(true);
    expect(result.tokens.has(T)).toBe(true);
  });
  it('finds ERC1155 recipients but not the event operator', () => {
    const result = receiptBalanceTargets({
      logs: [
        {
          address: T,
          topics: [
            id('TransferSingle(address,address,address,uint256,uint256)'),
            topic(SA),
            topic(A),
            topic(B),
          ],
        },
      ],
    });
    expect([...result.owners]).toEqual([A, B]);
  });
});

it('reads exactly one balanceOf at the requested block without metadata', async () => {
  const balanceOf = jest.fn().mockResolvedValue(BigInt(123));
  (Contract as jest.Mock).mockReturnValue({ balanceOf });
  const result = await readTrackedTokenBalance(
    {} as any,
    A,
    {
      contractAddress: T,
      decimals: 2,
      balance: 9,
      isNft: false,
      tokenSymbol: 'TOKEN',
      tokenStandard: 'ERC-20',
    },
    19
  );
  expect(result).toEqual({ balance: 1.23, rawBalance: '123' });
  expect(balanceOf).toHaveBeenCalledTimes(1);
  expect(balanceOf).toHaveBeenCalledWith(A, { blockTag: 19 });
});
