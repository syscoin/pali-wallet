import { configureStore } from '@reduxjs/toolkit';

import { notificationManager } from '..';
import vaultReducer from 'state/vault';

import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';
import TransactionsManager from './transactions';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

let mockStore: any;
const mockTransport = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('syscoinjs-lib', () => ({
  networks: { syscoin: {}, bitcoin: {} },
  utils: {
    fetchBackendAccount: (...args: any[]) => mockTransport(...args),
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
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: {
    cleanup: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));

const network = {
  chainId: 57,
  kind: 'syscoin',
  currency: 'sys',
  url: 'https://blockbook.invalid',
};
const pending = {
  txid: 'ab'.repeat(32),
  confirmations: 0,
  blockHeight: 0,
  blockTime: 1700000000,
  value: '100000000',
  vin: [],
  vout: [],
};
const confirmed = { ...pending, confirmations: 1, blockHeight: 100 };
const body = (transactions: any[]) => ({
  balance: transactions.length ? '100000000' : '0',
  unconfirmedBalance: '0',
  txs: transactions.filter((tx) => tx.confirmations > 0).length,
  unconfirmedTxs: transactions.filter((tx) => !tx.confirmations).length,
  transactions,
});
const rows = () =>
  mockStore.getState().vault.accountTransactions.HDAccount[0].syscoin[57];
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let controller: any;
let fixtureId = 0;
const setHistory = (transactions = [pending]) => {
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: () => ({ networkStatus: 'idle' }),
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
              xpub: `zpub-history-refresh-${++fixtureId}`,
              address: 'syscoin-fixture-address',
              label: 'History fixture',
            },
          },
        },
        accountTransactions: {
          HDAccount: { 0: { ethereum: {}, syscoin: { 57: transactions } } },
        },
      } as any,
      vaultGlobal: { networkStatus: 'idle' },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
};
const refresh = () =>
  controller.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
    forceRefresh: true,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockTransport.mockReset();
  clearFetchBackendAccountCache();
  setHistory();
  controller = Object.create(MainController.prototype);
  const manager = TransactionsManager();
  manager.utils.clearCache();
  Object.assign(controller, {
    transactionUpdateRequestId: 0,
    cancellablePromises: new CancellablePromises(),
    transactionsManager: manager,
    updateAssetsFromCurrentAccount: jest.fn().mockResolvedValue(undefined),
    updateUserNativeBalance: jest.fn().mockResolvedValue(undefined),
  });
});
afterEach(() => {
  clearFetchBackendAccountCache();
  jest.restoreAllMocks();
});

it('shares identical in-flight requests inside the five-second transport window', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  const response = deferred();
  mockTransport.mockReturnValue(response.promise);
  await controller.getLatestUpdateForCurrentAccount(true, true);
  const first =
    controller.cancellablePromises.transactionPromise.transactionPromise;
  await controller.getLatestUpdateForCurrentAccount(true, true);
  const second =
    controller.cancellablePromises.transactionPromise.transactionPromise;
  expect(mockTransport).toHaveBeenCalledTimes(1);
  response.resolve(body([confirmed]));
  await Promise.all([first, second]);
  expect(rows()[0].confirmations).toBe(1);
});

it('keeps a newer confirmation when a request beyond the transport window finishes last', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const response = deferred();
  mockTransport
    .mockReturnValueOnce(response.promise)
    .mockResolvedValueOnce(body([confirmed]));
  await controller.getLatestUpdateForCurrentAccount(true, true);
  const old =
    controller.cancellablePromises.transactionPromise.transactionPromise;
  now.mockReturnValue(7000);
  await controller.getLatestUpdateForCurrentAccount(true, true);
  await controller.cancellablePromises.transactionPromise.transactionPromise;
  expect(mockTransport).toHaveBeenCalledTimes(2);
  expect(rows()[0].confirmations).toBe(1);
  const badgeCount = jest.mocked(
    notificationManager.updatePendingTransactionBadge
  ).mock.calls.length;
  response.resolve(body([pending]));
  await old;
  expect(rows()[0].confirmations).toBe(1);
  expect(
    notificationManager.updatePendingTransactionBadge
  ).toHaveBeenCalledTimes(badgeCount);
});

it.each([false, true])(
  'clears confirmed history for validated empty history (omitted=%s)',
  async (omitted) => {
    setHistory([confirmed]);
    const response: any = body([]);
    if (omitted) delete response.transactions;
    mockTransport.mockResolvedValue(response);
    await refresh();
    expect(rows()).toEqual([]);
    expect(
      notificationManager.updatePendingTransactionBadge
    ).toHaveBeenCalledWith([]);
  }
);

it('retains locally pending history when empty remote history has not indexed it', async () => {
  mockTransport.mockResolvedValue(body([]));
  await refresh();
  expect(rows()).toEqual([pending]);
});

it.each([
  null,
  { txs: 0 },
  { error: 'backend failure', txs: 0, unconfirmedTxs: 0 },
  { txs: 1, unconfirmedTxs: 0, transactions: [] },
  { txs: 0, unconfirmedTxs: 1, transactions: [] },
  { txs: 0, unconfirmedTxs: 0, transactions: null },
])(
  'preserves confirmed history when both transport responses are invalid: %p',
  async (response) => {
    setHistory([confirmed]);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockTransport.mockResolvedValue(response);
    await expect(refresh()).rejects.toThrow(/Blockbook history response/);
    expect(rows()).toEqual([confirmed]);
    expect(
      notificationManager.updatePendingTransactionBadge
    ).not.toHaveBeenCalled();
    expect(notificationManager.notifyTransaction).not.toHaveBeenCalled();
  }
);

it('preserves history after an invalid response and accepts the next healthy refresh', async () => {
  setHistory([confirmed]);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockTransport.mockResolvedValue({ error: 'offline' });
  await expect(refresh()).rejects.toThrow(/Blockbook history response/);
  expect(rows()).toEqual([confirmed]);
  clearFetchBackendAccountCache();
  mockTransport.mockResolvedValue(body([]));
  await refresh();
  expect(rows()).toEqual([]);
});

it('preserves history after transport failure and accepts the next healthy refresh', async () => {
  setHistory([confirmed]);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockTransport.mockRejectedValue(new Error('offline'));
  await expect(refresh()).rejects.toThrow('offline');
  expect(rows()).toEqual([confirmed]);
  clearFetchBackendAccountCache();
  mockTransport.mockResolvedValue(body([]));
  await refresh();
  expect(rows()).toEqual([]);
});

it.each(['polling', 'account switch'] as const)(
  'handles a malformed detached %s history read without an unhandled rejection',
  async (origin) => {
    setHistory([confirmed]);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorLog = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockTransport.mockResolvedValue({ error: 'offline' });
    if (origin === 'polling') {
      await controller.getLatestUpdateForCurrentAccount(true, true);
    } else {
      controller.refreshActiveAccountLightweight('account switch');
    }
    // Leave detached work to its production handler. Jest fails if the
    // background promise rejects without an observer.
    await new Promise((resolve) => setImmediate(resolve));
    expect(rows()).toEqual([confirmed]);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('transaction'),
      expect.any(Error)
    );
  }
);
