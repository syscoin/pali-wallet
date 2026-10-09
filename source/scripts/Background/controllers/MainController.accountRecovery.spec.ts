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
jest.mock('./storageManager', () => ({
  StorageManager: {
    getInstance: () => ({ ensureInitialized: async () => undefined }),
  },
}));

import { getController } from '..';
import store, * as storeModule from 'state/store';
import { KeyringAccountType } from 'types/network';
import {
  SYSCOIN_UTXO_MAINNET_NETWORK,
  SYSCOIN_MAINNET_NETWORK,
} from 'utils/constants';

import MainController from './MainController';

const vault = (incomplete = false) => ({
  accounts: {
    HDAccount: {
      0: {
        id: 0,
        address: 'saved-address',
        xpub: incomplete ? '' : 'saved-public-key',
        label: 'Saved account',
      },
      7: {
        id: 7,
        address: 'saved-address-7',
        xpub: 'saved-public-key-7',
        label: 'Sparse account',
      },
    },
  },
  accountAssets: { HDAccount: { 0: { ethereum: [{ symbol: 'SAVED' }] } } },
  accountTransactions: { HDAccount: { 0: { ethereum: { 1: ['saved-tx'] } } } },
  activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
  activeNetwork: SYSCOIN_UTXO_MAINNET_NETWORK,
});

describe('non-destructive account recovery boundaries', () => {
  let wallet: any;
  let keyring: any;
  let currentState: any;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    currentState = { vault: vault(true), vaultGlobal: { activeSlip44: 57 } };
    jest.spyOn(store, 'getState').mockImplementation(() => currentState);
    jest.spyOn(store, 'dispatch').mockImplementation((action: any) => action);
    keyring = {
      isUnlocked: jest.fn().mockReturnValue(true),
      lockWallet: jest.fn().mockResolvedValue(undefined),
      transferSessionTo: jest.fn(),
      createFirstAccount: jest.fn(),
      addNewAccount: jest.fn(),
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.lockAllKeyrings = jest.fn();
    wallet.checkRateLimit = jest.fn().mockResolvedValue(0);
    wallet.resetRateLimit = jest.fn().mockResolvedValue(undefined);
    wallet.recordFailedAttempt = jest.fn().mockResolvedValue(undefined);
    wallet.unlockKeyring = jest.fn().mockResolvedValue({ canLogin: true });
    wallet.saveWalletState = jest.fn();
    wallet.setFiat = jest.fn().mockResolvedValue(undefined);
    wallet.getLatestUpdateForCurrentAccount = jest
      .fn()
      .mockResolvedValue(undefined);
    (getController as jest.Mock).mockReturnValue({
      dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('allows a healthy sparse wallet to unlock without rebuilding any accounts', async () => {
    currentState.vault = vault();
    const snapshot = JSON.stringify(currentState.vault);
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).resolves.toBe(true);
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
    expect(keyring.createFirstAccount).not.toHaveBeenCalled();
    expect(keyring.addNewAccount).not.toHaveBeenCalled();
    expect(keyring.lockWallet).not.toHaveBeenCalled();
  });

  it('preserves all saved data and clears the unlocked session on recovery failure', async () => {
    const snapshot = JSON.stringify(currentState.vault);
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).rejects.toThrow('Account data is incomplete');
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(keyring.createFirstAccount).not.toHaveBeenCalled();
    expect(keyring.addNewAccount).not.toHaveBeenCalled();
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
  });

  it('clears a restored session when migration derivation fails without spending a password attempt', async () => {
    currentState.vault.accounts.HDAccount = {};
    currentState.vault.accountAssets.HDAccount = {};
    currentState.vault.accountTransactions.HDAccount = {};
    wallet.unlockKeyring.mockResolvedValue({
      canLogin: true,
      needsAccountCreation: true,
    });
    keyring.createFirstAccount.mockRejectedValue(
      new Error('backend unavailable')
    );
    const snapshot = JSON.stringify(currentState.vault);
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).rejects.toThrow('Failed to create account after migration');
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('does not assign orphaned HD assets/history to a newly derived identity', async () => {
    currentState.vault.accounts.HDAccount = {};
    wallet.unlockKeyring.mockResolvedValue({
      canLogin: true,
      needsAccountCreation: true,
    });
    const snapshot = JSON.stringify(currentState.vault);
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).rejects.toThrow('Account data is incomplete');
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
    expect(keyring.createFirstAccount).not.toHaveBeenCalled();
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('does not persist an incomplete backend-derived first account', async () => {
    currentState.vault.accounts.HDAccount = {};
    currentState.vault.accountAssets.HDAccount = {};
    currentState.vault.accountTransactions.HDAccount = {};
    wallet.unlockKeyring.mockResolvedValue({
      canLogin: true,
      needsAccountCreation: true,
    });
    keyring.createFirstAccount.mockResolvedValue({
      id: 0,
      address: 'new-address',
      xpub: '',
    });
    const snapshot = JSON.stringify(currentState.vault);
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).rejects.toThrow();
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('rechecks persisted records after asynchronous derivation before committing', async () => {
    currentState.vault.accounts.HDAccount = {};
    currentState.vault.accountAssets.HDAccount = {};
    currentState.vault.accountTransactions.HDAccount = {};
    wallet.unlockKeyring.mockResolvedValue({
      canLogin: true,
      needsAccountCreation: true,
    });
    const concurrentAccount = {
      id: 0,
      address: 'saved-during-derivation',
      xpub: 'saved-public-key',
    };
    keyring.createFirstAccount.mockImplementation(async () => {
      currentState.vault.accounts.HDAccount[0] = concurrentAccount;
      return { id: 0, address: 'new-address', xpub: 'new-public-key' };
    });
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).rejects.toThrow();
    expect(currentState.vault.accounts.HDAccount[0]).toBe(concurrentAccount);
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('clears startup flags when a late current-session startup step fails', async () => {
    currentState.vault = vault();
    currentState.vaultGlobal.advancedSettings = { autolock: 5 };
    wallet.startAutoLockTimer = jest
      .fn()
      .mockRejectedValue(new Error('alarm unavailable'));
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).rejects.toThrow('alarm unavailable');
    expect(wallet.justUnlocked).toBe(false);
    expect(wallet.isStartingUp).toBe(false);
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('does not let a missing active selection replace the existing default account', async () => {
    currentState.vault = vault();
    currentState.vault.activeAccount.id = 4;
    wallet.unlockKeyring.mockResolvedValue({
      canLogin: true,
      needsAccountCreation: true,
    });
    const snapshot = JSON.stringify(currentState.vault);
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).rejects.toThrow('Account data is incomplete');
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
    expect(keyring.createFirstAccount).not.toHaveBeenCalled();
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('does not clear a superseding session when a delayed startup step fails', async () => {
    wallet.resetRateLimit.mockImplementation(async () => {
      wallet.walletSessionGeneration += 1;
      throw new Error('storage unavailable');
    });
    await expect(
      wallet.unlockFromControllerExclusive('correct-password', 0)
    ).rejects.toThrow('storage unavailable');
    expect(keyring.lockWallet).not.toHaveBeenCalled();
    expect(wallet.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it.each(['incomplete identity', 'orphaned metadata'])(
    'rejects a target with %s before session transfer and restores the source vault',
    async (damage) => {
      const sourceVault = vault();
      currentState.vault = sourceVault;
      wallet.keyrings = new Map([[57, keyring]]);
      const targetKeyring = {
        isUnlocked: jest.fn().mockReturnValue(false),
        setSignerNetwork: jest.fn(),
      };
      wallet.createKeyringOnDemand = jest.fn(() => targetKeyring);
      jest
        .spyOn(storeModule, 'loadAndActivateSlip44Vault')
        .mockImplementation(async () => {
          currentState.vault = {
            ...vault(true),
            activeNetwork: SYSCOIN_MAINNET_NETWORK,
          };
          if (damage === 'orphaned metadata') {
            currentState.vault.accounts.HDAccount = {};
          }
          return true;
        });
      const rollback = jest
        .spyOn(storeModule, 'restoreSourceVaultAfterUncommittedSwitch')
        .mockImplementation((slip44, savedVault) => {
          currentState.vault = savedVault;
          currentState.vaultGlobal.activeSlip44 = slip44;
          return true;
        });

      await expect(
        wallet.switchActiveKeyring(SYSCOIN_MAINNET_NETWORK)
      ).rejects.toThrow('Account data is incomplete');
      expect(keyring.transferSessionTo).not.toHaveBeenCalled();
      expect(targetKeyring.setSignerNetwork).not.toHaveBeenCalled();
      expect(keyring.lockWallet).not.toHaveBeenCalled();
      expect(rollback).toHaveBeenCalledWith(57, sourceVault);
      expect(currentState.vault).toEqual(sourceVault);
      expect(currentState.vaultGlobal.activeSlip44).toBe(57);
    }
  );

  it('blocks a same-slip44 network update when the active HD records are incomplete', async () => {
    wallet.keyrings = new Map([[57, keyring]]);
    keyring.setSignerNetwork = jest.fn();
    const snapshot = JSON.stringify(currentState.vault);
    await expect(
      wallet.switchActiveKeyring(SYSCOIN_UTXO_MAINNET_NETWORK)
    ).rejects.toThrow('Account data is incomplete');
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
    expect(keyring.transferSessionTo).not.toHaveBeenCalled();
    expect(keyring.setSignerNetwork).not.toHaveBeenCalled();
  });

  it.each(['lock', 'metadata arrival', 'account arrival'])(
    'does not overwrite the current vault after %s during network account derivation',
    async (change) => {
      currentState.vault = vault();
      wallet.keyrings = new Map([[57, keyring]]);
      wallet.getActiveKeyring.mockImplementation(() =>
        wallet.keyrings.get(currentState.vaultGlobal.activeSlip44)
      );
      (store.dispatch as jest.Mock).mockImplementation((action: any) => {
        if (action.type === 'vaultGlobal/setActiveSlip44') {
          currentState.vaultGlobal.activeSlip44 = action.payload;
        }
        return action;
      });
      let finishDerivation!: (value: any) => void;
      const deriving = new Promise((resolve) => {
        finishDerivation = resolve;
      });
      let started!: () => void;
      const derivationStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const targetKeyring = {
        isUnlocked: jest.fn().mockReturnValue(false),
        setSignerNetwork: jest.fn(),
        createFirstAccount: jest.fn().mockImplementation(() => {
          started();
          return deriving;
        }),
      };
      wallet.createKeyringOnDemand = jest.fn(() => targetKeyring);
      keyring.transferSessionTo.mockImplementation(() => {
        keyring.isUnlocked.mockReturnValue(false);
        targetKeyring.isUnlocked.mockReturnValue(true);
      });
      jest
        .spyOn(storeModule, 'loadAndActivateSlip44Vault')
        .mockImplementation(async () => {
          currentState.vault = {
            ...vault(),
            accounts: { HDAccount: {} },
            accountAssets: { HDAccount: {} },
            accountTransactions: { HDAccount: {} },
            activeNetwork: SYSCOIN_MAINNET_NETWORK,
          };
          return true;
        });
      const switching = wallet.switchActiveKeyring(SYSCOIN_MAINNET_NETWORK);
      const rejected = expect(switching).rejects.toThrow();
      await derivationStarted;
      if (change === 'lock') {
        wallet.walletSessionGeneration += 1;
        targetKeyring.isUnlocked.mockReturnValue(false);
      } else if (change === 'metadata arrival') {
        currentState.vault.accountAssets.HDAccount[0] = {
          ethereum: [{ symbol: 'ARRIVED' }],
          syscoin: [],
        };
      } else {
        currentState.vault.accounts.HDAccount[0] = {
          id: 0,
          address: 'arrived-address',
          xpub: 'arrived-public-key',
        };
      }
      const snapshot = JSON.stringify(currentState.vault);
      finishDerivation({
        id: 0,
        address: 'derived-address',
        xpub: 'derived-public-key',
      });
      await rejected;
      expect(JSON.stringify(currentState.vault)).toBe(snapshot);
      expect(targetKeyring.setSignerNetwork).not.toHaveBeenCalled();
      expect(
        (store.dispatch as jest.Mock).mock.calls.some(
          ([action]) => action.type === 'vault/createAccount'
        )
      ).toBe(false);
    }
  );
});
