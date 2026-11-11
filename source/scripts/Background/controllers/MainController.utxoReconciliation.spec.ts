import { configureStore } from '@reduxjs/toolkit';

import {
  observeRetainedUtxo,
  reconcileRetainedUtxo,
} from '../../../wallet/utxoSubmission';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';

import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';

let mockStore: any;
const mockBackend = jest.fn((_url: string, work: () => unknown) => work());
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
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { updatePendingTransactionBadge: jest.fn() },
}));
jest.mock('../../../wallet/utxoSubmission', () => ({
  ...jest.requireActual('../../../wallet/utxoSubmission'),
  observeRetainedUtxo: jest.fn(),
  reconcileRetainedUtxo: jest.fn(),
}));
jest.mock('./providers/walletHttpIdentity', () => ({
  withWalletBackend: (url: string, work: () => unknown) =>
    mockBackend(url, work),
}));
jest.mock('utils/networkRegistration', () => ({
  ...jest.requireActual('utils/networkRegistration'),
  resolvePinnedUtxoBackendChain: () => 'main',
}));

const network = {
  chainId: 57,
  slip44: 57,
  kind: 'syscoin',
  currency: 'sys',
  url: 'https://blockbook.invalid',
};
const account = { id: 0, type: 'HDAccount', xpub: 'zpub-fixture' };
const owner = { chainId: 57, slip44: 57, genesisHash: 'a'.repeat(64), account };
const mockReconcile = jest.mocked(reconcileRetainedUtxo);
const mockObserve = jest.mocked(observeRetainedUtxo);
const originalFetch = globalThis.fetch;
const flush = () => new Promise((resolve) => setImmediate(resolve));
let wallet: any;
let records: { list: jest.Mock };
let signing: any;

beforeEach(() => {
  jest.clearAllMocks();
  mockReconcile.mockReset().mockResolvedValue(undefined);
  mockObserve.mockReset().mockResolvedValue('confirmed');
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: true,
        activeNetwork: network,
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          ...initial.accounts,
          HDAccount: { 0: { ...account, address: 'syscoin-address' } },
        },
        accountTransactions: {
          HDAccount: { 0: { syscoin: { 57: [] }, ethereum: {} } },
        },
      } as any,
    },
    middleware: (defaults) => defaults({ serializableCheck: false }),
  });
  wallet = Object.create(MainController.prototype);
  signing = {
    context: { account },
    keyring: {},
    assertWalletReviewCurrent: jest.fn(() => {
      if (wallet.walletSessionGeneration !== 0)
        throw new Error('Wallet owner changed');
    }),
  };
  records = { list: jest.fn().mockResolvedValue([]) };
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    cancellablePromises: new CancellablePromises(),
    transactionsManager: {
      utils: {
        updateTransactionsFromCurrentAccount: jest.fn().mockResolvedValue([]),
      },
    },
    isUnlocked: jest.fn().mockReturnValue(true),
    captureUtxoSigningContext: jest.fn().mockReturnValue(signing),
    utxoRecordOwner: jest.fn().mockReturnValue(owner),
    getRetainedUtxoRecords: jest.fn().mockReturnValue(records),
    activityNotificationObserver: () => ({ history: () => [] }),
  });
  globalThis.fetch = jest.fn().mockResolvedValue({ ok: true });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const refresh = (isRapidPolling = false) =>
  wallet.updateUserTransactionsState({
    isBitcoinBased: true,
    activeNetwork: network,
    isPolling: true,
    isRapidPolling,
  });

it('reconciles the captured saved-list owner before returning the refreshed list', async () => {
  let release!: () => void;
  mockReconcile.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const result = wallet.refreshRetainedUtxoTransfers();
  await flush();
  expect(records.list).not.toHaveBeenCalled();
  expect(mockReconcile).toHaveBeenCalledWith(
    expect.objectContaining({
      records,
      owner,
      backendChain: 'main',
      session: expect.objectContaining({ keyring: signing.keyring }),
    })
  );
  release();
  await expect(result).resolves.toEqual([]);
  expect(wallet.captureUtxoSigningContext).toHaveBeenCalledTimes(1);
  expect(records.list).toHaveBeenCalledWith(
    expect.objectContaining({ keyring: signing.keyring }),
    owner
  );
});

it('uses only the existing guarded GET transport and retires its read owner', async () => {
  mockReconcile.mockImplementation(async (request) => {
    const url = 'https://original.invalid/api/v2/tx/' + 'a'.repeat(64);
    await request.fetch(url, { method: 'GET', signal: request.signal });
    await expect(request.fetch(url, { method: 'POST' })).rejects.toThrow(
      'Invalid saved UTXO status request'
    );
    expect(mockBackend).toHaveBeenCalledWith(url, expect.any(Function));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  await wallet.refreshRetainedUtxoTransfers();
  const request = mockReconcile.mock.calls[0][0];
  expect(request.signal.aborted).toBe(true);
  expect(wallet.activeUtxoReads.size).toBe(0);
});

it.each([
  { unlocked: false, rapid: false, count: 0 },
  { unlocked: false, rapid: true, count: 0 },
  { unlocked: true, rapid: true, count: 0 },
  { unlocked: true, rapid: false, count: 1 },
])(
  'limits ordinary refresh to unlocked non-rapid UTXO reads: %j',
  async ({ unlocked, rapid, count }) => {
    wallet.isUnlocked.mockReturnValue(unlocked);
    await refresh(rapid);
    await flush();
    expect(mockReconcile).toHaveBeenCalledTimes(count);
    expect(wallet.captureUtxoSigningContext).toHaveBeenCalledTimes(count);
    expect(wallet.getRetainedUtxoRecords).toHaveBeenCalledTimes(count);
    expect(
      mockStore.getState().vaultGlobal.transactionHistoryStatus.state
    ).toBe('ready');
  }
);

it('does not delay or fail valid history when retained-record reconciliation fails', async () => {
  let fail!: (error: Error) => void;
  mockReconcile.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  await refresh();
  expect(mockStore.getState().vaultGlobal.transactionHistoryStatus.state).toBe(
    'ready'
  );
  fail(new Error('Temporary retained-record read failure'));
  await flush();
  expect(mockStore.getState().vaultGlobal.transactionHistoryStatus.state).toBe(
    'ready'
  );
});

it('reloads the stored list after an explicit check without a second status probe', async () => {
  await expect(wallet.checkRetainedUtxoTransfer('a'.repeat(64))).resolves.toBe(
    'confirmed'
  );
  await expect(wallet.listRetainedUtxoTransfers()).resolves.toEqual([]);
  expect(mockObserve).toHaveBeenCalledTimes(1);
  expect(mockReconcile).not.toHaveBeenCalled();
  expect(records.list).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(['rapid-polls', 'history-cancel', 'ordinary-poll'] as const)(
  'keeps a slow retained pass alive across same-scope %s',
  async (boundary) => {
    let release!: () => void;
    mockReconcile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    await refresh();
    const request = mockReconcile.mock.calls[0][0];
    expect(request.signal.aborted).toBe(false);
    if (boundary === 'history-cancel')
      wallet.cancellablePromises.transactionPromise.cancel();
    if (boundary === 'rapid-polls') {
      for (let index = 0; index < 4; index++) await refresh(true);
    }
    if (boundary === 'ordinary-poll') await refresh();
    expect(request.signal.aborted).toBe(false);
    expect(() => request.session.assertCurrent()).not.toThrow();
    await request.fetch('https://original.invalid/api/v2/', {
      method: 'GET',
      signal: request.signal,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(request.signal.aborted).toBe(true);
  }
);

it('aborts a retained pass when the wallet owner changes and refuses late transport', async () => {
  let release!: () => void;
  mockReconcile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  await refresh();
  const request = mockReconcile.mock.calls[0][0];
  wallet.advanceWalletSession();
  expect(request.signal.aborted).toBe(true);
  await expect(
    request.fetch('https://original.invalid/api/v2/', {
      method: 'GET',
      signal: request.signal,
    })
  ).rejects.toThrow();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  release();
  await flush();
});
