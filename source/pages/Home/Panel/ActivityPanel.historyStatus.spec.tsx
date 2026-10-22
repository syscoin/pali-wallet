/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import MasterController from 'scripts/Background/controllers/index';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import TransactionsManager from 'scripts/Background/controllers/transactions';
import { clearFetchBackendAccountCache } from 'scripts/Background/controllers/utils/fetchBackendAccountWrapper';
import vaultReducer, {
  setAccounts,
  setAccountTransactions,
  setActiveAccount,
  setActiveNetwork,
  setIsBitcoinBased,
} from 'state/vault';
import vaultGlobalReducer, {
  rehydrate,
  resetLoadingStates,
  setActiveSlip44,
  setHasEncryptedVault,
  setIsPollingUpdate,
  setNetworkStatus,
  setTransactionHistoryStatus,
} from 'state/vaultGlobal';
import { getWalletNavigationScope } from 'utils/navigationState';

let mockStore: any;
let mockController: any;
let mockMaster: any;
const mockTransport = jest.fn();
const mockEvmPolling = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('scripts/Background/controllers/MainController', () => ({
  __esModule: true,
  default: jest.fn(() => mockController),
}));
jest.mock('scripts/Background/controllers/DAppController', () => ({
  __esModule: true,
  default: () => ({}),
}));
jest.mock('syscoinjs-lib', () => ({
  networks: { syscoin: {}, bitcoin: {} },
  utils: { fetchBackendAccount: (...args: any[]) => mockTransport(...args) },
}));
jest.mock('syscointx-js', () => ({ bufferUtils: {} }));
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
jest.mock('scripts/Background', () => ({
  getController: () => ({ wallet: mockController }),
  notificationManager: {
    cleanup: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));
jest.mock('scripts/Background/controllers/transactions/evm', () => ({
  __esModule: true,
  default: () => ({ pollingEvmTransactions: mockEvmPolling }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '?tab=activity', hash: '' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({ useUtils: () => ({ navigate: jest.fn() }) }));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: ([target, method]: string[], params: any[] = []) =>
    method ? mockController[method](...params) : mockMaster[target](),
}));
// The panel and real history pipeline are under test; individual row rendering
// is a separate component and is represented by its exact committed txids.
jest.mock('pages/Home/Panel/components/Transactions/UTXO/UtxoList', () => ({
  UtxoTransactionsList: ({ userTransactions }: any) => (
    <div>{userTransactions.map((tx: any) => tx.txid).join(',')}</div>
  ),
}));
jest.mock('antd', () => ({ Badge: () => null }));
jest.mock('components/index', () => ({
  Icon: () => null,
  Tooltip: ({ children }: any) => children,
  AccountMenu: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  KeySvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  TrashIconSvg: () => null,
  LanguageIconSvg: () => null,
  DollarSignIconSvg: () => null,
  HelpIconSvg: () => null,
  LockIconSvg: () => null,
  ExternalLinkSvg: () => null,
}));

const RealMainController = jest.requireActual(
  'scripts/Background/controllers/MainController'
).default;
const { Provider } = jest.requireActual('react-redux');
const network = {
  chainId: 57,
  kind: 'syscoin',
  currency: 'sys',
  url: 'https://blockbook.invalid',
};
const first = {
  txid: 'ab'.repeat(32),
  confirmations: 1,
  blockHeight: 100,
  blockTime: 1700000000,
  value: '100000000',
  vin: [],
  vout: [],
};
const second = {
  ...first,
  txid: 'cd'.repeat(32),
  blockHeight: 101,
  blockTime: 1700000010,
};
const body = (transactions: any[]) => ({
  balance: '100000000',
  unconfirmedBalance: '0',
  txs: transactions.length,
  unconfirmedTxs: 0,
  transactions,
});
const currentRows = () =>
  mockStore.getState().vault.accountTransactions.HDAccount[0].syscoin[57];
let fixture = 0;
const originalChrome = global.chrome;
beforeEach(() => {
  jest.clearAllMocks();
  mockTransport.mockReset();
  mockEvmPolling.mockReset();
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  clearFetchBackendAccountCache();
  const initial = vaultReducer(undefined, { type: 'test/init' });
  const globalInitial = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      dapp: () => ({ dapps: {} }),
    },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: true,
        activeAccount: { type: 'HDAccount', id: 0 },
        activeNetwork: network,
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: {
              xpub: `zpub-manual-refresh-${++fixture}`,
              address: 'syscoin-public-address',
              label: 'Manual refresh fixture',
              balances: { syscoin: '1', ethereum: '0' },
            },
          },
        },
        accountTransactions: {
          HDAccount: { 0: { ethereum: {}, syscoin: { 57: [first] } } },
        },
      } as any,
      vaultGlobal: {
        ...globalInitial,
        networkStatus: 'idle',
        advancedSettings: { refresh: true },
      } as any,
      dapp: { dapps: {} },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  const manager = TransactionsManager();
  manager.utils.clearCache();
  mockController = Object.create(RealMainController.prototype);
  Object.assign(mockController, {
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    cancellablePromises: new CancellablePromises(),
    transactionsManager: manager,
    updateAssetsFromCurrentAccount: jest.fn().mockResolvedValue(undefined),
    updateUserNativeBalance: jest.fn().mockResolvedValue(undefined),
    initializeStartupState: jest.fn(),
    getActiveKeyring: () => ({ isUnlocked: () => true }),
    refreshBalancesAfterHistory: jest.fn(),
    reconcileLocalPendingEvmSmartAccountTransactions: jest
      .fn()
      .mockResolvedValue(undefined),
  });
  global.chrome = {
    ...originalChrome,
    tabs: { query: jest.fn().mockResolvedValue([]) },
  } as any;
  mockMaster = MasterController(mockStore);
});
afterEach(() => {
  clearFetchBackendAccountCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
});

const ActivityPanel = jest.requireActual(
  'pages/Home/Panel/ActivityPanel'
).TransactionsPanel;
const fetchInitial = () =>
  mockController.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
    forceRefresh: true,
  });
const emptyInitialHistory = () =>
  mockStore.dispatch(
    setAccountTransactions({
      accountId: 0,
      accountType: 'HDAccount' as any,
      chainId: 57,
      networkType: 'syscoin' as any,
      transactions: [],
    })
  );

it('healthy empty initial history settles to the ordinary empty message', async () => {
  emptyInitialHistory();
  mockTransport.mockResolvedValue(body([]));
  await expect(fetchInitial()).resolves.toBeUndefined();
  expect(mockTransport).toHaveBeenCalledTimes(1);
  jest.useFakeTimers();
  try {
    render(
      <Provider store={mockStore}>
        <ActivityPanel />
      </Provider>
    );
    await act(async () => jest.advanceTimersByTimeAsync(1201));
    expect(screen.getByText('home.youHaveNoTxs')).toBeTruthy();
    expect(currentRows()).toEqual([]);
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('keeps rejected initial UTXO history visibly retryable instead of empty', async () => {
  emptyInitialHistory();
  mockTransport.mockRejectedValue(
    new Error('Synthetic history endpoint unavailable')
  );
  await expect(fetchInitial()).rejects.toThrow(
    'Synthetic history endpoint unavailable'
  );
  expect(mockTransport).toHaveBeenCalledTimes(2);
  expect(mockTransport.mock.calls.map((call) => call[2])).toEqual([
    'details=txsummary&pageSize=30',
    'details=txslight&pageSize=30',
  ]);
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('idle');
  jest.useFakeTimers();
  try {
    render(
      <Provider store={mockStore}>
        <ActivityPanel />
      </Provider>
    );
    await act(async () => jest.advanceTimersByTimeAsync(1201));
    expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
    expect(screen.getByText('send.unableToLoad')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'receive.retry' })).toBeTruthy();
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('treats a malformed history response as an error, not verified empty', async () => {
  emptyInitialHistory();
  mockTransport.mockResolvedValue({ balance: '100000000' });
  await expect(fetchInitial()).rejects.toThrow(
    'Incomplete Blockbook history response'
  );
  renderPanel();
  expect(status().state).toBe('error');
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(screen.getByText('send.unableToLoad')).toBeTruthy();
});

const status = () => mockStore.getState().vaultGlobal.transactionHistoryStatus;
const renderPanel = () =>
  render(
    <Provider store={mockStore}>
      <ActivityPanel />
    </Provider>
  );
const heldRead = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it('does not classify unknown history or a completed balance poll as empty', () => {
  emptyInitialHistory();
  renderPanel();
  act(() => mockStore.dispatch(setIsPollingUpdate(true)));
  act(() => mockStore.dispatch(setIsPollingUpdate(false)));
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(screen.queryByText('send.unableToLoad')).toBeNull();
  expect(
    screen.getByText('networkConnection.loadingTransactions')
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeTruthy();
  expect(mockTransport).not.toHaveBeenCalled();
});

it('keeps a held initial read pending past the old empty-state timer', async () => {
  emptyInitialHistory();
  const held = heldRead();
  mockTransport.mockReturnValue(held.promise);
  const read = fetchInitial();
  jest.useFakeTimers();
  try {
    renderPanel();
    await act(async () => jest.advanceTimersByTimeAsync(1201));
    expect(status().state).toBe('pending');
    expect(
      screen.getByText('networkConnection.loadingTransactions')
    ).toBeTruthy();
    expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
    await act(async () => {
      held.resolve(body([]));
      await read;
    });
    expect(status().state).toBe('ready');
    expect(screen.getByText('home.youHaveNoTxs')).toBeTruthy();
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('retries only history from the ordinary error button and coalesces held requests', async () => {
  emptyInitialHistory();
  mockTransport.mockRejectedValue(new Error('Synthetic history failure'));
  await expect(fetchInitial()).rejects.toThrow('Synthetic history failure');
  const held = heldRead();
  mockTransport.mockReturnValue(held.promise);
  // A separate user action occurs after the existing transport dedup window.
  jest.mocked(Date.now).mockReturnValue(7000);
  renderPanel();
  let retry!: Promise<void>;
  await act(async () => {
    const button = screen.getByRole('button', { name: 'receive.retry' });
    fireEvent.click(button);
    fireEvent.click(button);
    retry = mockController.refreshTransactionHistory(
      getWalletNavigationScope()
    );
    expect(
      mockController.refreshTransactionHistory(getWalletNavigationScope())
    ).toBe(retry);
  });
  expect(mockTransport).toHaveBeenCalledTimes(3);
  expect(status().state).toBe('pending');
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(
    screen.getByText('networkConnection.loadingTransactions')
  ).toBeTruthy();
  expect(mockController.updateAssetsFromCurrentAccount).not.toHaveBeenCalled();
  expect(mockController.updateUserNativeBalance).not.toHaveBeenCalled();
  await act(async () => {
    held.resolve(body([]));
    await retry;
  });
  expect(screen.getByText('home.youHaveNoTxs')).toBeTruthy();
  expect(status().state).toBe('ready');
});

it('keeps a validated empty view during a routine held poll but exposes its failure', async () => {
  emptyInitialHistory();
  mockTransport.mockResolvedValue(body([]));
  await fetchInitial();
  renderPanel();
  const held = heldRead();
  mockTransport.mockReturnValue(held.promise);
  jest.mocked(Date.now).mockReturnValue(7000);
  let polling!: Promise<void>;
  await act(async () => {
    polling = fetchInitial();
  });
  expect(status().state).toBe('ready');
  expect(screen.getByText('home.youHaveNoTxs')).toBeTruthy();
  expect(
    screen.queryByText('networkConnection.loadingTransactions')
  ).toBeNull();
  await act(async () => {
    held.resolve(body([]));
    await polling;
  });
  mockTransport.mockRejectedValue(new Error('Synthetic later failure'));
  jest.mocked(Date.now).mockReturnValue(13000);
  await act(async () => {
    await expect(fetchInitial()).rejects.toThrow('Synthetic later failure');
  });
  expect(status().state).toBe('error');
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeTruthy();
});

it('preserves and renders cached rows when refreshing history fails', async () => {
  mockTransport.mockRejectedValue(new Error('Synthetic history failure'));
  await expect(fetchInitial()).rejects.toThrow('Synthetic history failure');
  renderPanel();
  expect(currentRows()).toEqual([first]);
  expect(screen.getByText(first.txid)).toBeTruthy();
  expect(screen.getByText('send.unableToLoad')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeTruthy();
});

it('does not let an older successful read hide a newer failed read', async () => {
  emptyInitialHistory();
  const held = heldRead();
  mockTransport.mockReturnValueOnce(held.promise);
  const old = fetchInitial();
  jest.mocked(Date.now).mockReturnValue(7000);
  mockTransport.mockRejectedValue(new Error('Synthetic newer failure'));
  await expect(fetchInitial()).rejects.toThrow('Synthetic newer failure');
  const failed = status();
  expect(failed.state).toBe('error');
  held.resolve(body([]));
  await old;
  expect(status()).toEqual(failed);
});

it.each([
  'account',
  'address',
  'xpub',
  'endpoint',
  'chain',
  'slip44',
  'session',
  'generation',
])('cannot publish old history/status after a changed %s', async (change) => {
  emptyInitialHistory();
  const held = heldRead();
  mockTransport.mockReturnValueOnce(held.promise);
  const old = fetchInitial();
  const originalScope = getWalletNavigationScope();
  const originalAccount = mockStore.getState().vault.accounts.HDAccount[0];
  if (change === 'account') {
    mockStore.dispatch(
      setAccounts({
        HDAccount: {
          0: originalAccount,
          1: {
            ...originalAccount,
            xpub: 'zpub-next-account',
            address: 'sys-next-account',
          },
        },
      } as any)
    );
    mockStore.dispatch(setActiveAccount({ id: 1, type: 'HDAccount' as any }));
  } else if (change === 'address' || change === 'xpub') {
    mockStore.dispatch(
      setAccounts({
        HDAccount: {
          0: {
            ...originalAccount,
            [change]: `${originalAccount[change]}-next`,
          },
        },
      } as any)
    );
  } else if (change === 'endpoint' || change === 'chain') {
    mockStore.dispatch(
      setActiveNetwork({
        ...network,
        ...(change === 'endpoint'
          ? { url: 'https://replacement.invalid' }
          : { chainId: 58 }),
      } as any)
    );
  } else if (change === 'slip44') mockStore.dispatch(setActiveSlip44(1));
  else if (change === 'session') mockController.walletSessionGeneration += 1;
  else mockController.networkRequestGeneration += 1;
  jest.mocked(Date.now).mockReturnValue(7000);
  mockTransport.mockResolvedValue(body([]));
  const activeNetwork = mockStore.getState().vault.activeNetwork;
  await mockController.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork,
    isPolling: true,
    forceRefresh: true,
  });
  const current = status();
  expect(current.state).toBe('ready');
  expect(current.scope).toEqual(getWalletNavigationScope());
  held.resolve(body([second]));
  await old;
  expect(status()).toEqual(current);
  const state = mockStore.getState();
  expect(
    state.vault.accountTransactions.HDAccount[state.vault.activeAccount.id]
      .syscoin[activeNetwork.chainId]
  ).toEqual([]);
  if (change !== 'session' && change !== 'generation')
    expect(getWalletNavigationScope()).not.toEqual(originalScope);
});

it('refuses stale-scope, locked, EVM and switching retries before transport', () => {
  const scope = getWalletNavigationScope();
  expect(() =>
    mockController.refreshTransactionHistory({ ...scope, network: 'stale' })
  ).toThrow('context changed');
  mockController.getActiveKeyring = () => ({ isUnlocked: () => false });
  expect(() => mockController.refreshTransactionHistory(scope)).toThrow(
    'context changed'
  );
  mockController.getActiveKeyring = () => ({ isUnlocked: () => true });
  mockStore.dispatch(setNetworkStatus('switching'));
  expect(() => mockController.refreshTransactionHistory(scope)).toThrow(
    'context changed'
  );
  mockStore.dispatch(setNetworkStatus('idle'));
  mockStore.dispatch(setIsBitcoinBased(false));
  expect(() => mockController.refreshTransactionHistory(scope)).toThrow(
    'context changed'
  );
  expect(mockTransport).not.toHaveBeenCalled();
});

it.each(['account', 'network'])(
  'clears cancelled pending status before returning to the same %s scope',
  async (change) => {
    emptyInitialHistory();
    const held = heldRead();
    mockTransport.mockReturnValueOnce(held.promise);
    const old = fetchInitial();
    const rejected = expect(old).rejects.toBe('Cancel by network changing');
    const originalScope = getWalletNavigationScope();
    const originalAccount = mockStore.getState().vault.accounts.HDAccount[0];
    // These are the same cancellation callback and reducer transitions used by
    // MainController.setAccount/setActiveNetwork, without signer activation.
    if (change === 'account') {
      mockStore.dispatch(
        setAccounts({
          HDAccount: {
            0: originalAccount,
            1: { ...originalAccount, xpub: 'zpub-other', address: 'sys-other' },
          },
        } as any)
      );
      mockStore.dispatch(setActiveAccount({ id: 1, type: 'HDAccount' as any }));
    } else
      mockStore.dispatch(
        setActiveNetwork({ ...network, url: 'https://other.invalid' } as any)
      );
    mockController.cancellablePromises.transactionPromise.cancel();
    await rejected;
    if (change === 'account')
      mockStore.dispatch(setActiveAccount({ id: 0, type: 'HDAccount' as any }));
    else mockStore.dispatch(setActiveNetwork(network as any));
    expect(getWalletNavigationScope()).toEqual(originalScope);
    expect(status()).toBeUndefined();
    renderPanel();
    expect(screen.getByRole('button', { name: 'receive.retry' })).toBeTruthy();
    expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
    expect(
      screen.getByText('networkConnection.loadingTransactions')
    ).toBeTruthy();
    held.resolve(body([]));
    await Promise.resolve();
    expect(status()).toBeUndefined();
  }
);

it('preserves live rehydration status, but clears it on cold reset and wallet forget', () => {
  const history = {
    scope: getWalletNavigationScope(),
    requestId: 3,
    state: 'ready' as const,
  };
  mockStore.dispatch(setTransactionHistoryStatus(history));
  mockStore.dispatch(rehydrate(mockStore.getState().vaultGlobal));
  expect(status()).toEqual(history);
  mockStore.dispatch(resetLoadingStates());
  expect(status()).toBeUndefined();
  mockStore.dispatch(setTransactionHistoryStatus(history));
  mockStore.dispatch(setHasEncryptedVault(false));
  expect(status()).toBeUndefined();
});

it('does not change EVM empty-result semantics or publish a UTXO history status', async () => {
  const evmNetwork = { ...network, kind: 'ethereum', chainId: 1 };
  mockStore.dispatch(setActiveNetwork(evmNetwork as any));
  mockStore.dispatch(setIsBitcoinBased(false));
  Object.defineProperty(mockController, 'ethereumTransaction', {
    value: { web3Provider: {} },
  });
  mockEvmPolling.mockResolvedValue([]);
  await mockController.updateUserTransactionsState({
    isBitcoinBased: false,
    activeNetwork: evmNetwork,
    isPolling: true,
  });
  expect(mockEvmPolling).toHaveBeenCalledTimes(1);
  expect(mockTransport).not.toHaveBeenCalled();
  expect(status()).toBeUndefined();
});

it('invalidates the empty view immediately on a full navigation-scope-only change', async () => {
  emptyInitialHistory();
  mockTransport.mockResolvedValue(body([]));
  await fetchInitial();
  renderPanel();
  expect(screen.getByText('home.youHaveNoTxs')).toBeTruthy();
  act(() => mockStore.dispatch(setActiveSlip44(1)));
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeTruthy();
});

it('allows a new account retry and ignores the old account completion while it is pending', async () => {
  emptyInitialHistory();
  const firstHeld = heldRead();
  const secondHeld = heldRead();
  mockTransport
    .mockReturnValueOnce(firstHeld.promise)
    .mockReturnValueOnce(secondHeld.promise);
  renderPanel();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }))
  );
  const firstRetry = mockController.historyRetry.promise;
  const originalAccount = mockStore.getState().vault.accounts.HDAccount[0];
  await act(async () => {
    mockStore.dispatch(
      setAccounts({
        HDAccount: {
          0: originalAccount,
          1: {
            ...originalAccount,
            xpub: 'zpub-second-retry',
            address: 'sys-second-retry',
          },
        },
      } as any)
    );
    mockStore.dispatch(setActiveAccount({ id: 1, type: 'HDAccount' as any }));
  });
  const secondButton = screen.getByRole('button', { name: 'receive.retry' });
  expect(secondButton).not.toBeDisabled();
  await act(async () => fireEvent.click(secondButton));
  const secondRetry = mockController.historyRetry.promise;
  expect(secondRetry).not.toBe(firstRetry);
  expect(mockTransport).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeDisabled();
  await act(async () => {
    firstHeld.resolve(body([]));
    await firstRetry;
  });
  expect(status().state).toBe('pending');
  expect(screen.getByRole('button', { name: 'receive.retry' })).toBeDisabled();
  expect(screen.queryByText('home.youHaveNoTxs')).toBeNull();
  await act(async () => {
    secondHeld.resolve(body([]));
    await secondRetry;
  });
  expect(status().state).toBe('ready');
  expect(screen.getByText('home.youHaveNoTxs')).toBeTruthy();
});
