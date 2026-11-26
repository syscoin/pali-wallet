/**
 * @jest-environment jsdom
 */
// These history/rendering tests never admit a UTXO descriptor or submit a
// retained transaction. Fail if either boundary is crossed; loading native
// signer cryptography inside JSDOM is outside this EVM view's contract.
jest.mock('@sidhujag/sysweb3-keyring/cjs/utils/watch-descriptor.js', () => ({
  descriptorChecksum: jest.fn(() => {
    throw new Error('Unexpected UTXO descriptor admission');
  }),
}));
jest.mock('@sidhujag/sysweb3-keyring/cjs/software.js', () => ({
  captureEvmSubmission: jest.fn(() => {
    throw new Error('Unexpected retained submission');
  }),
  submitSignedEvmTransaction: jest.fn(() => {
    throw new Error('Unexpected retained submission');
  }),
  evmSubmissionFailure: jest.fn(() => {
    throw new Error('Unexpected retained submission');
  }),
}));

afterEach(() => {
  expect(
    jest.requireMock('@sidhujag/sysweb3-keyring/cjs/utils/watch-descriptor.js')
      .descriptorChecksum
  ).not.toHaveBeenCalled();
  for (const method of Object.values(
    jest.requireMock('@sidhujag/sysweb3-keyring/cjs/software.js')
  ))
    expect(method).not.toHaveBeenCalled();
});

import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { AbstractProvider } from 'ethers/providers';
import React from 'react';
import { Provider } from 'react-redux';

import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import TransactionsManager from 'scripts/Background/controllers/transactions';
import vaultReducer, { setActiveNetwork } from 'state/vault';
import globalReducer, { setNetworkStatus } from 'state/vaultGlobal';
import { ROLLUX_DEFAULT_NETWORK } from 'utils/constants';
import { getWalletNavigationScope } from 'utils/navigationState';

import { TransactionsPanel } from './ActivityPanel';

let mockStore: any;
let mockWallet: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({ wallet: mockWallet }),
  notificationManager: {
    cleanup: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringAccountType: {
    HDAccount: 'HDAccount',
    Imported: 'Imported',
    Ledger: 'Ledger',
    Trezor: 'Trezor',
    SmartAccount: 'SmartAccount',
  },
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
// This EVM-only suite does not parse or sign PSBTs. Avoid the unrelated UTXO
// dependency's browser-only ESM entry under JSDOM; its controller is not used.
jest.mock('syscointx-js', () => ({ bufferUtils: {} }));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: { error: jest.fn() } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Icon/Icon', () => ({ ExternalLinkSvg: () => null }));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: ([, method]: string[], args: any[]) =>
    mockWallet[method](...args),
}));
// The real panel and complete history producer/persistence path are under test.
// Row formatting has independent suites; display its exact committed hashes.
jest.mock('pages/Home/Panel/components/Transactions/EVM/EvmList', () => ({
  EvmTransactionsList: ({ explorerHasMore, userTransactions }: any) => (
    <div data-explorer-has-more={String(explorerHasMore)}>
      {userTransactions.map((tx: any) => tx.hash).join(',')}
    </div>
  ),
}));
jest.mock('pages/Home/Panel/components/Transactions/UTXO/UtxoList', () => ({
  UtxoTransactionsList: () => null,
}));

const OWNER = `0x${'11'.repeat(20)}`;
const OTHER = `0x${'22'.repeat(20)}`;
const HASH = `0x${'ab'.repeat(32)}`;
const network = ROLLUX_DEFAULT_NETWORK.network;
const transaction = {
  hash: HASH,
  from: OTHER,
  to: OWNER,
  value: '1000000000000000000',
  nonce: 1,
  chainId: network.chainId,
  timestamp: 1700000100,
  blockNumber: 50,
  blockHash: `0x${'cd'.repeat(32)}`,
  confirmations: 51,
  input: '0x',
};
let originalFetch: typeof fetch;
let manager: ReturnType<typeof TransactionsManager>;
let mode: 'empty' | 'failed' | 'unavailable';
let explorerRows: (typeof transaction)[];
let reads: string[];
let provider: any;
let hold: Promise<void> | undefined;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};
const response = (status: number, result: unknown[] = []) =>
  ({
    ok: status === 200,
    status,
    statusText: status === 200 ? 'OK' : 'Synthetic history failure',
    text: async () => 'Synthetic history failure',
    json: async () => ({ status: '1', message: 'OK', result }),
  } as unknown as Response);
const currentRows = () =>
  mockStore.getState().vault.accountTransactions.HDAccount[0].ethereum[
    network.chainId
  ];
const fetchInitial = () =>
  mockWallet.updateUserTransactionsState({
    isBitcoinBased: false,
    activeNetwork: mockStore.getState().vault.activeNetwork,
    isPolling: true,
    forceRefresh: true,
  });
const renderAfterSettleTime = async () => {
  jest.useFakeTimers();
  render(
    <Provider store={mockStore}>
      <TransactionsPanel />
    </Provider>
  );
  await act(async () => jest.advanceTimersByTimeAsync(1201));
};
const setRows = (rows: any[]) =>
  mockStore.dispatch({
    type: 'vault/setAccountTransactions',
    payload: {
      transactions: rows,
      chainId: network.chainId,
      networkType: 'ethereum',
    },
  });

beforeEach(() => {
  jest.clearAllMocks();
  mode = 'empty';
  explorerRows = [];
  hold = undefined;
  reads = [];
  const initial = vaultReducer(undefined, { type: 'test/init' });
  const global = globalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: globalReducer },
    preloadedState: {
      vault: {
        ...initial,
        activeNetwork: network,
        isBitcoinBased: false,
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: {
              id: 0,
              label: 'Synthetic public account',
              address: OWNER,
              balances: { ethereum: '1' },
              evmTxCountByChainId: { [network.chainId]: 1 },
            },
          },
        },
        accountTransactions: {
          HDAccount: {
            0: { ethereum: { [network.chainId]: [] }, syscoin: {} },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60, networkStatus: 'idle' },
    },
    middleware: (defaults) => defaults({ serializableCheck: false }),
  });
  provider = {
    _wrapTransactionResponse: Reflect.get(
      AbstractProvider.prototype,
      '_wrapTransactionResponse'
    ),
    getTransactionCount: jest.fn().mockResolvedValue(0),
    getBlockNumber: jest.fn().mockResolvedValue(100),
    sendBatch: jest.fn(async (method: string, params: any[]) => {
      if (method !== 'eth_getBlockByNumber')
        throw new Error('Unexpected provider method');
      return params.map(([number]) => ({
        number,
        timestamp: '0x6553f100',
        transactions: [],
      }));
    }),
  };
  provider.send = jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'eth_chainId')
      return '0x' + BigInt(network.chainId).toString(16);
    if (method === 'eth_blockNumber') return '0x64';
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getBlockByNumber')
      return {
        ...(
          await provider.sendBatch(method, [
            [params[0] === 'latest' ? '0x64' : params[0], params[1]],
          ])
        )[0],
        hash:
          '0x' +
          BigInt(params[0] === 'latest' ? 100 : (params[0] as string))
            .toString(16)
            .padStart(64, '0'),
        parentHash:
          '0x' +
          (
            BigInt(params[0] === 'latest' ? 100 : (params[0] as string)) -
            BigInt(1)
          )
            .toString(16)
            .padStart(64, '0'),
      };
    throw new Error('Unexpected history RPC ' + method);
  });
  provider.readMany = jest.fn(
    (requests: readonly { method: string; params: unknown[] }[]) =>
      Promise.allSettled(
        requests.map(({ method, params }) => provider.send(method, params))
      )
  );
  manager = TransactionsManager();
  manager.utils.clearCache();
  mockWallet = Object.create(MainController.prototype);
  Object.assign(mockWallet, {
    assertWalletReadyForSigning: () => undefined,
    getActiveKeyring: () => ({
      isUnlocked: () => true,
      ethereumTransaction: { web3Provider: provider },
    }),
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    cancellablePromises: new CancellablePromises(),
    transactionsManager: manager,
    // This fixture owns explorer availability; saved-summary storage has its
    // independent failure/retry suite and supplies a successful empty page here.
    getSavedEvmTransactions: jest.fn().mockResolvedValue({
      transactions: [],
      nextCursor: null,
    }),
    reconcileLocalPendingEvmSmartAccountTransactions: jest
      .fn()
      .mockResolvedValue(undefined),
    refreshBalancesAfterHistory: jest.fn(),
  });
  originalFetch = globalThis.fetch;
  // Keep the installed SDK retryableFetch, API mapper, TransactionsManager,
  // MainController and reducers intact. Only exact synthetic HTTP replies vary.
  globalThis.fetch = jest.fn(async (input: any, options: any) => {
    const url = new URL(String(input));
    const action = url.searchParams.get('action')!;
    if (
      url.origin !== new URL(network.apiUrl!).origin ||
      url.pathname !== '/api' ||
      url.searchParams.get('module') !== 'account' ||
      url.searchParams.get('address') !== OWNER ||
      !['txlist', 'tokentx', 'pendingtxlist'].includes(action) ||
      (options?.method && options.method !== 'GET')
    )
      throw new Error('Non-fixture public request denied');
    reads.push(action);
    const responseMode = mode;
    await hold;
    return response(
      responseMode === 'failed'
        ? 500
        : responseMode === 'unavailable'
        ? 503
        : 200,
      action === 'txlist' ? explorerRows : []
    );
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
  manager.utils.clearCache();
  jest.restoreAllMocks();
});

it('qualifies NFT and internal-transfer coverage after healthy configured explorer feeds', async () => {
  await expect(fetchInitial()).resolves.toBeUndefined();
  expect(reads).toEqual(['txlist', 'pendingtxlist', 'tokentx']);
  await renderAfterSettleTime();
  expect(screen.getByText('home.noIndexedActivity')).toBeVisible();
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(currentRows()).toEqual([]);
});

it('discovers external activity on a visible stale view without duplicating fresh reads', async () => {
  await fetchInitial();
  const visibility = jest
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  await renderAfterSettleTime();
  expect(reads).toHaveLength(3);

  explorerRows = [transaction];
  visibility.mockReturnValue('hidden');
  await act(async () => jest.advanceTimersByTimeAsync(15_000));
  expect(reads).toHaveLength(3);

  visibility.mockReturnValue('visible');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(reads).toHaveLength(6);
  expect(screen.getByText(HASH)).toBeVisible();

  cleanup();
  await act(async () => jest.advanceTimersByTimeAsync(15_000));
  expect(reads).toHaveLength(6);
});

it('recovers after a transient visible history failure while retaining indexed rows', async () => {
  explorerRows = [transaction];
  await fetchInitial();
  await renderAfterSettleTime();

  mode = 'unavailable';
  await act(async () => jest.advanceTimersByTimeAsync(25_000));
  expect(screen.getByText(HASH)).toBeVisible();
  expect(screen.getByText('send.unableToLoad')).toBeVisible();

  mode = 'empty';
  await act(async () => jest.advanceTimersByTimeAsync(15_000));
  expect(screen.getByText(HASH)).toBeVisible();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
});

it('keeps failed configured EVM history visibly retryable instead of claiming empty', async () => {
  mode = 'failed';
  await expect(fetchInitial()).rejects.toThrow('Transaction API error');
  expect(reads).toEqual(['txlist', 'pendingtxlist', 'tokentx']);
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('idle');
  await renderAfterSettleTime();
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
  expect(screen.getByText('send.unableToLoad')).toBeVisible();
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeEnabled();
  expect(currentRows()).toEqual([]);
});

it('preserves cached current-account rows when configured explorer history fails', async () => {
  setRows([transaction]);
  mode = 'failed';
  await expect(fetchInitial()).rejects.toThrow('Transaction API error');
  await renderAfterSettleTime();
  expect(screen.getByText(HASH)).toBeVisible();
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
  expect(currentRows()).toEqual([transaction]);
});

it.each([1, 30])(
  'passes the explorer page hint for %s indexed transactions',
  async (count) => {
    explorerRows = Array.from({ length: count }, (_, index) => ({
      ...transaction,
      hash: '0x' + index.toString(16).padStart(64, '0'),
      nonce: index,
    }));
    await expect(fetchInitial()).resolves.toBeUndefined();
    await renderAfterSettleTime();
    const rows = screen.getByText(
      explorerRows.map(({ hash }) => hash).join(',')
    );
    expect(rows).toHaveAttribute(
      'data-explorer-has-more',
      String(count === 30)
    );
  }
);

it('shows incomplete history after a no-API RPC fallback returns no rows', async () => {
  mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
  await expect(fetchInitial()).resolves.toBeUndefined();
  expect(reads).toEqual([]);
  expect(provider.sendBatch).toHaveBeenCalled();
  await renderAfterSettleTime();
  expect(screen.getByText('home.historyMayBeIncomplete')).toBeVisible();
  expect(screen.getByText('home.historyMayBeIncomplete')).toHaveAttribute(
    'role',
    'status'
  );
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
});

it('retains cached rows across a healthy empty explorer response', async () => {
  setRows([transaction]);
  await expect(fetchInitial()).resolves.toBeUndefined();
  await renderAfterSettleTime();
  expect(screen.getByText(HASH)).toBeVisible();
  expect(currentRows()).toEqual([transaction]);
});

it('keeps an initial configured read pending past the balance-settle timer', async () => {
  const pending = deferred();
  hold = pending.promise;
  const read = fetchInitial();
  await renderAfterSettleTime();
  expect(mockStore.getState().vaultGlobal.transactionHistoryStatus.state).toBe(
    'pending'
  );
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
  expect(
    screen.getByText('networkConnection.loadingTransactions')
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
  // The timer assertion is complete. Let the real finite RPC fallback's
  // existing inter-batch waits run normally after the held explorer settles.
  jest.useRealTimers();
  await act(async () => {
    pending.resolve();
    await read;
  });
  expect(screen.getByText('home.noIndexedActivity')).toBeVisible();
  expect(mockStore.getState().vaultGlobal.transactionHistoryStatus.state).toBe(
    'ready'
  );
});

it.each([false, true])(
  'keeps the retry notice in place with cached rows=%s and coalesces clicks',
  async (cached) => {
    if (cached) setRows([transaction]);
    mode = 'failed';
    await expect(fetchInitial()).rejects.toThrow('Transaction API error');
    await renderAfterSettleTime();
    const button = screen.getByRole('button', { name: 'receive.retry' });
    const message = screen.getByText('send.unableToLoad');
    const row = screen.queryByText(HASH);
    if (cached)
      expect(
        row!.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    jest.useRealTimers();
    const pending = deferred();
    mode = 'empty';
    hold = pending.promise;
    let retry!: Promise<void>;
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      retry = mockWallet.historyRetry.promise;
      expect(
        mockWallet.refreshTransactionHistory(getWalletNavigationScope())
      ).toBe(retry);
    });
    expect(reads).toEqual([
      'txlist',
      'pendingtxlist',
      'tokentx',
      'txlist',
      'pendingtxlist',
      'tokentx',
    ]);
    expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
    expect(screen.getByRole('button', { name: 'receive.retry' })).toBe(button);
    expect(button).toBeDisabled();
    expect(screen.getByText('networkConnection.loadingTransactions')).toBe(
      message
    );
    expect(screen.queryByText(HASH)).toBe(row);
    await act(async () => {
      pending.resolve();
      await retry;
    });
    if (cached) expect(screen.getByText(HASH)).toBe(row);
    else expect(screen.getByText('home.noIndexedActivity')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
    expect(mockWallet.historyRetry).toBeUndefined();
  }
);

it('rejects stale-scope, locked, switching and no-API EVM retries before any read', () => {
  const scope = getWalletNavigationScope();
  expect(() =>
    mockWallet.refreshTransactionHistory({ ...scope, network: 'stale' })
  ).toThrow('context changed');
  const getKeyring = mockWallet.getActiveKeyring;
  mockWallet.getActiveKeyring = () => ({ isUnlocked: () => false });
  expect(() => mockWallet.refreshTransactionHistory(scope)).toThrow(
    'context changed'
  );
  mockWallet.getActiveKeyring = getKeyring;
  mockStore.dispatch(setNetworkStatus('switching'));
  expect(() => mockWallet.refreshTransactionHistory(scope)).toThrow(
    'context changed'
  );
  mockStore.dispatch(setNetworkStatus('idle'));
  mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
  expect(() =>
    mockWallet.refreshTransactionHistory(getWalletNavigationScope())
  ).toThrow('context changed');
  expect(reads).toEqual([]);
});

it('does not let a failed old endpoint read overwrite the new current ready state', async () => {
  const old = deferred();
  mode = 'failed';
  hold = old.promise;
  const oldRead = fetchInitial();
  const rejected = expect(oldRead).rejects.toThrow('History context changed');
  mockStore.dispatch(
    setActiveNetwork({ ...network, url: 'https://second.synthetic.invalid' })
  );
  hold = undefined;
  mode = 'empty';
  await fetchInitial();
  const current = mockStore.getState().vaultGlobal.transactionHistoryStatus;
  expect(current.state).toBe('ready');
  expect(current.scope).toEqual(getWalletNavigationScope());
  old.resolve();
  await rejected;
  expect(mockStore.getState().vaultGlobal.transactionHistoryStatus).toEqual(
    current
  );
});

it('retains saved EVM rows and shows incomplete history without an explorer API', async () => {
  mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
  setRows([transaction]);
  await renderAfterSettleTime();
  expect(screen.getByText(HASH)).toBeVisible();
  expect(screen.getByText('home.historyMayBeIncomplete')).toBeVisible();
  expect(screen.getByText('home.historyMayBeIncomplete')).toHaveAttribute(
    'role',
    'status'
  );
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
  expect(reads).toEqual([]);
});

it('switches to scoped explorer loading and healthy empty state when an API is configured', async () => {
  mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
  await renderAfterSettleTime();
  expect(screen.getByText('home.historyMayBeIncomplete')).toBeVisible();
  act(() => mockStore.dispatch(setActiveNetwork(network)));
  expect(screen.queryByText('home.historyMayBeIncomplete')).toBeNull();
  expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
  jest.useRealTimers();
  await act(async () => fetchInitial());
  expect(screen.getByText('home.noIndexedActivity')).toBeVisible();
  expect(screen.queryByText('home.historyMayBeIncomplete')).toBeNull();
  expect(reads).toEqual(['txlist', 'pendingtxlist', 'tokentx']);
});

it.each([
  ['older', 79],
  ['recent', 95],
])(
  'keeps no-API history visibly qualified for a synthetic %s transaction',
  async (_label, txBlock) => {
    mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
    const requested: number[] = [];
    provider.sendBatch.mockImplementation(
      async (method: string, params: any[]) => {
        if (method !== 'eth_getBlockByNumber')
          throw new Error('Unexpected provider method');
        return params.map(([number]) => {
          const height = Number(BigInt(number));
          requested.push(height);
          return {
            number,
            timestamp: '0x6553f100',
            transactions:
              height === txBlock
                ? [
                    {
                      ...transaction,
                      blockNumber: number,
                      nonce: '0x1',
                      gas: '0x5208',
                      gasPrice: '0x1',
                      type: '0x0',
                      v: '0x1b',
                      r: `0x${'01'.padStart(64, '0')}`,
                      s: `0x${'02'.padStart(64, '0')}`,
                      transactionIndex: '0x0',
                    },
                  ]
                : [],
          };
        });
      }
    );
    await fetchInitial();
    await renderAfterSettleTime();
    const found = currentRows().some((row: any) => row.hash === HASH);
    expect(found).toBe(requested.includes(txBlock));
    if (txBlock === 95) {
      expect(found).toBe(true);
      expect(screen.getByText(HASH)).toBeVisible();
    }
    expect(screen.getByText('home.historyMayBeIncomplete')).toBeVisible();
    expect(screen.queryByText('home.noIndexedActivity')).toBeNull();
    expect(reads).toEqual([]);
  }
);

it('rechecks a recent RPC-only placement on mount and follows canonical reinclusion', async () => {
  mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
  const timestamp = Math.floor(Date.now() / 1000);
  setRows([{ ...transaction, timestamp }]);
  const changedHash = '0x' + 'ef'.repeat(32);
  provider.getBlock = jest.fn(async (number: number) => ({
    number,
    hash: changedHash,
    timestamp,
  }));
  provider.getTransaction = jest.fn().mockResolvedValue(null);
  await renderAfterSettleTime();
  expect(currentRows()[0].blockNumber).toBeNull();
  expect(provider.getTransaction).toHaveBeenCalledWith(HASH);
  provider.getTransaction.mockResolvedValue({
    ...transaction,
    blockNumber: 51,
    blockHash: changedHash,
  });
  provider.getTransactionReceipt = jest.fn().mockResolvedValue({
    from: OTHER,
    to: OWNER,
    transactionHash: HASH,
    blockNumber: 51,
    blockHash: changedHash,
    status: 1,
  });
  await act(async () => jest.advanceTimersByTimeAsync(15_000));
  expect(currentRows()[0].blockNumber).toBe(51);
  expect(currentRows()[0].blockHash).toBe(changedHash);
  expect(reads).toEqual([]);
});

it('keeps RPC-only placement on failed canonical read, shares headers, and stops after the recent window', async () => {
  mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
  const timestamp = Math.floor(Date.now() / 1000) - 280;
  setRows([
    { ...transaction, timestamp },
    { ...transaction, hash: '0x' + 'ef'.repeat(32), nonce: 2, timestamp },
  ]);
  provider.getBlock = jest.fn().mockRejectedValue(new Error('unavailable'));
  await renderAfterSettleTime();
  expect(provider.getBlock).toHaveBeenCalledTimes(1);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await mockWallet.refreshTransactionHistory(
      getWalletNavigationScope(),
      'visible'
    );
  });
  expect(provider.getBlock).toHaveBeenCalledTimes(1);
  expect(
    currentRows().every((row: any) => row.blockHash === transaction.blockHash)
  ).toBe(true);
  // The next popup tick can reach the worker earlier than the preceding one.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(13_500);
    await mockWallet.refreshTransactionHistory(
      getWalletNavigationScope(),
      'visible'
    );
  });
  expect(provider.getBlock).toHaveBeenCalledTimes(2);
  await act(async () => jest.advanceTimersByTimeAsync(60_000));
  expect(provider.getBlock).toHaveBeenCalledTimes(2);
});

it('replaces a moved placement directly only after the new receipt agrees with the header', async () => {
  mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
  const timestamp = Math.floor(Date.now() / 1000);
  setRows([{ ...transaction, timestamp }]);
  const blockHash = '0x' + 'ef'.repeat(32);
  provider.getBlock = jest.fn(async (number: number) => ({
    number,
    hash: blockHash,
    timestamp,
  }));
  provider.getTransaction = jest
    .fn()
    .mockResolvedValue({ ...transaction, blockNumber: 51, blockHash });
  provider.getTransactionReceipt = jest
    .fn()
    .mockRejectedValueOnce(new Error('read failed'))
    .mockResolvedValue({
      from: OTHER,
      to: OWNER,
      transactionHash: HASH,
      blockNumber: 51,
      blockHash,
      status: 1,
    });
  await renderAfterSettleTime();
  expect(currentRows()[0].blockHash).toBe(transaction.blockHash);
  await act(async () => jest.advanceTimersByTimeAsync(15_000));
  expect(currentRows()[0]).toMatchObject({ blockHash, blockNumber: 51 });
});
