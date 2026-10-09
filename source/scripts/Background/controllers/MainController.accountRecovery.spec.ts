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
import { AsyncMutex } from 'utils/asyncMutex';
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

const emptyVault = () => ({
  ...vault(),
  accounts: { HDAccount: {} },
  accountAssets: { HDAccount: {} },
  accountTransactions: { HDAccount: {} },
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
    wallet.walletStateGeneration = 0;
    wallet.networkRequestGeneration = 0;
    wallet.authenticationMutex = new AsyncMutex();
    wallet.performDeferredVaultSave = jest.fn();
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

  it('finishes a genuinely empty target when a newer queued network request supersedes its first derivation', async () => {
    currentState.vault = vault();
    wallet.keyrings = new Map([[57, keyring]]);
    wallet.getActiveKeyring.mockImplementation(() =>
      wallet.keyrings.get(currentState.vaultGlobal.activeSlip44)
    );
    wallet.stopAllRapidPolling = jest.fn();
    wallet.cancellablePromises = {};
    wallet.assetUpdateRequestId = 0;
    wallet.cancelActiveBalanceUpdate = jest.fn();
    wallet.handleNetworkChangeError = jest.fn();
    const committedVaults: any[] = [];
    wallet.handleNetworkChangeSuccess = jest.fn(async () => {
      committedVaults.push(JSON.parse(JSON.stringify(currentState.vault)));
    });
    // Keep public request cancellation and the production network-switch mutex;
    // omit unrelated network-quality/notification work around configuration.
    wallet.setActiveNetworkLogic = (
      network: any,
      resolve: (value: any) => void,
      reject: (error: any) => void,
      isCurrent: () => boolean
    ) => wallet.setSignerNetwork(network, isCurrent).then(resolve, reject);
    (store.dispatch as jest.Mock).mockImplementation((action: any) => {
      if (action.type === 'vaultGlobal/setActiveSlip44') {
        currentState.vaultGlobal.activeSlip44 = action.payload;
      } else if (action.type === 'vault/createAccount') {
        const { account, accountType } = action.payload;
        currentState.vault.accounts[accountType][account.id] = account;
      } else if (action.type === 'vault/setActiveAccount') {
        currentState.vault.activeAccount = action.payload;
      }
      return action;
    });
    let finishFirstDerivation!: (value: any) => void;
    const firstDerivation = new Promise((resolve) => {
      finishFirstDerivation = resolve;
    });
    let started!: () => void;
    const derivationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const firstAccount = {
      id: 0,
      address: 'derived-address',
      xpub: 'derived-public-key',
    };
    const targetKeyring = {
      isUnlocked: jest.fn().mockReturnValue(false),
      lockWallet: jest.fn(),
      setSignerNetwork: jest.fn().mockResolvedValue({ success: true }),
      createFirstAccount: jest
        .fn()
        .mockImplementationOnce(() => {
          started();
          return firstDerivation;
        })
        .mockResolvedValue(firstAccount),
    };
    wallet.createKeyringOnDemand = jest.fn(() => targetKeyring);
    keyring.transferSessionTo.mockImplementation(() => {
      keyring.isUnlocked.mockReturnValue(false);
      targetKeyring.isUnlocked.mockReturnValue(true);
    });
    const loadTarget = jest
      .spyOn(storeModule, 'loadAndActivateSlip44Vault')
      .mockImplementation(async () => {
        currentState.vault = {
          ...vault(),
          accounts: { HDAccount: {} },
          accountAssets: { HDAccount: {} },
          accountTransactions: { HDAccount: {} },
          activeNetwork: SYSCOIN_MAINNET_NETWORK,
        };
        return false;
      });
    const first = wallet.setActiveNetwork(SYSCOIN_MAINNET_NETWORK);
    const firstOutcome = first.then(
      () => 'unexpected success',
      (error: any) => error
    );
    await derivationStarted;
    expect(currentState.vaultGlobal.activeSlip44).toBe(60);
    const secondNetwork = { ...SYSCOIN_MAINNET_NETWORK, chainId: 137 };
    const second = wallet.setActiveNetwork(secondNetwork);
    finishFirstDerivation(firstAccount);
    expect(await firstOutcome).toBe('Network change cancelled');
    await expect(second).resolves.toMatchObject({ networkVersion: 137 });
    expect(loadTarget).toHaveBeenCalledTimes(1);
    expect(targetKeyring.createFirstAccount).toHaveBeenCalledTimes(2);
    expect(targetKeyring.setSignerNetwork).toHaveBeenCalledTimes(1);
    expect(targetKeyring.setSignerNetwork).toHaveBeenCalledWith(secondNetwork);
    expect(targetKeyring.lockWallet).not.toHaveBeenCalled();
    expect(currentState.vault.accounts.HDAccount).toEqual({ 0: firstAccount });
    expect(committedVaults).toHaveLength(1);
    expect(committedVaults[0].accounts.HDAccount).toEqual({ 0: firstAccount });
  });

  it.each([
    'orphaned metadata',
    'locked target',
    'missing selected account',
    'malformed selected account',
  ])('refuses empty-target initialization with %s', async (damage) => {
    currentState.vault = emptyVault();
    wallet.keyrings = new Map([[57, keyring]]);
    keyring.setSignerNetwork = jest.fn().mockResolvedValue({ success: true });
    if (damage === 'orphaned metadata') {
      currentState.vault.accountAssets.HDAccount[0] = {
        ethereum: [{ symbol: 'SAVED' }],
        syscoin: [],
      };
    } else if (damage === 'locked target') {
      keyring.isUnlocked.mockReturnValue(false);
    } else if (damage === 'missing selected account') {
      currentState.vault.activeAccount.id = 7;
    } else {
      currentState.vault.activeAccount = {
        id: 2,
        type: KeyringAccountType.Imported,
      };
      currentState.vault.accounts.Imported = { 2: { id: 2, address: '' } };
    }
    const snapshot = JSON.stringify(currentState.vault);
    await expect(
      wallet.switchActiveKeyring(SYSCOIN_UTXO_MAINNET_NETWORK)
    ).rejects.toThrow(
      damage === 'locked target'
        ? 'Wallet session changed'
        : 'Account data is incomplete'
    );
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
    expect(keyring.createFirstAccount).not.toHaveBeenCalled();
    expect(keyring.setSignerNetwork).not.toHaveBeenCalled();
    expect(keyring.lockWallet).not.toHaveBeenCalled();
  });

  it.each([
    KeyringAccountType.Imported,
    KeyringAccountType.Ledger,
    KeyringAccountType.Trezor,
  ])(
    'preserves a valid selected %s account without manufacturing an HD identity',
    async (accountType) => {
      currentState.vault = emptyVault();
      currentState.vault.accounts[accountType] = {
        2: { id: 2, address: 'saved-non-hd-address', label: 'Saved identity' },
      };
      currentState.vault.activeAccount = { id: 2, type: accountType };
      wallet.keyrings = new Map([[57, keyring]]);
      keyring.setSignerNetwork = jest.fn().mockResolvedValue({ success: true });
      const snapshot = JSON.stringify(currentState.vault);
      await expect(
        wallet.switchActiveKeyring(SYSCOIN_UTXO_MAINNET_NETWORK)
      ).resolves.toBeUndefined();
      expect(JSON.stringify(currentState.vault)).toBe(snapshot);
      expect(keyring.createFirstAccount).not.toHaveBeenCalled();
      expect(keyring.setSignerNetwork).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['backend failure', 'incomplete derived identity'])(
    'does not report empty-target success after %s',
    async (failure) => {
      currentState.vault = emptyVault();
      wallet.keyrings = new Map([[57, keyring]]);
      keyring.setSignerNetwork = jest.fn().mockResolvedValue({ success: true });
      if (failure === 'backend failure') {
        keyring.createFirstAccount.mockRejectedValue(
          new Error('backend unavailable')
        );
      } else {
        keyring.createFirstAccount.mockResolvedValue({
          id: 0,
          address: 'new-address',
          xpub: '',
        });
      }
      const snapshot = JSON.stringify(currentState.vault);
      await expect(
        wallet.switchActiveKeyring(SYSCOIN_UTXO_MAINNET_NETWORK)
      ).rejects.toThrow();
      expect(JSON.stringify(currentState.vault)).toBe(snapshot);
      expect(keyring.setSignerNetwork).not.toHaveBeenCalled();
      expect(keyring.lockWallet).not.toHaveBeenCalled();
    }
  );

  it.each(['lock', 'metadata arrival', 'account arrival', 'active selection'])(
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
      } else if (change === 'active selection') {
        currentState.vault.accounts.Imported = {
          2: { id: 2, address: 'selected-imported-address' },
        };
        currentState.vault.activeAccount = {
          id: 2,
          type: KeyringAccountType.Imported,
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

  it('does not revive an old keyring or save its old source snapshot after reset during existing-target setup', async () => {
    currentState.vault = vault();
    wallet.walletStateGeneration = 0;
    const targetKeyring = {
      isUnlocked: jest.fn().mockReturnValue(false),
      setSignerNetwork: jest.fn(),
    };
    wallet.keyrings = new Map([
      [57, keyring],
      [60, targetKeyring],
    ]);
    wallet.getActiveKeyring.mockImplementation(() =>
      wallet.keyrings.get(currentState.vaultGlobal.activeSlip44)
    );
    keyring.transferSessionTo.mockImplementation(() => {
      keyring.isUnlocked.mockReturnValue(false);
      targetKeyring.isUnlocked.mockReturnValue(true);
    });
    (store.dispatch as jest.Mock).mockImplementation((action: any) => {
      if (action.type === 'vaultGlobal/setActiveSlip44')
        currentState.vaultGlobal.activeSlip44 = action.payload;
      return action;
    });
    jest
      .spyOn(storeModule, 'loadAndActivateSlip44Vault')
      .mockImplementation(async () => {
        currentState.vault = {
          ...vault(),
          activeNetwork: SYSCOIN_MAINNET_NETWORK,
        };
        return true;
      });
    let finishSetup!: () => void;
    const setup = new Promise<void>((resolve) => {
      finishSetup = resolve;
    });
    let started!: () => void;
    const setupStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    targetKeyring.setSignerNetwork.mockImplementation(() => {
      started();
      return setup;
    });
    wallet.performDeferredVaultSave = jest.fn();
    const switching = wallet.switchActiveKeyring(SYSCOIN_MAINNET_NETWORK);
    const rejected = expect(switching).rejects.toThrow(
      'Wallet session changed'
    );
    await setupStarted;
    wallet.walletSessionGeneration += 1;
    wallet.walletStateGeneration += 1;
    targetKeyring.isUnlocked.mockReturnValue(false);
    const newKeyring = {
      isUnlocked: jest.fn().mockReturnValue(true),
      lockWallet: jest.fn(),
    };
    const newTargetKeyring = { isUnlocked: jest.fn().mockReturnValue(false) };
    wallet.keyrings.clear();
    wallet.keyrings.set(57, newKeyring);
    wallet.keyrings.set(60, newTargetKeyring);
    currentState.vault = vault();
    currentState.vault.accounts.HDAccount[0].address = 'new-wallet-address';
    currentState.vaultGlobal.activeSlip44 = 57;
    const snapshot = JSON.stringify(currentState.vault);
    finishSetup();
    await rejected;
    expect(wallet.keyrings.get(60)).toBe(newTargetKeyring);
    expect(newKeyring.lockWallet).not.toHaveBeenCalled();
    // The original source was safely queued before target I/O, once only.
    expect(wallet.performDeferredVaultSave).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(currentState.vault)).toBe(snapshot);
  });

  it('restores the source when lock invalidates a hydrated target before activation commits', async () => {
    const source = vault();
    currentState.vault = source;
    wallet.keyrings = new Map([
      [57, keyring],
      [60, { isUnlocked: () => false }],
    ]);
    jest
      .spyOn(storeModule, 'loadAndActivateSlip44Vault')
      .mockImplementation(async () => {
        currentState.vault = {
          ...vault(),
          activeNetwork: SYSCOIN_MAINNET_NETWORK,
        };
        wallet.walletSessionGeneration += 1;
        keyring.isUnlocked.mockReturnValue(false);
        return true;
      });
    const rollback = jest
      .spyOn(storeModule, 'restoreSourceVaultAfterUncommittedSwitch')
      .mockImplementation((slip44, snapshot) => {
        if (currentState.vaultGlobal.activeSlip44 !== slip44) return false;
        currentState.vault = snapshot;
        return true;
      });
    await expect(
      wallet.switchActiveKeyring(SYSCOIN_MAINNET_NETWORK)
    ).rejects.toThrow('Wallet session changed');
    expect(rollback).toHaveBeenCalledWith(57, source);
    expect(currentState.vault).toEqual(source);
    expect(keyring.transferSessionTo).not.toHaveBeenCalled();
  });

  it('rejects the keyring provider failure verdict instead of reporting a successful network switch', async () => {
    currentState.vault = vault();
    wallet.keyrings = new Map([[57, keyring]]);
    keyring.setSignerNetwork = jest.fn().mockResolvedValue({ success: false });
    await expect(
      wallet.switchActiveKeyring(SYSCOIN_UTXO_MAINNET_NETWORK)
    ).rejects.toThrow('Failed to configure the selected network');
  });

  it('rejects new network changes throughout a reset even after its generations advance', async () => {
    wallet.keyrings = new Map([[57, keyring]]);
    wallet.cancellablePromises = {};
    wallet.clearAllTimers = jest.fn();
    wallet.stopAllRapidPolling = jest.fn();
    wallet.disposeAllKeyrings = jest.fn();
    wallet.cleanupPersistentProviders = jest.fn();
    wallet.cancelActiveBalanceUpdate = jest.fn();
    let failReset!: (error: Error) => void;
    wallet.stopAutoLockTimer = jest.fn(
      () => new Promise<void>((_, reject) => (failReset = reject))
    );
    const loadTarget = jest.spyOn(storeModule, 'loadAndActivateSlip44Vault');
    const snapshot = JSON.stringify(currentState);
    const resetting = wallet.resetWalletState();
    const failedReset = expect(resetting).rejects.toThrow('reset I/O failed');
    expect(wallet.walletStateGeneration).toBe(1);
    expect(wallet.networkRequestGeneration).toBe(1);
    expect(wallet.isResettingWallet).toBe(true);

    await expect(
      wallet.setActiveNetwork(SYSCOIN_MAINNET_NETWORK)
    ).rejects.toThrow('Wallet reset is in progress');
    await expect(
      wallet.switchActiveKeyring(SYSCOIN_MAINNET_NETWORK)
    ).rejects.toThrow('Wallet reset is in progress');
    expect(wallet.networkRequestGeneration).toBe(1);
    expect(loadTarget).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(currentState)).toBe(snapshot);

    failReset(new Error('reset I/O failed'));
    await failedReset;
    expect(wallet.isResettingWallet).toBe(false);
  });

  it('clears the network reset gate after a successful reset', async () => {
    wallet.resetWalletStateExclusive = jest.fn().mockResolvedValue(undefined);
    await wallet.resetWalletState({ resetNetworks: true });
    expect(wallet.resetWalletStateExclusive).toHaveBeenCalledWith({
      resetNetworks: true,
    });
    expect(wallet.isResettingWallet).toBe(false);
  });

  it('allows a complete existing account collection to switch its provider successfully', async () => {
    currentState.vault = vault();
    wallet.keyrings = new Map([[57, keyring]]);
    keyring.setSignerNetwork = jest.fn().mockResolvedValue({ success: true });
    await expect(
      wallet.switchActiveKeyring(SYSCOIN_UTXO_MAINNET_NETWORK)
    ).resolves.toBeUndefined();
    expect(keyring.setSignerNetwork).toHaveBeenCalledWith(
      SYSCOIN_UTXO_MAINNET_NETWORK
    );
    expect(keyring.createFirstAccount).not.toHaveBeenCalled();
  });

  it('drops a creation session and refuses its account when lock occurs during initialization', async () => {
    wallet.resetWalletState = jest.fn().mockResolvedValue(undefined);
    let complete!: (value: any) => void;
    let started!: () => void;
    const initializing = new Promise((resolve) => {
      complete = resolve;
    });
    const initializationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    keyring.initializeWalletSecurely = jest.fn().mockImplementation(() => {
      started();
      return initializing;
    });
    const creating = wallet.createWallet('password', 'test seed');
    const rejected = expect(creating).rejects.toThrow('Wallet session changed');
    await initializationStarted;
    wallet.walletSessionGeneration += 1;
    keyring.isUnlocked.mockReturnValue(false);
    complete({ id: 0, address: 'derived-address', xpub: 'derived-public-key' });
    await rejected;
    expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
    expect(
      (store.dispatch as jest.Mock).mock.calls.some(
        ([action]) => action.type === 'vault/createAccount'
      )
    ).toBe(false);
    expect(wallet.isCreatingWallet).toBe(false);
  });

  it.each(['createWallet', 'forgetWallet'])(
    'waits for pending secret authentication before %s can reset storage',
    async (method) => {
      let finish!: (value: string) => void;
      let started!: () => void;
      const authenticating = new Promise<string>((resolve) => {
        finish = resolve;
      });
      const authenticationStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      keyring.getSeed = jest.fn().mockImplementation(() => {
        started();
        return authenticating;
      });
      const secret = wallet.getSeed('password');
      await authenticationStarted;
      const exclusive = jest.fn().mockResolvedValue(undefined);
      wallet[`${method}Exclusive`] = exclusive;
      const resetting =
        method === 'createWallet'
          ? wallet.createWallet('password', 'test seed')
          : wallet.forgetWallet('password');
      await Promise.resolve();
      expect(exclusive).not.toHaveBeenCalled();
      finish('test seed');
      await secret;
      await resetting;
      expect(exclusive).toHaveBeenCalledTimes(1);
    }
  );
});
