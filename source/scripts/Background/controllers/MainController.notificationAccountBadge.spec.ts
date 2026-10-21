/** Real account selection, history readers and badge helpers; only synthetic HTTP/Chrome boundaries. */
import { configureStore } from '@reduxjs/toolkit';

import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';

let mockStore: any;
let mockWallet: any;
let mockBadge = '';
let mockHistoryModes = new Map<string, 'empty' | 'pending' | 'confirmed'>();
let mockPopupOpen = false;
let mockNotificationError = false;
const mockCreated = new Map<string, any>();
const mockClicks: Array<(id: string) => void> = [];
const mockButtons: Array<(id: string, index: number) => void> = [];
const mockClosed: Array<(id: string) => void> = [];
const mockFetch = jest.fn();
const mockOpenPopup = jest.fn().mockResolvedValue(undefined);
const mockTabsCreate = jest.fn();
const mockSetBadgeText = jest.fn(async ({ text }) => {
  mockBadge = text;
});
const mockSetBadgeColor = jest.fn().mockResolvedValue(undefined);
const mockContexts = jest.fn((_query, done) =>
  done(
    mockPopupOpen
      ? [
          {
            contextType: 'POPUP',
            documentUrl: 'chrome-extension://synthetic-pali/app.html',
          },
        ]
      : []
  )
);
const mockCreate = jest.fn((id, options, done) => {
  if (mockNotificationError) {
    (global.chrome.runtime as any).lastError = {
      message: 'Synthetic OS refusal',
    };
    done(undefined);
    delete (global.chrome.runtime as any).lastError;
  } else {
    mockCreated.set(id, options);
    done(id);
  }
});
const mockClear = jest.fn((id, done) => {
  const removed = mockCreated.delete(id);
  done(removed);
});
(global as any).chrome = {
  runtime: {
    getURL: (p: string) =>
      'chrome-extension://synthetic-pali/' + p.replace(/^\//, ''),
    getContexts: mockContexts,
  },
  notifications: {
    create: mockCreate,
    clear: mockClear,
    getAll: (done: any) => done(Object.fromEntries(mockCreated)),
    onClicked: { addListener: (cb: any) => mockClicks.push(cb) },
    onButtonClicked: { addListener: (cb: any) => mockButtons.push(cb) },
    onClosed: { addListener: (cb: any) => mockClosed.push(cb) },
  },
  action: {
    openPopup: mockOpenPopup,
    setBadgeText: mockSetBadgeText,
    setBadgeBackgroundColor: mockSetBadgeColor,
  },
  tabs: { create: mockTabsCreate },
};
(global as any).fetch = jest.fn(() => {
  throw new Error('Public HTTP is denied');
});

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
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
jest.mock('@sidhujag/sysweb3-network', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-network'),
  retryableFetch: (...args: any[]) => mockFetch(...args),
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({ wallet: mockWallet }),
  notificationManager: jest.requireActual(
    'scripts/Background/notification-manager'
  ).notificationManager,
}));

const MainController = jest.requireActual(
  'scripts/Background/controllers/MainController'
).default;
const TransactionsManager = jest.requireActual(
  'scripts/Background/controllers/transactions'
).default;
const { CancellablePromises } = jest.requireActual(
  'scripts/Background/controllers/promises/cancellablesPromises'
);
const notifications = jest.requireActual('utils/notifications');
const A = '0x' + '11'.repeat(20),
  B = '0x' + '22'.repeat(20),
  TO = '0x' + '33'.repeat(20);
const CHAIN = 10; // Real supported EVM chain; production intentionally excludes its RPC scan.
const network = {
  chainId: CHAIN,
  kind: 'ethereum',
  currency: 'eth',
  label: 'Synthetic Optimism',
  slip44: 60,
  url: 'https://rpc.synthetic.invalid',
  apiUrl: 'https://explorer.synthetic.invalid/api',
};
const rawRow = (address: string, confirmed: boolean) => ({
  hash: '0x' + (address === A ? 'a' : 'b').repeat(64),
  from: address,
  to: TO,
  value: '1',
  nonce: '0',
  input: '0x',
  timeStamp: '1700000000',
  blockNumber: confirmed ? '100' : '0',
  blockHash: confirmed ? '0x' + 'c'.repeat(64) : null,
  confirmations: confirmed ? '1' : '0',
  gas: '21000',
  gasPrice: '1',
});
const flush = () => new Promise<void>((done) => setImmediate(done));
const refresh = async () => {
  await mockWallet.updateUserTransactionsState({
    isBitcoinBased: false,
    activeNetwork: mockStore.getState().vault.activeNetwork,
    isPolling: true,
    forceRefresh: true,
  });
  await flush();
};
const switchTo = async (id: number) => {
  await mockWallet.setAccount(id, 'HDAccount');
  const pending =
    mockWallet.cancellablePromises.transactionPromise?.transactionPromise;
  if (pending) await pending;
  await flush();
};
beforeEach(async () => {
  await notifications.clearAllNotifications();
  jest.clearAllMocks();
  mockBadge = '';
  mockPopupOpen = false;
  mockNotificationError = false;
  mockHistoryModes = new Map([
    [A, 'pending'],
    [B, 'empty'],
  ]);
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const globalState = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: false,
        activeNetwork: network,
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          ...vault.accounts,
          HDAccount: {
            0: {
              id: 0,
              address: A,
              label: 'Synthetic A',
              balances: { ethereum: '0' },
            },
            1: {
              id: 1,
              address: B,
              label: 'Synthetic B',
              balances: { ethereum: '0' },
            },
          },
        },
        accountTransactions: {
          HDAccount: {
            0: { ethereum: { [CHAIN]: [] }, syscoin: {} },
            1: { ethereum: { [CHAIN]: [] }, syscoin: {} },
          },
        },
      } as any,
      vaultGlobal: { ...globalState, activeSlip44: 60 },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  mockFetch.mockImplementation(async (endpoint: string) => {
    const url = new URL(String(endpoint));
    if (url.origin !== 'https://explorer.synthetic.invalid')
      throw new Error('Non-fixture endpoint denied');
    const mode = mockHistoryModes.get(url.searchParams.get('address')!);
    const action = url.searchParams.get('action');
    if (!['txlist', 'pendingtxlist', 'tokentx'].includes(action!))
      throw new Error('Non-history read denied');
    const rows =
      (mode === 'pending' && action === 'pendingtxlist') ||
      (mode === 'confirmed' && action === 'txlist')
        ? [rawRow(url.searchParams.get('address')!, mode === 'confirmed')]
        : [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: '1', message: 'OK', result: rows }),
    };
  });
  const manager = TransactionsManager();
  manager.utils.clearCache();
  mockWallet = Object.create(MainController.prototype);
  Object.assign(mockWallet, {
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    assetUpdateRequestId: 0,
    cancellablePromises: new CancellablePromises(),
    transactionsManager: manager,
    keyrings: new Map([
      [
        60,
        {
          isUnlocked: () => true,
          ethereumTransaction: {
            web3Provider: {
              getTransactionCount: jest.fn().mockResolvedValue(0),
            },
          },
        },
      ],
    ]),
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    resetAutoLockTimer: jest.fn(),
    // Suppress unrelated balance/receipt work, not history, public selection or badge code.
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(undefined),
    refreshBalancesAfterHistory: jest.fn(),
    reconcileLocalPendingEvmSmartAccountTransactions: jest
      .fn()
      .mockResolvedValue(undefined),
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  await notifications.clearAllNotifications();
  jest.restoreAllMocks();
});

it('healthy actual explorer -> manager -> MainController -> Chrome badge counts pending A', async () => {
  await refresh();
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(mockBadge).toBe('1');
  expect(mockSetBadgeColor).toHaveBeenLastCalledWith({ color: '#f59e0b' });
});
it('clears A pending badge after normal account selection completes an empty B history read', async () => {
  await refresh();
  expect(mockBadge).toBe('1');
  mockFetch.mockClear();
  await switchTo(1);
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(
    mockFetch.mock.calls.every(
      ([url]) => new URL(url).searchParams.get('address') === B
    )
  ).toBe(true);
  expect({
    active: mockStore.getState().vault.activeAccount,
    bHistory:
      mockStore.getState().vault.accountTransactions.HDAccount[1].ethereum[
        CHAIN
      ],
    badge: mockBadge,
  }).toEqual({ active: { id: 1, type: 'HDAccount' }, bHistory: [], badge: '' });
});
it('healthy normal account selection replaces A badge with B confirmed-history zero', async () => {
  await refresh();
  expect(mockBadge).toBe('1');
  mockHistoryModes.set(B, 'confirmed');
  await switchTo(1);
  expect(mockBadge).toBe('');
  expect(
    mockStore.getState().vault.accountTransactions.HDAccount[0].ethereum[CHAIN]
  ).toHaveLength(1);
  expect(
    mockStore.getState().vault.accountTransactions.HDAccount[0].ethereum[
      CHAIN
    ][0].blockNumber
  ).toBeNull();
});
it('healthy normal account selection keeps B own pending badge', async () => {
  await refresh();
  mockHistoryModes.set(B, 'pending');
  await switchTo(1);
  expect(mockBadge).toBe('1');
  expect(
    mockStore.getState().vault.accountTransactions.HDAccount[1].ethereum[
      CHAIN
    ][0].from
  ).toBe(B);
});
it('healthy same-account confirmation clears the actual pending badge', async () => {
  await refresh();
  expect(mockBadge).toBe('1');
  mockHistoryModes.set(A, 'confirmed');
  await refresh();
  expect(mockBadge).toBe('');
});
it('healthy empty same-account response preserves its locally known pending transaction and badge', async () => {
  await refresh();
  expect(mockBadge).toBe('1');
  mockHistoryModes.set(A, 'empty');
  await refresh();
  expect(
    mockStore.getState().vault.accountTransactions.HDAccount[0].ethereum[CHAIN]
  ).toHaveLength(1);
  expect(mockBadge).toBe('1');
});
it('actual registered transaction click opens wallet once and clears the matching notice', async () => {
  const id = await notifications.showTransactionNotification({
    chainId: CHAIN,
    network: network.label,
    from: A,
    to: B,
    txHash: rawRow(A, false).hash,
    type: 'pending',
  });
  expect(mockCreated.get(id).message).toContain(network.label);
  expect(mockClicks).toHaveLength(1);
  mockClicks[0](id);
  await flush();
  expect(mockOpenPopup).toHaveBeenCalledTimes(1);
  expect(mockTabsCreate).not.toHaveBeenCalled();
  expect(mockCreated.has(id)).toBe(false);
  mockClicks[0](id);
  await flush();
  expect(mockOpenPopup).toHaveBeenCalledTimes(1);
});
it('actual closed-notification listener retires click metadata', async () => {
  const id = await notifications.showNetworkChangeNotification(network.label);
  mockClosed[0](id);
  mockClicks[0](id);
  await flush();
  expect(mockOpenPopup).not.toHaveBeenCalled();
});
it('actual own popup suppresses noninteractive notifications', async () => {
  mockPopupOpen = true;
  await expect(
    notifications.showAccountChangeNotification(B, 'Synthetic B')
  ).resolves.toBeNull();
  expect(mockCreate).not.toHaveBeenCalled();
});
it('actual required-interaction error survives popup suppression and button clears it', async () => {
  mockPopupOpen = true;
  const id = await notifications.showErrorNotification(
    'Synthetic test error',
    'No secrets'
  );
  expect(mockCreated.get(id).requireInteraction).toBe(true);
  mockButtons[0](id, 0);
  await flush();
  expect(mockOpenPopup).toHaveBeenCalledTimes(1);
  expect(mockCreated.has(id)).toBe(false);
});
it('actual OS creation error does not register clickable metadata', async () => {
  mockNotificationError = true;
  await expect(
    notifications.showNetworkChangeNotification(network.label)
  ).resolves.toBeNull();
  expect(mockCreated.size).toBe(0);
  expect(mockOpenPopup).not.toHaveBeenCalled();
});
it('actual clearAll removes each created notice and retires their click actions', async () => {
  const a = await notifications.showAccountChangeNotification(A, 'Synthetic A');
  const b = await notifications.showNetworkChangeNotification(network.label);
  await notifications.clearAllNotifications();
  expect(mockCreated.size).toBe(0);
  mockClicks[0](a);
  mockClicks[0](b);
  await flush();
  expect(mockOpenPopup).not.toHaveBeenCalled();
});
