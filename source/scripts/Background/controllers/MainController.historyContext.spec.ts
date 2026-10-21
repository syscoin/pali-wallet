import { configureStore } from '@reduxjs/toolkit';

import { notificationManager } from '..';
import vaultReducer, { setActiveAccount, setActiveNetwork } from 'state/vault';
import { KeyringAccountType } from 'types/network';

import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';

let mockStore: any;
const mockDispatch = jest.fn((action: any) => mockStore.dispatch(action));

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockDispatch(action),
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

const ADDRESS = `0x${'11'.repeat(20)}`;
const type = KeyringAccountType.HDAccount;
const network = {
  chainId: 5700,
  kind: 'ethereum',
  url: 'https://rpc.example',
  apiUrl: 'https://explorer-a.example/api',
};
const row = (digit: string, blockNumber: number) => ({
  hash: `0x${digit.repeat(64)}`,
  from: ADDRESS,
  to: `0x${'22'.repeat(20)}`,
  value: '1',
  nonce: blockNumber,
  blockNumber,
  blockHash: `0x${digit.repeat(64)}`,
  confirmations: 1,
  timestamp: blockNumber,
  chainId: 5700,
});
const existing = row('a', 10);
const recent = row('b', 11);
let controller: any;
let fetchHistory: jest.Mock;

const rows = () =>
  mockStore.getState().vault.accountTransactions[type][0].ethereum[5700];
const refresh = (isBitcoinBased = false) =>
  controller.updateUserTransactionsState({
    isBitcoinBased,
    activeNetwork: mockStore.getState().vault.activeNetwork,
    isPolling: true,
  });
const deferred = () => {
  let resolve!: (value: any[]) => void;
  const promise = new Promise<any[]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flushExecutor = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer },
    preloadedState: {
      vault: {
        ...initial,
        activeAccount: { type, id: 0 },
        activeNetwork: network,
        accounts: {
          ...initial.accounts,
          [type]: {
            0: {
              address: ADDRESS,
              label: 'Original',
              // This shared fixture also exercises UTXO history, whose owner is its xpub.
              xpub: 'vpub5YRRorZVvAATHuEEHuFw1sBdoTr86WAbRqErEmc37QW5GQdJ6QT2iARGALeCtcpVRmFdR1PQ4BFAuCNPy6Rv4tqSLNHpbaCNDAF4K549MT1',
            },
            1: { address: `0x${'33'.repeat(20)}`, label: 'Second' },
          },
        },
        accountTransactions: {
          [type]: {
            0: { ethereum: { 5700: [existing] }, syscoin: {} },
            1: { ethereum: { 5700: [] }, syscoin: {} },
          },
        },
      } as any,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  fetchHistory = jest.fn();
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    cancellablePromises: new CancellablePromises(),
    transactionsManager: {
      utils: { updateTransactionsFromCurrentAccount: fetchHistory },
    },
    refreshBalancesAfterHistory: jest.fn(),
    reconcileLocalPendingEvmSmartAccountTransactions: jest
      .fn()
      .mockResolvedValue(undefined),
  });
});

it('commits a healthy current explorer response through the real vault reducer', async () => {
  fetchHistory.mockResolvedValue([existing, recent]);
  await refresh();
  expect(rows().map(({ hash }: any) => hash)).toContain(recent.hash);
  expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(1);
  expect(
    notificationManager.updatePendingTransactionBadge
  ).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ hash: recent.hash })])
  );
});

it('keeps cached EVM history when its reader returns an empty result', async () => {
  fetchHistory.mockResolvedValue([]);
  await refresh();
  expect(rows()).toEqual([existing]);
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(
    notificationManager.updatePendingTransactionBadge
  ).toHaveBeenCalledTimes(1);
  expect(
    notificationManager.updatePendingTransactionBadge
  ).toHaveBeenCalledWith([existing]);
});

it('retains history after a rejected read and accepts the next current response', async () => {
  fetchHistory.mockRejectedValueOnce(new Error('offline'));
  await expect(refresh()).rejects.toThrow('offline');
  expect(rows()).toEqual([existing]);
  expect(
    notificationManager.updatePendingTransactionBadge
  ).not.toHaveBeenCalled();
  fetchHistory.mockResolvedValueOnce([existing, recent]);
  await refresh();
  expect(rows().map(({ hash }: any) => hash)).toContain(recent.hash);
});

it('retires a superseded same-context response before history and notifications change', async () => {
  const old = deferred();
  fetchHistory
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([existing, recent]);
  const older = refresh();
  await refresh();
  const dispatchCount = mockDispatch.mock.calls.length;
  const badgeCount = jest.mocked(
    notificationManager.updatePendingTransactionBadge
  ).mock.calls.length;
  const noticeCount = jest.mocked(notificationManager.notifyTransaction).mock
    .calls.length;
  old.resolve([existing]);
  await older;
  expect(rows().map(({ hash }: any) => hash)).toContain(recent.hash);
  expect(mockDispatch).toHaveBeenCalledTimes(dispatchCount);
  expect(
    notificationManager.updatePendingTransactionBadge
  ).toHaveBeenCalledTimes(badgeCount);
  expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(
    noticeCount
  );
});

it.each([{ unusable: [] }, { unusable: undefined }])(
  'does not discard a successful EVM read behind a later unusable result: %p',
  async ({ unusable }) => {
    const old = deferred();
    fetchHistory
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(unusable);
    const first = refresh();
    await refresh();
    old.resolve([existing, recent]);
    await first;
    expect(rows().map(({ hash }: any) => hash)).toContain(recent.hash);
    expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(1);
  }
);

it.each(['walletSessionGeneration', 'networkRequestGeneration'])(
  'cannot revive an orphaned read after a failed round-trip refresh changes %s',
  async (generation) => {
    const old = deferred();
    fetchHistory
      .mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce(new Error('offline'));
    const first = refresh();
    controller[generation] += 1;
    mockStore.dispatch(
      setActiveNetwork({ ...network, url: 'https://temporary.example' } as any)
    );
    await expect(refresh()).rejects.toThrow('offline');
    // The cancellable slot now belongs to the failed second read, not first.
    controller[generation] += 1;
    mockStore.dispatch(setActiveNetwork(network as any));
    old.resolve([existing, recent]);
    await first;
    expect(rows()).toEqual([existing]);
    expect(notificationManager.notifyTransaction).not.toHaveBeenCalled();
    expect(
      notificationManager.updatePendingTransactionBadge
    ).not.toHaveBeenCalled();
  }
);

it('retires a cancelled old explorer reply after an API-only switch without overwriting current history', async () => {
  const old = deferred();
  fetchHistory
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([existing, recent]);
  const cancelled = refresh().catch((error: unknown) => error);

  // setActiveNetwork cancels this same wrapper before updating the network.
  controller.cancellablePromises.transactionPromise.cancel();
  expect(await cancelled).toBe('Cancel by network changing');
  mockStore.dispatch(
    setActiveNetwork({
      ...network,
      apiUrl: 'https://explorer-b.example/api',
    } as any)
  );
  await refresh();
  expect(rows().map(({ hash }: any) => hash)).toContain(recent.hash);
  const dispatchCount = mockDispatch.mock.calls.length;
  const badgeCount = jest.mocked(
    notificationManager.updatePendingTransactionBadge
  ).mock.calls.length;
  const noticeCount = jest.mocked(notificationManager.notifyTransaction).mock
    .calls.length;

  old.resolve([existing]);
  await flushExecutor();
  expect(fetchHistory).toHaveBeenCalledTimes(2);
  expect(mockStore.getState().vault.activeNetwork.apiUrl).toBe(
    'https://explorer-b.example/api'
  );
  expect(rows().map(({ hash }: any) => hash)).toContain(recent.hash);
  expect(mockDispatch).toHaveBeenCalledTimes(dispatchCount);
  expect(
    notificationManager.updatePendingTransactionBadge
  ).toHaveBeenCalledTimes(badgeCount);
  expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(
    noticeCount
  );
});

it.each(['account', 'rpc'] as const)(
  'already retires a cancelled history reply after a changed %s',
  async (changed) => {
    const old = deferred();
    fetchHistory.mockReturnValueOnce(old.promise);
    const cancelled = refresh().catch((error: unknown) => error);
    controller.cancellablePromises.transactionPromise.cancel();
    expect(await cancelled).toBe('Cancel by network changing');
    if (changed === 'account') {
      mockStore.dispatch(setActiveAccount({ type, id: 1 }));
    } else {
      mockStore.dispatch(
        setActiveNetwork({
          ...network,
          url: 'https://other-rpc.example',
        } as any)
      );
    }
    old.resolve([existing, recent]);
    await flushExecutor();
    expect(rows()).toEqual([existing]);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(
      notificationManager.updatePendingTransactionBadge
    ).not.toHaveBeenCalled();
    expect(notificationManager.notifyTransaction).not.toHaveBeenCalled();
  }
);

it.each([
  ['added', undefined, network.apiUrl],
  ['removed', network.apiUrl, undefined],
] as const)(
  'retires an old response when the explorer API is %s',
  async (_name, before, after) => {
    mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: before } as any));
    const old = deferred();
    fetchHistory.mockReturnValueOnce(old.promise);
    const pending = refresh();
    mockStore.dispatch(setActiveNetwork({ ...network, apiUrl: after } as any));
    old.resolve([existing, recent]);
    await pending;
    expect(rows()).toEqual([existing]);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(
      notificationManager.updatePendingTransactionBadge
    ).not.toHaveBeenCalled();
  }
);

it('does not revive a cancelled A request after an A to B to A explorer round trip', async () => {
  const old = deferred();
  fetchHistory.mockReturnValueOnce(old.promise);
  const cancelled = refresh().catch((error: unknown) => error);
  controller.cancellablePromises.transactionPromise.cancel();
  expect(await cancelled).toBe('Cancel by network changing');
  mockStore.dispatch(
    setActiveNetwork({
      ...network,
      apiUrl: 'https://explorer-b.example/api',
    } as any)
  );
  fetchHistory.mockResolvedValueOnce([existing]);
  await refresh();
  mockStore.dispatch(setActiveNetwork(network as any));
  fetchHistory.mockResolvedValueOnce([existing, recent]);
  await refresh();
  expect(rows().map(({ hash }: any) => hash)).toContain(recent.hash);
  const dispatchCount = mockDispatch.mock.calls.length;

  old.resolve([existing]);
  await flushExecutor();
  expect(rows().map(({ hash }: any) => hash)).toContain(recent.hash);
  expect(mockDispatch).toHaveBeenCalledTimes(dispatchCount);
});

it('does not treat EVM explorer metadata as a UTXO history-source change', async () => {
  const old = deferred();
  fetchHistory.mockReturnValueOnce(old.promise);
  const pending = refresh(true);
  mockStore.dispatch(
    setActiveNetwork({
      ...network,
      apiUrl: 'https://explorer-b.example/api',
    } as any)
  );
  old.resolve([existing]);
  await pending;
  expect(
    mockStore.getState().vault.accountTransactions[type][0].syscoin[5700]
  ).toEqual([existing]);
  expect(
    notificationManager.updatePendingTransactionBadge
  ).toHaveBeenCalledTimes(1);
});
