import { configureStore } from '@reduxjs/toolkit';

import { notificationManager } from '..';
import vaultReducer, {
  restoreVaultSnapshot,
  setActiveAccount,
} from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import MainController from './MainController';

let mockStore: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { notifyAccountChange: jest.fn() },
}));

const type = KeyringAccountType.HDAccount;
const address0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const address1 = `0x${'22'.repeat(20)}`;
const utxo0 = 'tsys1q6rz28mcfaxtmd6v789l9rrlrusdprr9p4ugvp5';
const utxo1 = 'tsys1qp7shgcwx3mpzgxjvff0d77vuhchcldzf37xxdm';
let wallet: any;
let actions: any[];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  actions = [];
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: false,
        activeAccount: { id: 1, type },
        activeNetwork: {
          ...vault.activeNetwork,
          kind: INetworkType.Ethereum,
          chainId: 5700,
          slip44: 60,
        },
        accounts: {
          ...vault.accounts,
          [type]: {
            0: { id: 0, address: address0, label: 'Target' },
            1: { id: 1, address: address1, label: 'Current' },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60 },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }).concat(
        () => (next) => (action) => {
          actions.push(action);
          return next(action);
        }
      ),
  });
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 10,
    assetUpdateRequestId: 20,
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    cancellablePromises: { transactionPromise: { cancel: jest.fn() } },
    saveWalletState: jest.fn().mockResolvedValue(undefined),
    resetAutoLockTimer: jest.fn(),
    performPostAccountSwitchOperations: jest.fn().mockResolvedValue(undefined),
  });
});
afterEach(() => jest.restoreAllMocks());

const replaceWithUtxoVault = () => {
  const vault = mockStore.getState().vault;
  mockStore.dispatch(
    restoreVaultSnapshot({
      ...vault,
      isBitcoinBased: true,
      activeNetwork: {
        ...vault.activeNetwork,
        kind: INetworkType.Syscoin,
        slip44: 57,
      },
      activeAccount: { id: 1, type },
      accounts: {
        ...vault.accounts,
        [type]: {
          0: { id: 0, address: utxo0, label: 'UTXO target' },
          1: { id: 1, address: utxo1, label: 'UTXO current' },
        },
      },
    })
  );
};

it.each([address0, address0.toLowerCase()])(
  'selects the approved EVM address and accepts equivalent checksum casing: %s',
  async (expected) => {
    await wallet.setAccount(0, type, true, expected);
    expect(mockStore.getState().vault.activeAccount).toEqual({ id: 0, type });
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(1);
    expect(notificationManager.notifyAccountChange).toHaveBeenCalledWith({
      address: address0,
      label: 'Target',
    });
  }
);

it('preserves ordinary three-argument account selection', async () => {
  await wallet.setAccount(0, type, false);
  expect(mockStore.getState().vault.activeAccount).toEqual({ id: 0, type });
  expect(wallet.resetAutoLockTimer).toHaveBeenCalledTimes(1);
});

it('rejects an id reused in a new vault before cancellation, selection, persistence, or notification', async () => {
  replaceWithUtxoVault();
  actions = [];
  const before = mockStore.getState();
  await expect(wallet.setAccount(0, type, true, address0)).rejects.toThrow(
    'Account context changed'
  );
  expect(mockStore.getState()).toBe(before);
  expect(actions).toEqual([]);
  expect(wallet.walletSessionGeneration).toBe(10);
  expect(wallet.assetUpdateRequestId).toBe(20);
  expect(wallet.stopAllRapidPolling).not.toHaveBeenCalled();
  expect(wallet.cancelActiveBalanceUpdate).not.toHaveBeenCalled();
  expect(
    wallet.cancellablePromises.transactionPromise.cancel
  ).not.toHaveBeenCalled();
  expect(wallet.saveWalletState).not.toHaveBeenCalled();
  expect(notificationManager.notifyAccountChange).not.toHaveBeenCalled();
});

it('validates a queued approval against the vault present after acquiring the mutex', async () => {
  let releaseSave!: () => void;
  let saving!: () => void;
  const started = new Promise<void>((resolve) => (saving = resolve));
  wallet.saveWalletState.mockImplementationOnce(() => {
    saving();
    return new Promise<void>((resolve) => (releaseSave = resolve));
  });
  const first = wallet.setAccount(1, type, true, address1);
  await started;
  const queued = wallet.setAccount(0, type, true, address0);
  const rejected = expect(queued).rejects.toThrow('Account context changed');
  replaceWithUtxoVault();
  releaseSave();
  await first;
  await rejected;
  expect(mockStore.getState().vault.accounts[type][1].address).toBe(utxo1);
  expect(mockStore.getState().vault.activeAccount).toEqual({ id: 1, type });
  expect(
    actions.filter((action) => action.type === setActiveAccount.type)
  ).toHaveLength(1);
  expect(wallet.saveWalletState).toHaveBeenCalledTimes(1);
  expect(wallet.stopAllRapidPolling).toHaveBeenCalledTimes(1);
});

it('preserves case-sensitive UTXO address comparison', async () => {
  replaceWithUtxoVault();
  const vault = mockStore.getState().vault;
  const base58 = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
  mockStore.dispatch(
    restoreVaultSnapshot({
      ...vault,
      accounts: {
        ...vault.accounts,
        [type]: {
          ...vault.accounts[type],
          0: { ...vault.accounts[type][0], address: base58 },
        },
      },
    })
  );
  await expect(
    wallet.setAccount(0, type, true, base58.toLowerCase())
  ).rejects.toThrow('Account context changed');
  expect(mockStore.getState().vault.activeAccount).toEqual({ id: 1, type });
  await wallet.setAccount(0, type, true, base58);
  expect(mockStore.getState().vault.activeAccount).toEqual({ id: 0, type });
});

it.each(['', null, 42])(
  'rejects a malformed supplied approval address: %s',
  async (expected) => {
    await expect(wallet.setAccount(0, type, true, expected)).rejects.toThrow(
      'Account context changed'
    );
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
    expect(mockStore.getState().vault.activeAccount).toEqual({ id: 1, type });
  }
);
