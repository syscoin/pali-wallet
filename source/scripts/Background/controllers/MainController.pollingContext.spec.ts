import { configureStore } from '@reduxjs/toolkit';

import vaultReducer, { setActiveNetwork } from 'state/vault';
import vaultGlobalReducer, {
  setIsPollingUpdate,
  startSwitchNetwork,
  switchNetworkError,
  switchNetworkSuccess,
} from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';

import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';

let mockStore: any;
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
  getController: () => ({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  }),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('utils/slhDsa', () => ({
  ...jest.requireActual('utils/slhDsa'),
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
}));
jest.mock('state/vaultCache', () => ({
  ...jest.requireActual('state/vaultCache'),
  __esModule: true,
  default: {
    emergencySave: jest.fn().mockResolvedValue(undefined),
    clearCache: jest.fn(),
  },
}));

const type = KeyringAccountType.HDAccount;
const firstNetwork = {
  chainId: 5700,
  kind: 'ethereum',
  url: 'https://first-rpc.invalid',
  slip44: 60,
};
const nextNetwork = {
  ...firstNetwork,
  chainId: 5701,
  url: 'https://next-rpc.invalid',
};
const deferred = () => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flushExecutor = () => new Promise((resolve) => setImmediate(resolve));
let controller: any;
let readBalance: jest.Mock;
let finishNetwork: () => void;
let failNetwork: (error: Error) => void;
let unlocked: boolean;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  unlocked = true;
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: false,
        activeAccount: { type, id: 0 },
        activeNetwork: firstNetwork,
        accounts: {
          ...vault.accounts,
          [type]: {
            0: { address: `0x${'11'.repeat(20)}`, balances: { ethereum: -1 } },
          },
        },
        accountAssets: { [type]: { 0: { ethereum: [], syscoin: [] } } },
        accountTransactions: {
          [type]: { 0: { ethereum: { 5700: [], 5701: [] }, syscoin: {} } },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60 },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  readBalance = jest.fn();
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    assetUpdateRequestId: 0,
    nativeBalanceRevision: 0,
    balanceLoadingRequestId: 0,
    networkRequestGeneration: 0,
    walletSessionGeneration: 0,
    activeRapidPolls: new Map(),
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    receiptBalanceRefresh: { cancel: jest.fn() },
    cancellablePromises: new CancellablePromises(),
    balancesManager: { utils: { getBalanceUpdatedForAccount: readBalance } },
    getActiveKeyring: () => ({
      isUnlocked: () => unlocked,
      ethereumTransaction: { web3Provider: {} },
    }),
    clearAllTimers: jest.fn(),
    lockAllKeyrings: () => {
      unlocked = false;
    },
    stopAutoLockTimer: jest.fn().mockResolvedValue(undefined),
    // Keep the real public transition/cancellation methods and reducers;
    // defer only external configuration, persistence and keyring lock I/O.
    setActiveNetworkLogic: (
      network: any,
      resolve: () => void,
      reject: (error: Error) => void
    ) => {
      mockStore.dispatch(startSwitchNetwork(network));
      finishNetwork = resolve;
      failNetwork = reject;
    },
    handleNetworkChangeSuccess: async (network: any) => {
      mockStore.dispatch(setActiveNetwork(network));
      mockStore.dispatch(switchNetworkSuccess());
    },
    handleNetworkChangeError: () => mockStore.dispatch(switchNetworkError()),
  });
});
afterEach(() => jest.restoreAllMocks());

const poll = () =>
  controller.getLatestUpdateForCurrentAccount(true, true, false, true);
const isPolling = () => mockStore.getState().vaultGlobal.isPollingUpdate;

it('clears its current early return when no polling owner has been initialized', async () => {
  expect(controller.latestUpdate).toBeUndefined();
  mockStore.dispatch(setIsPollingUpdate(true));
  unlocked = false;
  await controller.getLatestUpdateForCurrentAccount(false, true, false, true);
  expect(isPolling()).toBe(false);
  expect(readBalance).not.toHaveBeenCalled();
});

it.each(['success', 'error'])(
  'releases polling after the current read returns %s',
  async (outcome) => {
    const result = deferred();
    readBalance.mockReturnValue(result.promise);
    const request = poll();
    expect(isPolling()).toBe(true);
    if (outcome === 'success') result.resolve('2');
    else result.reject(new Error('Current read failed'));
    await request;
    expect(isPolling()).toBe(false);
  }
);

it('releases a cancelled poll when the replacement network fails without another refresh', async () => {
  const old = deferred();
  readBalance.mockReturnValue(old.promise);
  const request = poll();
  expect(isPolling()).toBe(true);
  const switching = controller.setActiveNetwork(nextNetwork);
  const failure = expect(switching).rejects.toThrow('Replacement RPC failed');
  failNetwork(new Error('Replacement RPC failed'));
  await failure;
  await request;
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('error');
  expect(isPolling()).toBe(false);
  old.resolve('99');
  await flushExecutor();
});

it('releases an old poll after the real lock path without a replacement refresh', async () => {
  const old = deferred();
  readBalance.mockReturnValue(old.promise);
  const request = poll();
  expect(isPolling()).toBe(true);
  controller.lock();
  old.resolve('99');
  await request;
  expect(unlocked).toBe(false);
  expect(isPolling()).toBe(false);
});

it('does not clear a newer current poll when an older same-context poll finishes', async () => {
  const old = deferred();
  const current = deferred();
  readBalance
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const previous = poll();
  const latest = poll();
  old.resolve('1');
  await previous;
  expect(isPolling()).toBe(true);
  current.resolve('2');
  await latest;
  expect(isPolling()).toBe(false);
});

it('preserves a pending new-network poll until its own read settles', async () => {
  const old = deferred();
  const overwritten = deferred();
  const current = deferred();
  readBalance
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(overwritten.promise)
    .mockReturnValueOnce(current.promise);
  const previous = poll();
  const replaced = controller
    .updateUserNativeBalance({
      activeAccount: mockStore.getState().vault.activeAccount,
      activeNetwork: firstNetwork,
      isBitcoinBased: false,
      isPolling: true,
    })
    .catch(() => undefined);
  const switching = controller.setActiveNetwork(nextNetwork);
  finishNetwork();
  await switching;
  await replaced;
  const latest = poll();
  old.resolve('99');
  await previous;
  expect(mockStore.getState().vault.activeNetwork.chainId).toBe(5701);
  expect(isPolling()).toBe(true);
  current.resolve('2');
  await latest;
  expect(isPolling()).toBe(false);
  overwritten.resolve('99');
  await flushExecutor();
});
