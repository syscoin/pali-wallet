/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { getEvmTransactionDisplayInfo } from '../../../../../../shared/evmTransactionDisplay';
import { projectEvmActivityRow } from '../../../../../../wallet/evmActivityRow';

import { useEvmActivityHistory } from './useEvmActivityHistory';

const mockEmitter = jest.fn();
const navigation = (account: string) => ({ account, network: 'network' });
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
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, fail) => {
    resolve = r;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
beforeEach(() => mockEmitter.mockReset());

test('local projection retains exact money, null creation target and a call hint without fabricating calldata or receipts', () => {
  const result: any = projectEvmActivityRow(row('1') as any);
  expect(result.value).toBe('9007199254740993000000001');
  expect(result.historySource).toBe('local-signed');
  expect(result.to).toBeNull();
  expect(result.dataBytes).toBe(10000);
  expect(result.input).toBeUndefined();
  expect(result.accessList).toBeUndefined();
  expect(result.blockNumber).toBeUndefined();
  expect(result.confirmations).toBeUndefined();
});

test('saved smart-account history uses authenticated inner transfer facts and keeps the outer fee payer', async () => {
  const account = '0x' + '44'.repeat(20),
    recipient = '0x' + '55'.repeat(20);
  const outer = row('3');
  const tx: any = {
    ...outer,
    value: '0',
    to: '0x' + '66'.repeat(20),
    smartAccount: {
      account,
      operationHash: hash('4'),
      operationNonce: '0',
      operationCount: 1,
      replayable: true,
      callData: '0x1234',
      executions: [
        { target: recipient, value: '1000000000000000001', data: '0x' },
      ],
    },
  };
  const result: any = projectEvmActivityRow(tx);
  expect(result.from).toBe(account);
  expect(result.to).toBe(recipient);
  expect(result.value).toBe('1000000000000000001');
  expect(result.feePayer).toBe(outer.from);
  expect(result.gas).toBe(outer.gasLimit);
  expect(result.gasPrice).toBe(outer.feePerGas);
  expect(result.hash).toBe(outer.hash);
  expect(result.input).toBe('0x');
  expect(result.blockNumber).toBeUndefined();
  expect(result.txreceipt_status).toBeUndefined();
});

test('saved Smart handleOps cancellation projects its local cancellation intent', () => {
  const account = '0x' + '44'.repeat(20);
  const outer = { ...row('3'), operation: 'send' as const, value: '0' };
  const operationHash = hash('4');
  const smartAccount = {
    account,
    cancellation: true as const,
    operationHash,
    operationNonce: '7',
    operations: [{ operationHash, operationNonce: '7' }],
    operationCount: 1,
    replayable: true,
    callData: '0x1234',
    executions: [{ target: account, value: '0', data: '0x' }],
  };
  const result = projectEvmActivityRow({
    ...outer,
    phase: 'signed',
    smartAccount,
  });
  expect(result).toMatchObject({
    isCancel: true,
    from: account,
    to: account,
    input: '0x',
    value: '0',
    feePayer: outer.from,
  });
});

test('bounded pages cross the JSON message boundary and preserve older records on refresh', async () => {
  mockEmitter.mockImplementation((_: unknown, params: unknown[]) => {
    const [cursor, limit, scope] = JSON.parse(JSON.stringify(params));
    expect(limit).toBe(30);
    expect(scope).toEqual(navigation('a'));
    return Promise.resolve(
      cursor
        ? { transactions: [row('2')], nextCursor: null }
        : { transactions: [row('1')], nextCursor: hash('1') }
    );
  });
  const { result } = renderHook(() =>
    useEvmActivityHistory({
      includeLocal: true,
      scope: navigation('a'),
      chainId: 57057,
    })
  );
  await flush();
  expect(result.current.transactions.map((tx) => tx.hash)).toEqual([hash('1')]);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getSavedEvmTransactions'],
    [null, 30, navigation('a')]
  );
  await act(async () => result.current.olderRows.loadMore());
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
  expect(result.current.olderRows.hasMore).toBe(false);
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
    ({ scope }) =>
      useEvmActivityHistory({
        includeLocal: true,
        scope: navigation(scope),
        chainId: 57057,
      }),
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
    () =>
      useEvmActivityHistory({
        includeLocal: true,
        scope: navigation('a'),
        chainId: 57057,
      }),
    {
      wrapper: ({ children }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    }
  );
  await flush();
  expect(result.current.transactions[0].hash).toBe(hash('1'));
  mockEmitter.mockClear();
  renderHook(() =>
    useEvmActivityHistory({
      includeLocal: false,
      scope: navigation('utxo'),
      chainId: 57057,
    })
  );
  await flush();
  expect(mockEmitter).not.toHaveBeenCalled();
});

test('a failed later local read leaves retained history available', async () => {
  mockEmitter.mockResolvedValueOnce({
    transactions: [row('1')],
    nextCursor: hash('1'),
  });
  const { result } = renderHook(() =>
    useEvmActivityHistory({
      includeLocal: true,
      scope: navigation('a'),
      chainId: 57057,
    })
  );
  await flush();
  mockEmitter.mockRejectedValue(new Error('read unavailable'));
  await act(async () => result.current.olderRows.loadMore());
  expect(result.current.transactions[0].hash).toBe(hash('1'));
  expect(result.current.olderRows.loading).toBe(false);
  expect(result.current.unavailable).toBe(true);
});

test('a failed first read stays unavailable across rerenders without an automatic retry loop', async () => {
  jest.useFakeTimers();
  try {
    mockEmitter.mockRejectedValue(new Error('Read unavailable'));
    const { result, rerender } = renderHook(() =>
      useEvmActivityHistory({
        includeLocal: true,
        scope: navigation('a'),
        chainId: 57057,
      })
    );
    await flush();
    expect(result.current.unavailable).toBe(true);
    expect(result.current.olderRows.loading).toBe(false);
    rerender();
    await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    mockEmitter.mockResolvedValueOnce({
      transactions: [row('1')],
      nextCursor: null,
    });
    await act(async () => result.current.retry());
    expect(result.current.transactions[0].hash).toBe(hash('1'));
    expect(result.current.unavailable).toBe(false);
    expect(mockEmitter).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('an explicit local page retry preserves its failed cursor, successful rows and thirty-row request', async () => {
  mockEmitter.mockResolvedValueOnce({
    transactions: [row('1')],
    nextCursor: hash('1'),
  });
  const { result } = renderHook(() =>
    useEvmActivityHistory({
      includeLocal: true,
      scope: navigation('a'),
      chainId: 57057,
    })
  );
  await flush();
  mockEmitter.mockRejectedValueOnce(new Error('Older page unavailable'));
  await act(async () => result.current.olderRows.loadMore());
  expect(result.current.unavailable).toBe(true);
  expect(result.current.olderRows.hasMore).toBe(true);
  mockEmitter.mockResolvedValueOnce({
    transactions: [row('2')],
    nextCursor: null,
  });
  await act(async () => result.current.retry());
  expect(mockEmitter.mock.calls.slice(-2).map(([, args]) => args)).toEqual([
    [hash('1'), 30, navigation('a')],
    [hash('1'), 30, navigation('a')],
  ]);
  expect(result.current.transactions.map((tx) => tx.hash)).toEqual([
    hash('1'),
    hash('2'),
  ]);
  expect(result.current.unavailable).toBe(false);
  expect(result.current.olderRows.hasMore).toBe(false);
});

test.each([
  undefined,
  {},
  { transactions: [], nextCursor: undefined },
  { transactions: Array(31).fill(row('1')), nextCursor: null },
])(
  'treats an unusable bounded page as unavailable rather than successful empty: %j',
  async (page) => {
    mockEmitter.mockResolvedValueOnce(page);
    const { result } = renderHook(() =>
      useEvmActivityHistory({
        includeLocal: true,
        scope: navigation('a'),
        chainId: 57057,
      })
    );
    await flush();
    expect(result.current.unavailable).toBe(true);
    expect(result.current.transactions).toEqual([]);
  }
);

test.each(['success', 'failure'])(
  'late retry %s cannot publish into a newer A-B-A visit or after unmount',
  async (outcome) => {
    const held = deferred<any>();
    mockEmitter.mockRejectedValueOnce(new Error('Initial unavailable'));
    const { result, rerender, unmount } = renderHook(
      ({ scope }) =>
        useEvmActivityHistory({
          includeLocal: true,
          scope: navigation(scope),
          chainId: 57057,
        }),
      { initialProps: { scope: 'a:network' } }
    );
    await flush();
    const staleRetry = result.current.retry;
    mockEmitter.mockReturnValueOnce(held.promise);
    let retry!: Promise<void>;
    act(() => {
      retry = result.current.retry();
    });
    mockEmitter.mockResolvedValue({ transactions: [], nextCursor: null });
    rerender({ scope: 'b:network' });
    rerender({ scope: 'a:network' });
    await flush();
    await act(async () => {
      if (outcome === 'success')
        held.resolve({ transactions: [row('1')], nextCursor: null });
      else held.reject(new Error('Retired read unavailable'));
    });
    await retry;
    expect(result.current.transactions).toEqual([]);
    expect(result.current.unavailable).toBe(false);
    const calls = mockEmitter.mock.calls.length;
    await act(async () => staleRetry());
    expect(mockEmitter).toHaveBeenCalledTimes(calls);
    const retiredRetry = result.current.retry;
    unmount();
    await retiredRetry();
    expect(mockEmitter).toHaveBeenCalledTimes(calls);
  }
);

test('disabling EVM Activity retires an exposed retry even when the account/network scope is unchanged', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Read unavailable'));
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      useEvmActivityHistory({
        includeLocal: enabled,
        scope: navigation('a'),
        chainId: 57057,
      }),
    { initialProps: { enabled: true } }
  );
  await flush();
  const retry = result.current.retry;
  rerender({ enabled: false });
  await retry();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(result.current.unavailable).toBe(false);
  expect(result.current.olderRows.loading).toBe(false);
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
    useEvmActivityHistory({
      includeLocal: true,
      scope: navigation('a'),
      chainId: 57057,
    })
  );
  await flush();
  expect(result.current.olderRows.hasMore).toBe(false);
  mockEmitter.mockResolvedValueOnce({
    transactions: newest,
    nextCursor: newest.at(-1)!.hash,
  });
  act(() => window.dispatchEvent(new Event('focus')));
  await flush();
  expect(result.current.transactions).toHaveLength(60);
  expect(result.current.olderRows.hasMore).toBe(true);
  mockEmitter.mockResolvedValueOnce({
    transactions: [...gap, ...prior.slice(0, 20)],
    nextCursor: prior[19].hash,
  });
  await act(async () => result.current.olderRows.loadMore());
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'getSavedEvmTransactions'],
    [newest.at(-1)!.hash, 30, navigation('a')]
  );
  expect(new Set(result.current.transactions.map((tx) => tx.hash)).size).toBe(
    70
  );
  for (const tx of gap)
    expect(
      result.current.transactions.some((found) => found.hash === tx.hash)
    ).toBe(true);
});

test('projects signed ERC-20 units and recipient with or without token metadata without input', () => {
  const tokenAddress = `0x${'22'.repeat(20)}`;
  const recipient = `0x${'33'.repeat(20)}`;
  for (const token of [
    undefined,
    {
      contractAddress: tokenAddress,
      decimals: 6,
      symbol: 'TOK',
      name: 'Token',
    },
  ]) {
    const tx: any = projectEvmActivityRow({
      ...row('3'),
      to: tokenAddress,
      operation: 'erc20',
      tokenTransfer: {
        amountUnits: '6000000',
        recipient,
        ...(token ? { token } : {}),
      },
    } as any);
    expect(tx.input).toBeUndefined();
    expect(tx.tokenTransfer).toMatchObject({
      contractAddress: tokenAddress,
      recipient,
      value: '6000000',
    });
    expect(tx.tokenTransfer.decimals).toBe(token?.decimals);
    expect(tx.tokenTransfer.symbol).toBe(token?.symbol);
  }
});

test.each(['ERC-721', 'ERC-1155'] as const)(
  'projects saved %s intent into the shared display without inventing calldata',
  async (tokenStandard) => {
    const collectibleTransfer = {
      kind: 'nft-transfer' as const,
      chainId: '57057',
      from: `0x${'11'.repeat(20)}`,
      contractAddress: `0x${'22'.repeat(20)}`,
      recipient: `0x${'33'.repeat(20)}`,
      tokenStandard,
      tokenId: '0',
      amountUnits: tokenStandard === 'ERC-721' ? '1' : '9007199254740993',
    };
    const tx: any = projectEvmActivityRow({
      ...row('4'),
      from: collectibleTransfer.from,
      to: collectibleTransfer.contractAddress,
      value: '0',
      operation: tokenStandard === 'ERC-721' ? 'erc721' : 'erc1155',
      collectibleTransfer,
    } as any);
    expect(tx.collectibleTransfer).toEqual(collectibleTransfer);
    expect(tx.input).toBeUndefined();
    expect(tx.tokenTransfer).toBeUndefined();
    expect(await getEvmTransactionDisplayInfo(tx, 'SYS')).toMatchObject({
      actualRecipient: collectibleTransfer.recipient,
      formattedValue: collectibleTransfer.amountUnits,
      displaySymbol: 'NFT',
      isNft: true,
      tokenId: '0',
      ...(tokenStandard === 'ERC-1155'
        ? { nftQuantity: collectibleTransfer.amountUnits }
        : {}),
    });
  }
);

test('retains scoped Smart cancellation eligibility while the indexed row supplies the body', async () => {
  const accountAddress = '0x' + '44'.repeat(20);
  const local = {
    ...row('1'),
    smartAccount: { account: accountAddress, operationCount: 1 },
  };
  const indexed = { hash: local.hash, confirmations: 4, value: '12' } as any;
  mockEmitter.mockResolvedValue({ transactions: [local], nextCursor: null });
  const { result } = renderHook(() =>
    useEvmActivityHistory({
      includeLocal: true,
      scope: navigation('a'),
      indexedTransactions: [indexed],
      accountAddress,
      chainId: 57057,
    })
  );
  await flush();
  expect(result.current.transactions).toEqual([indexed]);
  expect(result.current.smartCancellationHashes.has(local.hash)).toBe(true);
});
