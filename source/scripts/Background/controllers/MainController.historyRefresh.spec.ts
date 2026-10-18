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
    transactionUpdateCommitId: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
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
  'keeps a forced account-switch refresh when an ordinary cached poll intervenes: %s',
  async (intervene) => {
    setHistory([confirmed]);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockTransport.mockResolvedValueOnce(body([confirmed]));
    await refresh();
    clearFetchBackendAccountCache();
    const response = deferred();
    mockTransport.mockReturnValue(response.promise);
    now.mockReturnValue(1100);
    controller.refreshActiveAccountLightweight('account switch');
    const forced =
      controller.cancellablePromises.transactionPromise.transactionPromise;
    let ordinary: Promise<void> | undefined;
    if (intervene) {
      now.mockReturnValue(1200);
      await controller.getLatestUpdateForCurrentAccount(true, true);
      ordinary =
        controller.cancellablePromises.transactionPromise.transactionPromise;
    }
    expect(mockTransport).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1300);
    response.resolve(body([{ ...confirmed, confirmations: 2 }]));
    await Promise.all([forced, ordinary]);
    expect(rows()[0].confirmations).toBe(2);
  }
);

it.each([false, true])(
  'accepts an older successful refresh after a newer forced read fails: %s',
  async (intervene) => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const response = deferred();
    mockTransport.mockReturnValueOnce(response.promise);
    controller.refreshActiveAccountLightweight('account switch');
    const forced =
      controller.cancellablePromises.transactionPromise.transactionPromise;
    if (intervene) {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      now.mockReturnValue(7000);
      mockTransport.mockResolvedValue({ error: 'offline' });
      await expect(refresh()).rejects.toThrow(/Blockbook history response/);
    }
    now.mockReturnValue(7100);
    response.resolve(body([confirmed]));
    await forced;
    expect(rows()[0].confirmations).toBe(1);
    expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(1);
    clearFetchBackendAccountCache();
    mockTransport.mockResolvedValue(body([{ ...confirmed, confirmations: 2 }]));
    await refresh();
    expect(rows()[0].confirmations).toBe(2);
    expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(1);
  }
);

it('shares a forced refresh failure with its ordinary follower and retries successfully', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const response = deferred();
  mockTransport.mockReturnValue(response.promise);
  const forced = refresh();
  const ordinary = controller.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
    isRapidPolling: true,
  });
  const rejected = Promise.allSettled([forced, ordinary]);
  response.resolve({ error: 'offline' });
  expect((await rejected).map(({ status }) => status)).toEqual([
    'rejected',
    'rejected',
  ]);
  expect(rows()).toEqual([pending]);
  clearFetchBackendAccountCache();
  mockTransport.mockResolvedValue(body([confirmed]));
  await refresh();
  expect(rows()[0].confirmations).toBe(1);
});

it.each([false, true])(
  'joins a full history read instead of a later rapid local snapshot (forced=%s)',
  async (forceRefresh) => {
    mockTransport.mockResolvedValueOnce(body([pending]));
    await refresh();
    clearFetchBackendAccountCache();
    const response = deferred();
    mockTransport.mockImplementation(
      (_url: string, _xpub: string, options: string) =>
        options.includes('details=basic')
          ? Promise.resolve(body([pending]))
          : response.promise
    );
    const forced = controller.updateUserTransactionsState({
      isBitcoinBased: true,
      activeNetwork: network,
      isPolling: true,
      forceRefresh,
    });
    const rapid = controller.updateUserTransactionsState({
      isBitcoinBased: true,
      activeNetwork: network,
      isPolling: true,
      isRapidPolling: true,
    });
    await Promise.resolve();
    expect(mockTransport).toHaveBeenCalledTimes(2);
    expect(mockTransport.mock.calls.map(([, , options]) => options)).toEqual([
      'details=txsummary&pageSize=30',
      'details=txsummary&pageSize=30',
    ]);
    response.resolve(body([confirmed]));
    await Promise.all([forced, rapid]);
    expect(rows()[0].confirmations).toBe(1);
    expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(1);
  }
);

it('fetches full history for an explicit forced rapid read despite an unchanged basic snapshot', async () => {
  mockTransport.mockResolvedValueOnce(body([pending]));
  await refresh();
  clearFetchBackendAccountCache();
  mockTransport.mockImplementation(
    (_url: string, _xpub: string, options: string) =>
      Promise.resolve(
        body(options.includes('details=basic') ? [pending] : [confirmed])
      )
  );
  await controller.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
    isRapidPolling: true,
    forceRefresh: true,
  });
  expect(mockTransport).toHaveBeenCalledTimes(2);
  expect(mockTransport.mock.calls[1][2]).toBe('details=txsummary&pageSize=30');
  expect(rows()[0].confirmations).toBe(1);
});

it.each(['older-first', 'newer-first'])(
  'keeps the newest successful history without duplicate notifications: %s',
  async (order) => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const old = deferred();
    const newer = deferred();
    mockTransport
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(newer.promise);
    const first = refresh();
    now.mockReturnValue(7000);
    const second = refresh();
    if (order === 'older-first') {
      old.resolve(body([confirmed]));
      await first;
      expect(rows()[0].confirmations).toBe(1);
      newer.resolve(body([{ ...confirmed, confirmations: 2 }]));
      await second;
    } else {
      newer.resolve(body([{ ...confirmed, confirmations: 2 }]));
      await second;
      old.resolve(body([confirmed]));
      await first;
    }
    expect(rows()[0].confirmations).toBe(2);
    expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(1);
  }
);

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
