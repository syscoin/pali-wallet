jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));

import {
  HardwareWalletManager,
  KeyringManager,
} from '@sidhujag/sysweb3-keyring';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import http from 'http';
import https from 'https';

import DAppController from '../DAppController';
import MainController from '../MainController';
import dappReducer from 'state/dapp';
import spamFilterReducer from 'state/spamFilter';
import vaultReducer, { setActiveAccount } from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import { onMessage } from './index';
import { popupPromise } from './popup-promise';
import { MethodRoute } from './types';

let mockStore: any;
let mockController: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
  notificationManager: { notifyAccountChange: jest.fn() },
}));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));

const HOST = 'https://change-address.invalid';
const hd = {
  id: 0,
  address: 'sys1synthetic-hd-0',
  xpub: 'synthetic-hd-0-public-key',
  label: 'HD account zero',
};
const hdSecond = {
  ...hd,
  id: 1,
  address: 'sys1synthetic-hd-1',
  xpub: 'synthetic-hd-1-public-key',
};
const imported = {
  id: 0,
  address: 'sys1synthetic-imported-0',
  xpub: 'sys1synthetic-imported-0',
  label: 'Imported single-address account',
  isImported: true,
};
const HD_CHANGE = 'sys1synthetic-hd-0-change';
let manager: KeyringManager;
let hardwareManager: HardwareWalletManager;
let getAddress: jest.Mock;
const request = (method: string) =>
  onMessage({ type: 'METHOD_REQUEST', data: { method, params: [] } }, {
    url: `${HOST}/page`,
    tab: { id: 101 },
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  const denyNetwork = () => {
    throw new Error('Offline change-address test attempted a network request');
  };
  jest.spyOn(http, 'request').mockImplementation(denyNetwork);
  jest.spyOn(http, 'get').mockImplementation(denyNetwork);
  jest.spyOn(https, 'request').mockImplementation(denyNetwork);
  jest.spyOn(https, 'get').mockImplementation(denyNetwork);
  jest.spyOn(globalThis, 'fetch').mockImplementation(denyNetwork);
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
  const initial = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: combineReducers({
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      dapp: dappReducer,
      spamFilter: spamFilterReducer,
    }),
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: true,
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        activeNetwork: {
          ...initial.activeNetwork,
          kind: INetworkType.Syscoin,
          chainId: 57,
          slip44: 57,
          url: 'https://utxo.invalid',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: { 0: hd, 1: hdSecond },
          Imported: { 0: imported },
        },
      },
      vaultGlobal: { ...global, activeSlip44: 57, networkStatus: 'idle' },
      dapp: {
        dapps: {
          [HOST]: {
            host: HOST,
            accountId: 0,
            accountType: KeyringAccountType.Imported,
            chain: INetworkType.Syscoin,
            chainId: 57,
            utxoAccount: { slip44: 57, xpub: imported.xpub },
            date: 1,
          },
        },
      },
      spamFilter: spamFilterReducer(undefined, { type: 'test/init' }),
    } as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  hardwareManager = new HardwareWalletManager();
  manager = new KeyringManager(hardwareManager);
  manager.setVaultStateGetter(() => mockStore.getState().vault);
  manager.isUnlocked = () => true;
  // Keep the SDK's real account/type selection; only its eventual backend
  // address lookup is deterministic and offline. Imported single-address
  // accounts are returned directly by the real SDK getter without this leaf.
  getAddress = jest.fn(async (xpub: string, isChange: boolean) => {
    expect(xpub).toBe(hd.xpub);
    expect(isChange).toBe(true);
    return HD_CHANGE;
  });
  manager.getAddress = getAddress;
  const wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    getActiveKeyring: () => manager,
    walletSessionGeneration: 0,
    assetUpdateRequestId: 0,
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    cancellablePromises: {},
    saveWalletState: jest.fn().mockResolvedValue(undefined),
    resetAutoLockTimer: jest.fn(),
    performPostAccountSwitchOperations: jest.fn().mockResolvedValue(undefined),
  });
  mockController = { wallet, dapp: DAppController(() => true) };
  jest.mocked(popupPromise).mockImplementation(async (popup) => {
    expect(popup.host).toBe(HOST);
    expect(popup.route).toBe(MethodRoute.ChangeActiveConnectedAccount);
    expect(popup.data).toMatchObject({
      accountType: KeyringAccountType.Imported,
      connectedAccount: { address: imported.address },
    });
    await wallet.setAccount(
      0,
      KeyringAccountType.Imported,
      true,
      imported.address
    );
    return null;
  });
});
afterEach(async () => {
  await manager.destroy();
  await hardwareManager.destroy();
  jest.restoreAllMocks();
});

it('keeps the wallet alias bound to the approved imported account after explicit selection', async () => {
  await expect(request('wallet_getChangeAddress')).resolves.toBe(
    imported.address
  );
  expect(popupPromise).toHaveBeenCalledTimes(1);
  expect(getAddress).not.toHaveBeenCalled();
});

it('keeps the sys alias bound to the same already-selected imported account', async () => {
  mockStore.dispatch(
    setActiveAccount({ id: 0, type: KeyringAccountType.Imported })
  );
  await expect(request('sys_getChangeAddress')).resolves.toBe(imported.address);
  expect(popupPromise).not.toHaveBeenCalled();
  expect(getAddress).not.toHaveBeenCalled();
});

it('does not return another account type change address for a matching numeric slot', async () => {
  await expect(request('sys_getChangeAddress')).resolves.toBe(imported.address);
  expect(popupPromise).toHaveBeenCalledTimes(1);
  expect(getAddress).not.toHaveBeenCalled();
});

it.each(['wallet_getChangeAddress', 'sys_getChangeAddress'])(
  'does not read a different account when %s selection is rejected',
  async (method) => {
    jest.mocked(popupPromise).mockRejectedValue(new Error('User declined'));
    await expect(request(method)).resolves.toMatchObject({
      error: { code: 4100 },
    });
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(getAddress).not.toHaveBeenCalled();
    expect(mockStore.getState().vault.activeAccount).toEqual({
      id: 0,
      type: KeyringAccountType.HDAccount,
    });
  }
);

it.each(['wallet_getChangeAddress', 'sys_getChangeAddress'])(
  'waits for explicit account-selection completion before resolving %s',
  async (method) => {
    let opened!: () => void;
    let accept!: () => void;
    const opening = new Promise<void>((resolve) => (opened = resolve));
    const accepted = new Promise<void>((resolve) => (accept = resolve));
    jest.mocked(popupPromise).mockImplementation(async (popup) => {
      expect(popup.route).toBe(MethodRoute.ChangeActiveConnectedAccount);
      opened();
      await accepted;
      await mockController.wallet.setAccount(
        0,
        KeyringAccountType.Imported,
        true,
        imported.address
      );
      return null;
    });
    let settled = false;
    const result = request(method).finally(() => {
      settled = true;
    });
    await opening;
    expect(settled).toBe(false);
    expect(getAddress).not.toHaveBeenCalled();
    expect(mockStore.getState().vault.activeAccount).toEqual({
      id: 0,
      type: KeyringAccountType.HDAccount,
    });
    accept();
    await expect(result).resolves.toBe(imported.address);
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(getAddress).not.toHaveBeenCalled();
  }
);
