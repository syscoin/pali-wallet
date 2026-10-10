jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
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
  ...jest.requireActual('utils/navigationState'),
  clearNavigationState: jest.fn(
    jest.requireActual('utils/navigationState').clearNavigationState
  ),
  clearTransactionNavigationState: jest.fn(
    jest.requireActual('utils/navigationState').clearTransactionNavigationState
  ),
}));
let mockStored: any;
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn(async () => mockStored),
    setItem: jest.fn(async (_key, value) => {
      mockStored = value;
    }),
    removeItem: jest.fn(async () => {
      mockStored = undefined;
    }),
  },
}));
jest.mock('utils/evmCallBlacklist', () => ({
  getBlacklistTargetsForEvmCallWithContractType: jest
    .fn()
    .mockResolvedValue([]),
}));

import { getController } from '..';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import {
  clearNavigationState,
  clearTransactionNavigationState,
  createBrowsingNavigationContext,
  loadNavigationState,
  saveNavigationState,
} from 'utils/navigationState';

import MainController from './MainController';

it('clears popup browsing and unsigned drafts when the background locks with no UI document', () => {
  const wallet: any = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 1;
  wallet.networkRequestGeneration = 1;
  wallet.clearAllTimers = jest.fn();
  wallet.lockAllKeyrings = jest.fn();
  wallet.stopAutoLockTimer = jest.fn().mockResolvedValue(undefined);
  wallet.stopAllRapidPolling = jest.fn();
  const dispatch = jest.spyOn(store, 'dispatch').mockImplementation(jest.fn());
  (getController as jest.Mock).mockReturnValue({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  });
  try {
    wallet.lock();
    expect(wallet.walletSessionGeneration).toBe(2);
    expect(wallet.lockAllKeyrings).toHaveBeenCalledTimes(1);
    expect(clearNavigationState).toHaveBeenCalledTimes(1);
    expect(wallet.stopAllRapidPolling).toHaveBeenCalledTimes(1);
  } finally {
    dispatch.mockRestore();
  }
});

describe('transaction cleanup preserves the public browsing caller', () => {
  let wallet: any;
  let sender: jest.Mock;
  const account = { id: 0, type: KeyringAccountType.HDAccount };
  beforeEach(() => {
    jest.clearAllMocks();
    mockStored = undefined;
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(store, 'getState').mockReturnValue({
      vault: {
        activeAccount: account,
        accounts: { HDAccount: { 0: { address: '0x1234' } } },
        activeNetwork: { chainId: 1, kind: 'Ethereum', url: 'rpc-a' },
      },
      vaultGlobal: { advancedSettings: { autolock: 0 } },
    } as any);
    sender = jest
      .fn()
      .mockRejectedValue(new Error('Insufficient funds for gas fees'));
    (getController as jest.Mock).mockReturnValue({
      wallet: {
        ethereumTransaction: {
          web3Provider: {},
          sendFormattedTransaction: sender,
        },
      },
    });
    wallet = Object.create(MainController.prototype);
    wallet.getActiveKeyring = jest.fn(() => ({
      setVaultStateGetter: jest.fn(),
    }));
    wallet.sendAndSaveTransaction = jest.fn();
  });
  afterEach(() => jest.restoreAllMocks());

  it('retains Smart Account Settings and its Back destination after a no-gas error', async () => {
    await saveNavigationState(
      '/settings/account/smart-account-policy',
      undefined,
      {},
      createBrowsingNavigationContext({ pathname: '/home/smart-account' }),
      { scrollPosition: 317, scrollPositions: { 'smart-account-policy': 317 } }
    );
    await expect(
      wallet.sendAndSaveEthTransaction({ chainId: 1 }, false, account)
    ).rejects.toThrow('Insufficient funds');
    const saved = await loadNavigationState();
    expect(saved?.currentPath).toBe('/settings/account/smart-account-policy');
    expect(saved?.returnContext?.returnRoute).toBe('/home/smart-account');
    expect(saved?.scrollPositions).toEqual({ 'smart-account-policy': 317 });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(clearNavigationState).not.toHaveBeenCalled();
  });

  it('discards a failed Send draft while retaining its public caller', async () => {
    await saveNavigationState(
      '/send/eth',
      undefined,
      { formValues: { receiver: '0x1234', amount: '10' } },
      createBrowsingNavigationContext({
        pathname: '/home',
        search: '?tab=assets',
      })
    );
    await expect(
      wallet.sendAndSaveEthTransaction({ chainId: 1 }, false, account)
    ).rejects.toThrow('Insufficient funds');
    const saved = await loadNavigationState();
    expect(saved?.currentPath).toBe('/home?tab=assets');
    expect(JSON.stringify(saved)).not.toMatch(
      /formValues|receiver|amount|tx|signature/
    );
  });

  it('honors an explicit request to leave navigation alone on an error', async () => {
    await saveNavigationState('/settings/account/smart-account-policy');
    const before = JSON.stringify(mockStored);
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1 },
        false,
        account,
        undefined,
        { clearNavigation: false }
      )
    ).rejects.toThrow('Insufficient funds');
    expect(clearTransactionNavigationState).not.toHaveBeenCalled();
    expect(JSON.stringify(mockStored)).toBe(before);
  });

  it('still deletes all persisted navigation when locking without a popup', async () => {
    await saveNavigationState('/settings/account/smart-account-policy');
    Object.assign(wallet, {
      walletSessionGeneration: 1,
      networkRequestGeneration: 1,
      clearAllTimers: jest.fn(),
      lockAllKeyrings: jest.fn(),
      stopAutoLockTimer: jest.fn().mockResolvedValue(undefined),
      stopAllRapidPolling: jest.fn(),
    });
    (getController as jest.Mock).mockReturnValue({
      dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
    });
    jest.spyOn(store, 'dispatch').mockImplementation(jest.fn());
    wallet.lock();
    await Promise.resolve();
    expect(await loadNavigationState()).toBeNull();
    expect(clearNavigationState).toHaveBeenCalledTimes(1);
  });
});
