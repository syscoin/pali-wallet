import { combineReducers, configureStore } from '@reduxjs/toolkit';

import DAppController from '../DAppController';
import MainController from '../MainController';
import dappReducer from 'state/dapp';
import spamFilterReducer from 'state/spamFilter';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import { onMessage } from './index';
import { clearProviderCache } from './provider-cache';

let mockStore: any;
let mockController: any;
let mockUnlocked: boolean;
const mockPersistMainStateStrict = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
  persistMainStateStrict: () => mockPersistMainStateStrict(),
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('../../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/vaultCache', () => ({
  __esModule: true,
  default: {
    emergencySave: jest.fn().mockResolvedValue(undefined),
    clearCache: jest.fn(),
  },
}));
jest.mock('utils/slhDsa/offscreenClient', () => ({
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));

const HOST = 'https://utxo-provider.invalid';
const account = {
  id: 0,
  address: 'sys1synthetic-approved-address',
  xpub: 'synthetic-approved-public-xpub',
  label: 'Synthetic approved UTXO account',
};
const request = (
  method = 'wallet_getSysProviderState',
  host = HOST,
  params?: any[]
) =>
  onMessage({ type: 'METHOD_REQUEST', data: { method, params } }, {
    url: `${host}/dapp`,
    tab: { id: 100 },
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
  clearProviderCache();
  jest.spyOn(console, 'log').mockImplementation();
  mockPersistMainStateStrict.mockResolvedValue(undefined);
  mockUnlocked = true;
  Object.assign(chrome, {
    scripting: { executeScript: jest.fn() },
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
      query: jest.fn((_query, callback) => callback([])),
    },
  });
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  const type = KeyringAccountType.HDAccount;
  mockStore = configureStore({
    reducer: combineReducers({
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      dapp: dappReducer,
      spamFilter: spamFilterReducer,
    }),
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: true,
        activeNetwork: {
          ...vault.activeNetwork,
          kind: INetworkType.Syscoin,
          chainId: 57,
          slip44: 57,
          url: 'https://utxo-backend.invalid',
        },
        activeAccount: { id: 0, type },
        accounts: { ...vault.accounts, [type]: { 0: account } },
      },
      vaultGlobal: { ...global, networkStatus: 'idle', activeSlip44: 57 },
      dapp: {
        dapps: {
          [HOST]: {
            host: HOST,
            accountId: 0,
            accountType: type,
            chain: INetworkType.Syscoin,
            chainId: 57,
            utxoAccount: { slip44: 57, xpub: account.xpub },
            date: 1,
          },
        },
      },
      spamFilter: spamFilterReducer(undefined, { type: 'test/init' }),
    } as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  const keyring = {
    isUnlocked: () => mockUnlocked,
    lockWallet: jest.fn(async () => {
      mockUnlocked = false;
    }),
  };
  const wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    getActiveKeyring: () => keyring,
    keyrings: new Map([[57, keyring]]),
    fiatQuoteGeneration: 0,
    walletSessionGeneration: 0,
    networkRequestGeneration: 0,
    clearAllTimers: jest.fn(),
    stopAutoLockTimer: jest.fn().mockResolvedValue(undefined),
    stopAllRapidPolling: jest.fn(),
  });
  mockController = {
    wallet,
    dapp: DAppController(() => wallet.isUnlocked()),
  };
});
afterEach(() => {
  clearProviderCache();
  jest.restoreAllMocks();
});

const approvedSnapshot = {
  accounts: [account.address],
  xpub: account.xpub,
  isUnlocked: true,
  isBitcoinBased: true,
};

it('keeps successive reads correct for the same connected unlocked account', async () => {
  await expect(request()).resolves.toMatchObject(approvedSnapshot);
  await expect(request()).resolves.toMatchObject(approvedSnapshot);
});

it('does not disclose a connected xpub on a cold read after actual wallet lock', async () => {
  mockController.wallet.lock();
  expect(mockController.wallet.isUnlocked()).toBe(false);
  await expect(request()).resolves.toMatchObject({
    accounts: [],
    xpub: null,
    isUnlocked: false,
  });
});

it('rechecks actual wallet lock after a warm connected provider snapshot', async () => {
  await expect(request()).resolves.toMatchObject(approvedSnapshot);
  mockController.wallet.lock();
  expect(mockController.wallet.isUnlocked()).toBe(false);
  await expect(request()).resolves.toMatchObject({
    accounts: [],
    xpub: null,
    isUnlocked: false,
  });
});

it('rechecks actual permission revocation after a warm connected provider snapshot', async () => {
  await expect(request()).resolves.toMatchObject(approvedSnapshot);
  await expect(
    request('wallet_revokePermissions', HOST, [{ eth_accounts: {} }])
  ).resolves.toBeNull();
  expect(mockPersistMainStateStrict).toHaveBeenCalledTimes(1);
  expect(mockController.dapp.isConnected(HOST)).toBe(false);
  expect(mockController.dapp.getAccount(HOST)).toBeNull();
  await expect(request()).resolves.toMatchObject({
    accounts: [],
    xpub: null,
    isUnlocked: true,
  });
});

it('never shares a warm connected snapshot with an unconnected origin', async () => {
  await expect(request()).resolves.toMatchObject(approvedSnapshot);
  await expect(
    request('wallet_getSysProviderState', 'https://other.invalid')
  ).resolves.toMatchObject({ accounts: [], xpub: null, isUnlocked: true });
});

it('returns the locked state once an old cache entry would have expired', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  await expect(request()).resolves.toMatchObject(approvedSnapshot);
  mockController.wallet.lock();
  clock.mockReturnValue(1_010_001);
  await expect(request()).resolves.toMatchObject({
    accounts: [],
    xpub: null,
    isUnlocked: false,
  });
});
