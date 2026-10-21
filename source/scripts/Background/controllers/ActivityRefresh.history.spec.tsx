/** @jest-environment jsdom */
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { GeneralMenu } from 'components/Header/Menus/GeneralMenu';
import vaultReducer, {
  setAccounts,
  setAccountTransactions,
  setActiveAccount,
  setActiveNetwork,
  setIsBitcoinBased,
} from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';

import MasterController from './index';
import { CancellablePromises } from './promises/cancellablesPromises';
import TransactionsManager from './transactions';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

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
jest.mock('./MainController', () => ({
  __esModule: true,
  default: jest.fn(() => mockController),
}));
jest.mock('./DAppController', () => ({
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
jest.mock('./transactions/evm', () => ({
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
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: ([method]: string[]) => mockMaster[method](),
  }),
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
}));

const RealMainController = jest.requireActual('./MainController').default;
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

it.each([7000, 62000])(
  'the normal Refresh button requests current history at time %d',
  async (now) => {
    mockTransport
      .mockResolvedValueOnce(body([first]))
      .mockResolvedValue(body([second, first]));
    await mockController.updateUserTransactionsState({
      isBitcoinBased: true,
      activeNetwork: network,
      isPolling: true,
    });
    expect(mockTransport).toHaveBeenCalledTimes(1);
    expect(currentRows().map((tx: any) => tx.txid)).toEqual([first.txid]);
    jest.mocked(Date.now).mockReturnValue(now);
    render(
      <Provider store={mockStore}>
        <GeneralMenu />
      </Provider>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'header.refresh' }));
      await mockController.cancellablePromises.transactionPromise
        .transactionPromise;
    });
    expect(mockTransport).toHaveBeenCalledTimes(2);
    expect(currentRows().map((tx: any) => tx.txid)).toContain(second.txid);
  }
);

it('the existing explicit forced history path bypasses the young completed cache', async () => {
  mockTransport
    .mockResolvedValueOnce(body([first]))
    .mockResolvedValue(body([second, first]));
  await mockController.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
  });
  jest.mocked(Date.now).mockReturnValue(7000);
  await mockController.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
    forceRefresh: true,
  });
  expect(mockTransport).toHaveBeenCalledTimes(2);
  expect(currentRows().map((tx: any) => tx.txid)).toContain(second.txid);
});

it('routine polling retains the completed history cache inside its lifetime', async () => {
  mockTransport
    .mockResolvedValueOnce(body([first]))
    .mockResolvedValue(body([second, first]));
  await mockController.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
  });
  jest.mocked(Date.now).mockReturnValue(7000);
  await mockController.getLatestUpdateForCurrentAccount(true);
  await mockController.cancellablePromises.transactionPromise
    .transactionPromise;
  expect(mockTransport).toHaveBeenCalledTimes(1);
  expect(currentRows().map((tx: any) => tx.txid)).toEqual([first.txid]);
});

it('repeated explicit refreshes share the existing in-flight transport', async () => {
  mockTransport.mockResolvedValueOnce(body([first]));
  await mockController.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
  });
  jest.mocked(Date.now).mockReturnValue(7000);
  let finish!: (value: any) => void;
  mockTransport.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  render(
    <Provider store={mockStore}>
      <GeneralMenu />
    </Provider>
  );
  let firstRead: Promise<void>;
  let secondRead: Promise<void>;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'header.refresh' }));
    firstRead =
      mockController.cancellablePromises.transactionPromise.transactionPromise;
    fireEvent.click(screen.getByRole('button', { name: 'header.refresh' }));
    secondRead =
      mockController.cancellablePromises.transactionPromise.transactionPromise;
    expect(mockTransport).toHaveBeenCalledTimes(2);
    finish(body([second, first]));
    await Promise.all([firstRead, secondRead]);
  });
  expect(mockTransport).toHaveBeenCalledTimes(2);
  expect(currentRows().map((tx: any) => tx.txid)).toContain(second.txid);
});

it('repeated explicit EVM refreshes share one current explorer read', async () => {
  const address = `0x${'11'.repeat(20)}`;
  const evmNetwork = {
    chainId: 1,
    kind: 'ethereum',
    currency: 'eth',
    url: 'https://rpc.synthetic.invalid',
    apiUrl: 'https://explorer.synthetic.invalid/api',
  };
  const evmFirst = {
    hash: `0x${'ab'.repeat(32)}`,
    from: address,
    to: `0x${'22'.repeat(20)}`,
    chainId: 1,
    value: '1',
    nonce: 1,
    input: '0x',
    blockNumber: 100,
    confirmations: 1,
    timestamp: 1700000000,
    // eslint-disable-next-line camelcase -- Explorer API field.
    txreceipt_status: '1',
  };
  const evmSecond = {
    ...evmFirst,
    hash: `0x${'cd'.repeat(32)}`,
    nonce: 2,
    blockNumber: 101,
  };
  mockStore.dispatch(
    setAccounts({
      ...mockStore.getState().vault.accounts,
      HDAccount: {
        0: {
          id: 0,
          address,
          label: 'Public EVM fixture',
          balances: { ethereum: '1', syscoin: '0' },
        },
      },
    })
  );
  mockStore.dispatch(setActiveNetwork(evmNetwork as any));
  mockStore.dispatch(setIsBitcoinBased(false));
  mockStore.dispatch(
    setAccountTransactions({
      accountType: 'HDAccount' as any,
      accountId: 0,
      networkType: 'ethereum' as any,
      chainId: 1,
      transactions: [evmFirst] as any,
    })
  );
  Object.defineProperty(mockController, 'ethereumTransaction', {
    value: { web3Provider: {} },
  });
  mockEvmPolling.mockResolvedValueOnce([evmFirst]);
  await mockController.updateUserTransactionsState({
    isBitcoinBased: false,
    activeNetwork: evmNetwork,
    isPolling: true,
  });
  expect(mockEvmPolling).toHaveBeenCalledTimes(1);
  jest.mocked(Date.now).mockReturnValue(7000);
  let finish!: (rows: any[]) => void;
  mockEvmPolling.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  render(
    <Provider store={mockStore}>
      <GeneralMenu />
    </Provider>
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'header.refresh' }));
    const firstRead =
      mockController.cancellablePromises.transactionPromise.transactionPromise;
    fireEvent.click(screen.getByRole('button', { name: 'header.refresh' }));
    const secondRead =
      mockController.cancellablePromises.transactionPromise.transactionPromise;
    finish([evmSecond, evmFirst]);
    await Promise.all([firstRead, secondRead]);
  });
  expect(mockEvmPolling).toHaveBeenCalledTimes(2);
  expect(
    mockStore
      .getState()
      .vault.accountTransactions.HDAccount[0].ethereum[1].map(
        (tx: any) => tx.hash
      )
  ).toContain(evmSecond.hash);
});

it.each(['account', 'network'] as const)(
  'ignores an explicit refresh completion after the %s changes',
  async (changed) => {
    let finish!: (value: any) => void;
    mockTransport.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(
      <Provider store={mockStore}>
        <GeneralMenu />
      </Provider>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'header.refresh' }));
      const pending =
        mockController.cancellablePromises.transactionPromise
          .transactionPromise;
      if (changed === 'account') {
        mockStore.dispatch(
          setAccounts({
            ...mockStore.getState().vault.accounts,
            HDAccount: {
              ...mockStore.getState().vault.accounts.HDAccount,
              1: {
                id: 1,
                xpub: 'zpub-other-public-account',
                address: 'other-public-address',
                balances: { syscoin: '1', ethereum: '0' },
              },
            },
          })
        );
        mockStore.dispatch(
          setActiveAccount({ type: 'HDAccount' as any, id: 1 })
        );
      } else {
        mockStore.dispatch(
          setActiveNetwork({
            ...network,
            url: 'https://other-blockbook.invalid',
          } as any)
        );
      }
      finish(body([second, first]));
      await pending;
    });
    expect(currentRows().map((tx: any) => tx.txid)).toEqual([first.txid]);
    if (changed === 'account') {
      expect(mockStore.getState().vault.activeAccount.id).toBe(1);
      expect(
        mockStore.getState().vault.accountTransactions.HDAccount[1]
          ?.syscoin?.[57] || []
      ).toEqual([]);
    }
    expect(mockTransport).toHaveBeenCalledTimes(1);
  }
);
