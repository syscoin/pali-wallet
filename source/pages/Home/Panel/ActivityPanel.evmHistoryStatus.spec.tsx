/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
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
  EvmTransactionsList: ({ userTransactions }: any) => (
    <div>{userTransactions.map((tx: any) => tx.hash).join(',')}</div>
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
let mode: 'empty' | 'failed';
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
const response = (status: number) =>
  ({
    ok: status === 200,
    status,
    statusText: status === 200 ? 'OK' : 'Synthetic history failure',
    text: async () => 'Synthetic history failure',
    json: async () => ({ status: '1', message: 'OK', result: [] }),
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
    return response(responseMode === 'failed' ? 500 : 200);
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

it('shows the ordinary empty state after healthy configured explorer feeds', async () => {
  await expect(fetchInitial()).resolves.toBeUndefined();
  expect(reads).toEqual(['txlist', 'pendingtxlist', 'tokentx']);
  await renderAfterSettleTime();
  expect(screen.getByText('home.youHaveNoTxs')).toBeVisible();
  expect(currentRows()).toEqual([]);
});

it('keeps failed configured EVM history visibly retryable instead of claiming empty', async () => {
  mode = 'failed';
  await expect(fetchInitial()).rejects.toThrow('Transaction API error');
  expect(reads).toEqual(['txlist', 'pendingtxlist', 'tokentx']);
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('idle');
  await renderAfterSettleTime();
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
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
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(currentRows()).toEqual([transaction]);
});

it('retains the no-API healthy RPC fallback and ordinary empty state', async () => {
  mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: undefined }));
  await expect(fetchInitial()).resolves.toBeUndefined();
  expect(reads).toEqual([]);
  expect(provider.sendBatch).toHaveBeenCalled();
  await renderAfterSettleTime();
  expect(screen.getByText('home.youHaveNoTxs')).toBeVisible();
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
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(
    screen.getByText('networkConnection.loadingTransactions')
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeDisabled();
  // The timer assertion is complete. Let the real finite RPC fallback's
  // existing inter-batch waits run normally after the held explorer settles.
  jest.useRealTimers();
  await act(async () => {
    pending.resolve();
    await read;
  });
  expect(screen.getByText('home.youHaveNoTxs')).toBeVisible();
  expect(mockStore.getState().vaultGlobal.transactionHistoryStatus.state).toBe(
    'ready'
  );
});

it('retries the current failed explorer read from its normal button and coalesces duplicate clicks', async () => {
  mode = 'failed';
  await expect(fetchInitial()).rejects.toThrow('Transaction API error');
  await renderAfterSettleTime();
  jest.useRealTimers();
  const pending = deferred();
  mode = 'empty';
  hold = pending.promise;
  let retry!: Promise<void>;
  await act(async () => {
    const button = screen.getByRole('button', { name: 'receive.retry' });
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
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeDisabled();
  await act(async () => {
    pending.resolve();
    await retry;
  });
  expect(screen.getByText('home.youHaveNoTxs')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'receive.retry' })).toBeNull();
  expect(mockWallet.historyRetry).toBeUndefined();
});

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
  const rejected = expect(oldRead).rejects.toThrow('Transaction API error');
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
