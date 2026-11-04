/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import React from 'react';

import {
  savedTransactionHistoryRow,
  useSavedEvmTransactions,
} from './useSavedEvmTransactions';

const mockEmitter = jest.fn();
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
const hash = (byte: string) => `0x${byte.repeat(64)}`;
const row = (byte: string) => ({
  hash: hash(byte),
  chainId: '57057',
  from: 'public-from',
  to: null,
  value: '9007199254740993000000001',
  createdAt: 1700000000123,
  phase: 'submitted',
  type: 1,
  gasLimit: '30000',
  feePerGas: '1',
  maximumFee: '30000',
  dataBytes: 10000,
  selector: '0x12345678',
  operation: 'send',
  nonce: 1,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
beforeEach(() => mockEmitter.mockReset());

test('local projection retains exact money, null creation target and a call hint without fabricating calldata or receipts', () => {
  const result: any = savedTransactionHistoryRow(row('1') as any);
  expect(result.value).toBe('9007199254740993000000001');
  expect(result.to).toBeNull();
  expect(result.dataBytes).toBe(10000);
  expect(result.input).toBeUndefined();
  expect(result.accessList).toBeUndefined();
  expect(result.blockNumber).toBeUndefined();
  expect(result.confirmations).toBeUndefined();
});

test('bounded pages append and a focus refresh keeps already loaded older records', async () => {
  mockEmitter.mockImplementation((_: unknown, [cursor]: any[]) =>
    Promise.resolve(
      cursor
        ? { transactions: [row('2')], nextCursor: null }
        : { transactions: [row('1')], nextCursor: hash('1') }
    )
  );
  const { result } = renderHook(() =>
    useSavedEvmTransactions(true, 'a:network')
  );
  await flush();
  expect(result.current.transactions.map((tx) => tx.hash)).toEqual([hash('1')]);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getSavedEvmTransactions'],
    [undefined, 30]
  );
  await act(async () => result.current.loadMore());
  expect(result.current.transactions.map((tx) => tx.hash)).toEqual([
    hash('1'),
    hash('2'),
  ]);
  act(() => window.dispatchEvent(new Event('focus')));
  await flush();
  expect(result.current.transactions.map((tx) => tx.hash)).toEqual([
    hash('1'),
    hash('2'),
  ]);
  expect(result.current.hasMore).toBe(false);
});

test('a stale A-B-A reply cannot publish history into the new account visit', async () => {
  const pending = deferred<any>();
  let calls = 0;
  mockEmitter.mockImplementation(() =>
    ++calls === 1
      ? pending.promise
      : Promise.resolve({ transactions: [], nextCursor: null })
  );
  const { result, rerender } = renderHook(
    ({ scope }) => useSavedEvmTransactions(true, scope),
    { initialProps: { scope: 'a:network' } }
  );
  rerender({ scope: 'b:network' });
  rerender({ scope: 'a:network' });
  await flush();
  await act(async () =>
    pending.resolve({ transactions: [row('1')], nextCursor: null })
  );
  expect(result.current.transactions).toEqual([]);
});

test('strict effect remount loads a current page and disabled UTXO mode performs no read', async () => {
  mockEmitter.mockResolvedValue({ transactions: [row('1')], nextCursor: null });
  const { result } = renderHook(
    () => useSavedEvmTransactions(true, 'a:network'),
    {
      wrapper: ({ children }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    }
  );
  await flush();
  expect(result.current.transactions[0].hash).toBe(hash('1'));
  mockEmitter.mockClear();
  renderHook(() => useSavedEvmTransactions(false, 'utxo'));
  await flush();
  expect(mockEmitter).not.toHaveBeenCalled();
});

test('a failed later local read leaves retained history available', async () => {
  mockEmitter.mockResolvedValueOnce({
    transactions: [row('1')],
    nextCursor: hash('1'),
  });
  const { result } = renderHook(() =>
    useSavedEvmTransactions(true, 'a:network')
  );
  await flush();
  mockEmitter.mockRejectedValue(new Error('read unavailable'));
  await act(async () => result.current.loadMore());
  expect(result.current.transactions[0].hash).toBe(hash('1'));
  expect(result.current.loading).toBe(false);
});

test('more than a page of new records cannot leave a permanent gap after a refresh', async () => {
  const numbered = (n: number) => ({
    ...row('1'),
    hash: `0x${n.toString(16).padStart(64, '0')}`,
  });
  const prior = Array.from({ length: 30 }, (_, i) => numbered(30 - i));
  const newest = Array.from({ length: 30 }, (_, i) => numbered(70 - i));
  const gap = Array.from({ length: 10 }, (_, i) => numbered(40 - i));
  mockEmitter.mockResolvedValueOnce({ transactions: prior, nextCursor: null });
  const { result } = renderHook(() =>
    useSavedEvmTransactions(true, 'a:network')
  );
  await flush();
  expect(result.current.hasMore).toBe(false);
  mockEmitter.mockResolvedValueOnce({
    transactions: newest,
    nextCursor: newest.at(-1)!.hash,
  });
  act(() => window.dispatchEvent(new Event('focus')));
  await flush();
  expect(result.current.transactions).toHaveLength(60);
  expect(result.current.hasMore).toBe(true);
  mockEmitter.mockResolvedValueOnce({
    transactions: [...gap, ...prior.slice(0, 20)],
    nextCursor: prior[19].hash,
  });
  await act(async () => result.current.loadMore());
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'getSavedEvmTransactions'],
    [newest.at(-1)!.hash, 30]
  );
  expect(new Set(result.current.transactions.map((tx) => tx.hash)).size).toBe(
    70
  );
  for (const tx of gap)
    expect(
      result.current.transactions.some((found) => found.hash === tx.hash)
    ).toBe(true);
});
