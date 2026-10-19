import { combineReducers, configureStore } from '@reduxjs/toolkit';

import DAppController from '../DAppController';
import MainController from '../MainController';
import dappReducer from 'state/dapp';
import spamFilterReducer from 'state/spamFilter';
import vaultReducer, { setActiveAccount } from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import { onMessage } from './index';
import { getMethodConfig } from './method-registry';
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
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));

const HOST = 'https://connected.example';
const type = KeyringAccountType.SmartAccount;
const address = (byte: string) => `0x${byte.repeat(40)}`;
const accountA = {
  id: 0,
  label: 'Site-connected smart account',
  address: address('1'),
  xpub: address('1'),
  isSmartAccount: true,
  smartAccount: { chainId: 57057 },
};
const accountB = {
  ...accountA,
  id: 1,
  label: 'Globally active smart account',
  address: address('2'),
  xpub: address('2'),
};
const methods = [
  'wallet_requestSmartAccountModuleInstall',
  'wallet_requestSmartAccountModuleUninstall',
];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const request = (method: string) =>
  onMessage(
    {
      type: 'METHOD_REQUEST',
      data: { method, params: [{ address: address('3') }] },
    },
    { url: `${HOST}/dapp`, tab: { id: 101 } } as chrome.runtime.MessageSender
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
  const vault = vaultReducer(undefined, { type: 'test/init' });
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
        ...vault,
        isBitcoinBased: false,
        activeAccount: { id: accountB.id, type },
        activeNetwork: {
          ...vault.activeNetwork,
          kind: INetworkType.Ethereum,
          chainId: 57057,
          slip44: 60,
          url: 'https://rpc.invalid',
        },
        accounts: { ...vault.accounts, [type]: { 0: accountA, 1: accountB } },
      } as any,
      vaultGlobal: {
        ...global,
        activeSlip44: 60,
        networkStatus: 'idle',
      },
      dapp: {
        dapps: {
          [HOST]: {
            host: HOST,
            accountId: accountA.id,
            accountType: type,
            chain: INetworkType.Ethereum,
            chainId: 57057,
            date: 1,
          },
        },
      },
      spamFilter: spamFilterReducer(undefined, { type: 'test/init' }),
    } as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  const wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 7,
    assetUpdateRequestId: 0,
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    cancellablePromises: {},
    saveWalletState: jest.fn().mockResolvedValue(undefined),
    resetAutoLockTimer: jest.fn(),
    performPostAccountSwitchOperations: jest.fn().mockResolvedValue(undefined),
    isUnlocked: () => true,
  });
  mockController = { wallet, dapp: DAppController(() => true) };
});
afterEach(() => jest.restoreAllMocks());

describe.each(methods)('%s connected-account admission', (method) => {
  it('awaits the explicit switch to site account A before opening module consent', async () => {
    const selectionOpened = deferred<void>();
    const selection = deferred<void>();
    const order: string[] = [];
    expect(getMethodConfig(method)).toMatchObject({
      isBlocking: true,
      requiresConnection: true,
    });
    jest.mocked(popupPromise).mockImplementation(async (popup) => {
      if (popup.route === MethodRoute.ChangeActiveConnectedAccount) {
        order.push('selection-opened');
        expect(popup.data).toEqual({
          connectedAccount: {
            id: accountA.id,
            address: accountA.address,
            label: accountA.label,
          },
          accountType: type,
        });
        selectionOpened.resolve();
        await selection.promise;
        // Exact action awaited by ChangeConnectedAccount.handleAccept.
        await mockController.wallet.setAccount(0, type, true, accountA.address);
        order.push('selection-acknowledged');
        return null;
      }
      expect(popup.route).toBe(MethodRoute.SmartAccountModules);
      expect(mockStore.getState().vault.activeAccount).toEqual({ id: 0, type });
      expect(mockController.dapp.getAccount(HOST).address).toBe(
        accountA.address
      );
      expect(mockStore.getState().dapp.dapps[HOST].accountId).toBe(0);
      order.push('module-consent-opened');
      return { success: true };
    });
    const pending = request(method);
    await Promise.race([
      selectionOpened.promise,
      pending.then((result) => {
        throw new Error(
          `Request settled before account selection: ${JSON.stringify(result)}`
        );
      }),
    ]);
    expect(mockStore.getState().vault.activeAccount).toEqual({ id: 1, type });
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(mockController.wallet.saveWalletState).not.toHaveBeenCalled();
    selection.resolve();
    await expect(pending).resolves.toEqual({ success: true });
    expect(order).toEqual([
      'selection-opened',
      'selection-acknowledged',
      'module-consent-opened',
    ]);
    expect(mockController.wallet.saveWalletState).toHaveBeenCalledWith(
      'account-switch',
      true,
      true
    );
  });

  it('never opens module consent when the user rejects the connected-account switch', async () => {
    jest.mocked(popupPromise).mockRejectedValueOnce(new Error('User rejected'));
    await expect(request(method)).resolves.toMatchObject({
      error: { code: 4100 },
    });
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(jest.mocked(popupPromise).mock.calls[0][0].route).toBe(
      MethodRoute.ChangeActiveConnectedAccount
    );
    expect(mockStore.getState().vault.activeAccount).toEqual({ id: 1, type });
    expect(mockController.dapp.getAccount(HOST).address).toBe(accountA.address);
    expect(mockController.wallet.saveWalletState).not.toHaveBeenCalled();
  });

  it('opens module consent directly when connected account A is already active', async () => {
    mockStore.dispatch(setActiveAccount({ id: 0, type }));
    jest.mocked(popupPromise).mockResolvedValueOnce({ success: true });
    await expect(request(method)).resolves.toEqual({ success: true });
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(jest.mocked(popupPromise).mock.calls[0][0].route).toBe(
      MethodRoute.SmartAccountModules
    );
    expect(mockStore.getState().vault.activeAccount).toEqual({ id: 0, type });
    expect(mockController.dapp.getAccount(HOST).address).toBe(accountA.address);
    expect(mockController.wallet.saveWalletState).not.toHaveBeenCalled();
  });
});
