// Removed unused import: ethErrors

import {
  KeyringManager,
  IKeyringAccountState,
  KeyringAccountType,
  CustomJsonRpcProvider,
} from '@sidhujag/sysweb3-keyring';
import {
  getSysRpc,
  getEthRpc,
  INetwork,
  clearRpcCaches,
  retryableFetch,
  validateRpcBatchUniversal,
} from '@sidhujag/sysweb3-network';
import { txUtils, ITxid } from '@sidhujag/sysweb3-utils';
import {
  validateEOAAddress,
  getErc20Abi,
  getErc21Abi,
  getErc55Abi,
  isValidSYSAddress,
} from '@sidhujag/sysweb3-utils';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';

import { getController } from '..';
import { clearNavigationState } from '../../../utils/navigationState';
import { checkForUpdates } from '../handlers/handlePaliUpdates';
import { notificationManager } from '../notification-manager';
import PaliLogo from 'assets/all_assets/favicon-32.png';
import { ASSET_PRICE_API } from 'constants/index';
import { setPrices } from 'state/price';
import store from 'state/store';
import { loadAndActivateSlip44Vault, saveMainState } from 'state/store';
import {
  createAccount,
  forgetWallet,
  removeAccount,
  setAccountLabel,
  setAccountPropertyByIdAndType,
  setActiveAccount,
  setTransactionStatusToAccelerated,
  setTransactionStatusToCanceled,
  setFaucetModalState,
  setNetworkChange,
  setSingleTransactionToState,
  setAccountAssets,
  setAccountTransactions,
} from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import vaultCache, {
  getSlip44ForNetwork,
  DEFAULT_EVM_SLIP44,
  DEFAULT_UTXO_SLIP44,
} from 'state/vaultCache';
import {
  setActiveSlip44,
  setAdvancedSettings,
  setHasEthProperty,
  setHasEncryptedVault,
  setLastLogin,
  resetNetworkStatus,
  setIsSwitchingAccount,
  startSwitchNetwork,
  switchNetworkError,
  switchNetworkSuccess,
  setError as setStoreError,
  setIsLoadingAssets,
  setIsLoadingBalances,
  setIsLoadingTxs,
  setNetwork,
  removeNetwork,
  setIsPollingUpdate,
  startConnecting,
  updateNetworkQualityLatency,
  clearNetworkQualityIfStale,
  resetNetworkQualityForNewNetwork,
  setPostNetworkSwitchLoading,
} from 'state/vaultGlobal';
import { INetworkType } from 'types/network';
import { IBlacklistCheckResult } from 'types/security';
import {
  ITokenEthProps,
  IWatchAssetTokenProps,
  ISysAssetMetadata,
  ITokenDetails,
} from 'types/tokens';
import { ICustomRpcParams, IDecodedTx } from 'types/transactions';
import {
  fiatPriceMutex,
  networkSwitchMutex,
  accountSwitchMutex,
} from 'utils/asyncMutex';
import { areBalancesDifferent } from 'utils/balance';
import { SYSCOIN_UTXO_MAINNET_NETWORK } from 'utils/constants';
import { decodeTransactionData } from 'utils/ethUtil';
import { logError } from 'utils/logger';
import { getNetworkChain } from 'utils/network';
import { blacklistService } from 'utils/security/blacklistService';
import { chromeStorage } from 'utils/storageAPI';
import {
  isTransactionInBlock,
  getTransactionBlockInfo,
} from 'utils/transactionUtils';

import EthAccountController, { IEthAccountController } from './account/evm';
import SysAccountController, { ISysAccountController } from './account/syscoin';
import AssetsManager from './assets';
import EvmAssetsController from './assets/evm';
import { IAssetsManager } from './assets/types';
import { ensureTrailingSlash } from './assets/utils';
import BalancesManager from './balances';
import { IBalancesManager } from './balances/types';
import ChainListService from './chainlist';
import { clearProviderCache } from './message-handler/requests';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';
import {
  CancellablePromises,
  PromiseTargets,
} from './promises/cancellablesPromises';
import { patchFetchWithPaliHeaders } from './providers/patchFetchWithPaliHeaders';
import { StorageManager } from './storageManager';
import TransactionsManager from './transactions';
import EvmTransactionsController from './transactions/evm';
import {
  IEvmTransactionResponse,
  ISysTransaction,
  ITransactionsManager,
} from './transactions/types';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

// Default slip44 values for fallback cases

class MainController {
  // Map of keyrings indexed by slip44
  private keyrings: Map<number, KeyringManager> = new Map();

  public account: {
    eth: IEthAccountController;
    sys: ISysAccountController;
  };
  public assets: IAssetsManager;
  public transactions: ITransactionsManager;
  private assetsManager: IAssetsManager;
  private transactionsManager: ITransactionsManager;
  private balancesManager: IBalancesManager;
  private cancellablePromises: CancellablePromises;
  private currentPromise: {
    cancel: () => void;
    promise: Promise<{ chainId: string; networkVersion: number }>;
  } | null = null;
  private justUnlocked = false;
  private isStartingUp = false;
  // Add a property to track account switching state
  private isAccountSwitching = false;
  // Add a property to track network switching state
  private isNetworkSwitching = false;

  // Auto-lock timer management
  private autoLockAlarmName = 'pali_auto_lock_timer';
  private autoLockResetTimeout: NodeJS.Timeout | null = null;

  // Centralized wallet state saving
  private saveTimeout: NodeJS.Timeout | null = null;

  // Track active rapid polls to avoid duplicates
  private activeRapidPolls = new Map<string, NodeJS.Timeout>();

  // Persistent providers for reading blockchain data (survives lock/unlock)
  private persistentProviders = new Map<string, CustomJsonRpcProvider>();

  // Cache for UTXO network price data (same pattern as EVM)
  private utxoPriceDataCache = new Map<
    string,
    {
      data: { price: number; priceChange24h?: number };
      timestamp: number;
    }
  >();

  private readonly UTXO_PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache for price data

  constructor() {
    // Patch fetch to add Pali headers to all RPC requests
    patchFetchWithPaliHeaders();

    // 🔥 REMOVED: Eager ChainList initialization - now lazy-loads on first use
    // This prevents loading large rpcs.json file on every app startup

    // Get initial slip44 from Redux global state (single source of truth)
    let initialSlip44 = DEFAULT_UTXO_SLIP44;

    try {
      const globalState = store.getState().vaultGlobal;
      if (globalState.activeSlip44 !== null) {
        initialSlip44 = globalState.activeSlip44;
        console.log(
          `[MainController] Using activeSlip44 from Redux global state: ${initialSlip44}`
        );
      } else {
        // Fallback: check if we can determine from vault state
        const vaultState = store.getState().vault;
        if (vaultState?.activeNetwork?.slip44 !== undefined) {
          initialSlip44 = vaultState.activeNetwork.slip44;
        } else if (
          vaultState &&
          typeof vaultState.isBitcoinBased === 'boolean'
        ) {
          initialSlip44 = vaultState.isBitcoinBased
            ? DEFAULT_UTXO_SLIP44
            : DEFAULT_EVM_SLIP44;
        }
        // Update Redux with detected/fallback slip44
        store.dispatch(setActiveSlip44(initialSlip44));

        // Save main state immediately to persist the initial activeSlip44
        saveMainState().catch((error) => {
          console.error(
            `[MainController] Failed to save main state after initial activeSlip44 setup:`,
            error
          );
        });
      }

      console.log(
        `[MainController] Constructor using slip44: ${initialSlip44}`
      );
    } catch (error) {
      console.warn(
        '[MainController] Could not determine initial slip44, using default'
      );
      // Ensure Redux has a valid slip44
      store.dispatch(setActiveSlip44(initialSlip44));

      // Save main state immediately to persist the fallback activeSlip44
      saveMainState().catch((saveError) => {
        console.error(
          `[MainController] Failed to save main state after fallback activeSlip44 setup:`,
          saveError
        );
      });
    }

    // Initialize keyring based on detected slip44
    this.initializeKeyring(initialSlip44);

    this.assetsManager = AssetsManager();
    this.transactionsManager = TransactionsManager();
    this.balancesManager = BalancesManager();
    this.cancellablePromises = new CancellablePromises();
    this.account = {
      eth: EthAccountController(),
      sys: SysAccountController(() => this.getActiveKeyring()),
    };

    this.bindMethods();

    // Initialize blacklist service
    setTimeout(() => {
      this.initializeBlacklistService();
    }, 1000);
  }

  private async initializeBlacklistService() {
    try {
      // Initialize blacklist service asynchronously without blocking startup
      await blacklistService.initialize();
      console.log('[MainController] Blacklist service initialized');
    } catch (error) {
      console.error(
        '[MainController] Failed to initialize blacklist service:',
        error
      );
    }
  }

  // Initialize a keyring for a specific slip44
  private initializeKeyring(slip44: number): KeyringManager {
    if (!this.keyrings.has(slip44)) {
      console.log(
        `[MainController] Initializing keyring for slip44: ${slip44}`
      );
      const keyring = new KeyringManager();
      // Set up storage access for each keyring
      keyring.setStorage(chrome.storage.local);
      keyring.setVaultStateGetter(() => store.getState().vault);
      this.keyrings.set(slip44, keyring);
    }
    return this.keyrings.get(slip44)!;
  }

  // Get the active keyring
  private getActiveKeyring(): KeyringManager {
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;
    let keyring = this.keyrings.get(activeSlip44);
    if (!keyring) {
      console.log(
        `[MainController] Creating new keyring for slip44: ${activeSlip44} (no existing keyring - likely after wallet forget/restart)`
      );
      // Create keyring on-demand to handle state rehydration edge cases
      keyring = this.initializeKeyring(activeSlip44);
    }

    return keyring;
  }
  // Switch active keyring based on network
  private async switchActiveKeyring(network: INetwork): Promise<void> {
    const slip44 = getSlip44ForNetwork(network);
    let hasExistingVaultState = false;
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;

    // 🔥 FIX: Determine if we're switching slip44 BEFORE activeSlip44 gets updated
    const isSwitchingSlip44 = slip44 !== activeSlip44;

    // Create a state transaction to ensure atomic updates
    const stateTransaction: {
      deferredSaveData: { slip44: number; vaultState: any } | null;
      needsSessionTransfer: boolean;
      sourceKeyring: KeyringManager | null;
      sourceSlip44: number | null;
      targetKeyring: KeyringManager | null;
    } = {
      sourceKeyring: null,
      sourceSlip44: null,
      targetKeyring: null,
      deferredSaveData: null,
      needsSessionTransfer: false,
    };

    try {
      // 🔥 FIX: Capture unlocked keyring reference BEFORE any state changes
      // This ensures we have a valid keyring to transfer session from
      if (isSwitchingSlip44) {
        const unlockedKeyringEntry = Array.from(this.keyrings.entries()).find(
          ([, kr]) => {
            try {
              return kr.isUnlocked();
            } catch (error) {
              console.warn(
                `[MainController] Error checking keyring unlock status:`,
                error
              );
              return false;
            }
          }
        );

        if (unlockedKeyringEntry) {
          const [sourceSlip44, unlockedKeyring] = unlockedKeyringEntry;
          stateTransaction.sourceKeyring = unlockedKeyring;
          stateTransaction.sourceSlip44 = sourceSlip44;
          stateTransaction.needsSessionTransfer = true;
        } else {
          console.warn(
            `[MainController] WARNING: Switching slip44 but no unlocked keyring found! This will fail.`
          );
        }
      }

      // Capture current vault state for deferred save (non-blocking)
      if (isSwitchingSlip44) {
        console.log(
          `[MainController] Switching keyring from slip44 ${activeSlip44} to ${slip44}`
        );

        // Create shallow copy of current state for deferred save (fast, relies on Redux immutability)
        const currentState = store.getState().vault;
        if (currentState && activeSlip44 !== null) {
          // Shallow copy - safe because Redux state updates are immutable
          // The old state tree remains unchanged after loadAndActivateSlip44Vault dispatches
          const vaultStateCopy = { ...currentState };
          stateTransaction.deferredSaveData = {
            slip44: activeSlip44,
            vaultState: vaultStateCopy,
          };
        }

        // Load vault state for target slip44
        try {
          // CRITICAL FIX: Defer activeSlip44 update to ensure atomic state change
          // This prevents the race condition where activeSlip44 is updated before vault is loaded
          hasExistingVaultState = await loadAndActivateSlip44Vault(
            slip44,
            network,
            true // Defer activeSlip44 update until after session transfer
          );
        } catch (vaultLoadError) {
          console.error(
            `[MainController] Failed to load vault for slip44 ${slip44}:`,
            vaultLoadError
          );
          // Continue anyway - we'll create a new vault
          hasExistingVaultState = false;
        }

        // Update vault state with correct network info
        store.dispatch(setNetworkChange({ activeNetwork: network }));
      }

      // Ensure the target keyring exists
      let targetKeyring = this.keyrings.get(slip44);
      let keyringWasJustCreated = false;
      let needsAccountRepair = false;

      if (!targetKeyring) {
        console.log('[MainController] Creating new keyring on demand');
        targetKeyring = this.createKeyringOnDemand();
        keyringWasJustCreated = true;
        // Store the new keyring immediately so it's available for subsequent operations
        this.keyrings.set(slip44, targetKeyring);
      }

      stateTransaction.targetKeyring = targetKeyring;

      // Check if we need to repair corrupted accounts (using the flag we set earlier)
      if (hasExistingVaultState) {
        const { accounts } = store.getState().vault;

        // Quick check for missing xpub in HD accounts
        if (accounts.HDAccount) {
          for (const account of Object.values(accounts.HDAccount)) {
            if (!account.xpub || account.xpub === '') {
              needsAccountRepair = true;
              break;
            }
          }
        }
      }

      // 🔥 FIX: Transfer session using the source keyring reference we captured
      const needsSessionTransfer =
        isSwitchingSlip44 &&
        stateTransaction.needsSessionTransfer &&
        stateTransaction.sourceKeyring &&
        (!keyringWasJustCreated || !targetKeyring.isUnlocked());

      if (!targetKeyring) {
        throw new Error(`Failed to get keyring for slip44: ${slip44}`);
      }

      // Handle session transfer if needed
      if (needsSessionTransfer && stateTransaction.sourceKeyring) {
        try {
          // Double-check source keyring is still valid before transfer
          if (!stateTransaction.sourceKeyring.isUnlocked()) {
            throw new Error(
              `Source keyring (slip44: ${stateTransaction.sourceSlip44}) became locked before session transfer!`
            );
          }

          // Transfer session directly from source to target
          stateTransaction.sourceKeyring.transferSessionTo(targetKeyring);

          // CRITICAL FIX: Only update activeSlip44 AFTER successful session transfer
          // This ensures atomic state change to prevent race conditions
          if (isSwitchingSlip44) {
            store.dispatch(setActiveSlip44(slip44));
          }

          // Create accounts if no existing vault state OR if vault exists but has no accounts
          let shouldCreateFirstAccount = !hasExistingVaultState;

          if (hasExistingVaultState) {
            // Check if the vault has any HD accounts
            const { accounts } = store.getState().vault;
            const hasHDAccounts =
              accounts.HDAccount && Object.keys(accounts.HDAccount).length > 0;

            if (!hasHDAccounts) {
              console.log(
                '[MainController] Existing vault state found but no HD accounts exist, will create first account'
              );
              shouldCreateFirstAccount = true;
            }
          }

          if (shouldCreateFirstAccount) {
            // Ensure the keyring is properly unlocked before creating account
            if (!targetKeyring.isUnlocked()) {
              throw new Error(
                `Target keyring is not unlocked after session transfer! This should not happen.`
              );
            }

            // Create first account
            // Session data was already transferred, so we can create the first account directly
            const account = await targetKeyring.createFirstAccount();
            console.log(
              '[MainController] Created new keyring account',
              account.address
            );

            store.dispatch(
              createAccount({
                account: account,
                accountType: KeyringAccountType.HDAccount,
              })
            );

            // This ensures setSignerNetwork() finds the correct account
            store.dispatch(
              setActiveAccount({
                id: account.id,
                type: KeyringAccountType.HDAccount,
              })
            );
          }
        } catch (error) {
          console.error(`[MainController] Error transferring session:`, error);
          throw new Error(
            `Failed to transfer session to new keyring: ${error.message}`
          );
        }
      } else if (!targetKeyring.isUnlocked()) {
        // If target keyring is not unlocked and we didn't transfer session
        if (isSwitchingSlip44) {
          // This is a critical error - we're switching keyrings but can't unlock the target
          console.error(
            `[MainController] No unlocked keyring found to transfer session from. Available keyrings: ${Array.from(
              this.keyrings.keys()
            )}`
          );
          throw new Error(
            `Target keyring for slip44 ${slip44} is locked. Please unlock the wallet first.`
          );
        }
        // For same slip44, the keyring should already be unlocked from previous operations
      }

      await targetKeyring.setSignerNetwork(network);

      // Ensure the keyring is stored in the map (might have been done earlier, but be sure)
      this.keyrings.set(slip44, targetKeyring);

      // Repair corrupted accounts if needed (after session transfer is complete)
      if (needsAccountRepair && targetKeyring.isUnlocked()) {
        console.log(
          `[MainController] Starting account repair for slip44 ${slip44} after network switch`
        );

        try {
          // We need the password to repair accounts, but we don't have it here
          // Instead, we can try to repair using the existing session
          await this.repairCorruptedAccountsWithSession(targetKeyring);
        } catch (error) {
          console.error(
            `[MainController] Failed to repair accounts during network switch:`,
            error
          );
          // Don't throw - continue with network switch even if repair fails
        }
      }

      // Perform deferred save of previous vault state (non-blocking)
      if (stateTransaction.deferredSaveData) {
        this.performDeferredVaultSave(stateTransaction.deferredSaveData);
      }

      // Lock all other keyrings for security AFTER everything is complete
      // This prevents interfering with the session transfer or state updates
      this.keyrings.forEach((keyring, keyringSlip44) => {
        if (keyringSlip44 !== slip44 && keyring.isUnlocked()) {
          console.log(
            `[MainController] Locking non-active keyring for slip44: ${keyringSlip44}`
          );
          keyring.lockWallet();
        }
      });
    } catch (error) {
      console.error('[MainController] Error in switchActiveKeyring:', error);
      throw error;
    }
  }

  // Create a keyring on demand with storage access
  private createKeyringOnDemand(): KeyringManager {
    // Create new keyring with the wallet state
    const keyring = new KeyringManager();

    // Set up storage access - this gives it access to the global encrypted vault
    keyring.setStorage(chrome.storage.local);
    keyring.setVaultStateGetter(() => store.getState().vault);

    // Note: Session transfer is handled in switchActiveKeyring method
    // to avoid double transfers and ensure proper state management
    return keyring;
  }

  // Lock all keyrings - used when user explicitly locks wallet
  private lockAllKeyrings(): void {
    this.keyrings.forEach((keyring, slip44) => {
      try {
        if (keyring.isUnlocked()) {
          keyring.lockWallet();
        }

        // Clean up some Web3 provider listeners during normal lock to prevent accumulation
        // (but don't dispose of the entire provider - just remove listeners)
        if (
          keyring.ethereumTransaction &&
          keyring.ethereumTransaction.web3Provider
        ) {
          try {
            const provider = keyring.ethereumTransaction.web3Provider;
            if (typeof provider.removeAllListeners === 'function') {
              provider.removeAllListeners();
            }
          } catch (providerError) {
            console.warn(
              `[MainController] Error cleaning Web3 provider listeners for slip44 ${slip44}:`,
              providerError
            );
          }
        }
      } catch (error) {
        console.error(
          `[MainController] Error locking keyring for slip44 ${slip44}:`,
          error
        );
        // Continue with other keyrings even if one fails
      }
    });
  }

  // Clear all pending timers to prevent memory leaks
  private clearAllTimers(): void {
    // Clear save timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    // Clear auto-lock reset timeout
    if (this.autoLockResetTimeout) {
      clearTimeout(this.autoLockResetTimeout);
      this.autoLockResetTimeout = null;
    }

    // Clear all rapid polling timeouts
    this.activeRapidPolls.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    this.activeRapidPolls.clear();

    console.log('[MainController] Cleared all pending timers');
  }

  // Properly dispose of keyring instances to prevent memory leaks
  private disposeAllKeyrings(): void {
    const disposalErrors: Array<{ error: any; slip44: number }> = [];

    this.keyrings.forEach((keyring, slip44) => {
      try {
        console.log(`[MainController] Disposing keyring for slip44: ${slip44}`);

        // Lock the keyring first to clear session data
        try {
          if (keyring.isUnlocked()) {
            keyring.lockWallet();
          }
        } catch (lockError) {
          console.warn(
            `[MainController] Failed to lock keyring ${slip44} during disposal:`,
            lockError
          );
          // Continue with disposal even if lock fails
        }
        // Clean up Web3 providers if they exist
        if (
          keyring.ethereumTransaction &&
          keyring.ethereumTransaction.web3Provider
        ) {
          try {
            const provider = keyring.ethereumTransaction.web3Provider;

            // Remove all listeners from Web3 provider
            if (provider && typeof provider.removeAllListeners === 'function') {
              try {
                provider.removeAllListeners();
                console.log(
                  `[MainController] Removed Web3 provider listeners for slip44 ${slip44}`
                );
              } catch (listenerError) {
                console.warn(
                  `[MainController] Failed to remove Web3 provider listeners for slip44 ${slip44}:`,
                  listenerError
                );
              }
            } else if (provider && provider._events) {
              // Fallback: Try to clear events object directly for providers that don't have removeAllListeners
              try {
                provider._events = {};
                console.log(
                  `[MainController] Cleared _events for Web3 provider slip44 ${slip44}`
                );
              } catch (eventError) {
                console.warn(
                  `[MainController] Could not clear events for slip44 ${slip44}:`,
                  eventError
                );
              }
            }

            // Destroy provider if it has a destroy method
            if (typeof provider.destroy === 'function') {
              try {
                provider.destroy();
                console.log(
                  `[MainController] Destroyed Web3 provider for slip44 ${slip44}`
                );
              } catch (destroyError) {
                console.warn(
                  `[MainController] Failed to destroy Web3 provider for slip44 ${slip44}:`,
                  destroyError
                );
              }
            }

            // Clear the provider reference
            keyring.ethereumTransaction.web3Provider = null;
          } catch (providerError) {
            console.error(
              `[MainController] Error disposing Web3 provider for slip44 ${slip44}:`,
              providerError
            );
            disposalErrors.push({ slip44, error: providerError });
          }
        }

        // Clear any event listeners if keyring extends EventEmitter
        try {
          if (
            keyring &&
            typeof (keyring as any).removeAllListeners === 'function'
          ) {
            (keyring as any).removeAllListeners();
            console.log(
              `[MainController] Removed event listeners for keyring slip44 ${slip44}`
            );
          }
        } catch (listenerError) {
          console.error(
            `[MainController] Failed to remove listeners for keyring ${slip44}:`,
            listenerError
          );
          disposalErrors.push({ slip44, error: listenerError });
        }

        // Clear any remaining references
        if (keyring.syscoinTransaction) {
          keyring.syscoinTransaction = null;
        }
        if (keyring.ethereumTransaction) {
          keyring.ethereumTransaction = null;
        }

        console.log(
          `[MainController] Successfully disposed keyring for slip44: ${slip44}`
        );
      } catch (error) {
        console.error(
          `[MainController] Error disposing keyring for slip44 ${slip44}:`,
          error
        );
        disposalErrors.push({ slip44, error });
      }
    });

    // Clear the keyrings map after disposal
    this.keyrings.clear();
    console.log('[MainController] Cleared all keyrings from memory');

    // Log summary of disposal errors if any occurred
    if (disposalErrors.length > 0) {
      console.error(
        `[MainController] Keyring disposal completed with ${disposalErrors.length} errors:`,
        disposalErrors
      );
    } else {
      console.log('[MainController] All keyrings disposed successfully');
    }
  }

  // Proxy methods to active keyring - made public for UX access (used by controllerEmitter)
  public get syscoinTransaction() {
    return this.getActiveKeyring().syscoinTransaction;
  }

  public get ethereumTransaction() {
    return this.getActiveKeyring().ethereumTransaction;
  }

  // Additional public methods for UX access (used by controllerEmitter)
  public validateZprv(zprv: string, targetNetwork?: any) {
    return this.getActiveKeyring().validateZprv(zprv, targetNetwork);
  }

  public get trezorSigner() {
    return this.getActiveKeyring().trezorSigner;
  }

  public get ledgerSigner() {
    return this.getActiveKeyring().ledgerSigner;
  }

  public getChangeAddress(id: number) {
    return this.getActiveKeyring().getChangeAddress(id);
  }

  public getCurrentAddressPubkey(id: number, isChangeAddress: boolean) {
    return this.getActiveKeyring().getPubkey(id, isChangeAddress);
  }

  public getBip32Path(id: number, isChangeAddress: boolean) {
    return this.getActiveKeyring().getBip32Path(id, isChangeAddress);
  }

  public getSeed(pwd: string) {
    return this.getActiveKeyring().getSeed(pwd);
  }

  public async getPrivateKeyByAccountId(
    id: number,
    accountType: any,
    pwd: string
  ) {
    return await this.getActiveKeyring().getPrivateKeyByAccountId(
      id,
      accountType,
      pwd
    );
  }

  public getActiveAccount() {
    return this.getActiveKeyring().getActiveAccount();
  }

  public createNewSeed() {
    return this.getActiveKeyring().createNewSeed();
  }

  private async forgetMainWallet(pwd: string) {
    return await this.getActiveKeyring().forgetMainWallet(pwd);
  }

  public async unlock(pwd: string) {
    console.log('[MainController] Attempting to unlock wallet');
    try {
      const keyring = this.getActiveKeyring();
      const result = await keyring.unlock(pwd);

      if (result.canLogin) {
        console.log('[MainController] Wallet unlocked successfully');
      } else {
        console.warn('[MainController] Wallet unlock returned canLogin=false');
      }

      return result;
    } catch (error) {
      console.error('[MainController] Error during wallet unlock:', error);
      throw error;
    }
  }

  public isUnlocked() {
    return this.getActiveKeyring().isUnlocked();
  }

  public isAnyKeyringUnlocked() {
    // Check if ANY keyring is unlocked, not just the active one
    // This prevents unnecessary login popups during network switching
    for (const keyring of this.keyrings.values()) {
      if (keyring.isUnlocked()) {
        return true;
      }
    }
    return false;
  }

  public isSeedValid(phrase: string) {
    return this.getActiveKeyring().isSeedValid(phrase);
  }

  private logout() {
    return this.getActiveKeyring().logout();
  }

  private async setSignerNetwork(network: INetwork) {
    // Use AsyncMutex for cross-context synchronization
    // This prevents concurrent network switches across all contexts
    return networkSwitchMutex.runExclusive(async () => {
      // Set network switching flag for UI/logging purposes
      this.isNetworkSwitching = true;

      try {
        // switchActiveKeyring handles everything: creating keyring if needed and setting up network
        await this.switchActiveKeyring(network);

        // Return the current wallet state from the keyring
        return {
          success: true,
        };
      } finally {
        // Clear network switching flag
        this.isNetworkSwitching = false;
      }
    });
  }

  // Fiat price fetching functionality moved from ControllerUtils

  public async setFiat(currency?: string): Promise<void> {
    // Use AsyncMutex for cross-context synchronization
    // This ensures only one price update runs at a time across all contexts
    return fiatPriceMutex.runExclusive(async () => {
      if (!currency) {
        const storeCurrency = store.getState().price.fiat.asset;
        currency = storeCurrency || 'usd';
      }

      const { activeNetwork, isBitcoinBased } = store.getState().vault;
      const id = getNetworkChain(isBitcoinBased);

      // Use optimized price fetching instead of large coinsList
      console.log(
        'Using optimized price fetching for network:',
        activeNetwork.chainId
      );

      switch (id) {
        case INetworkType.Syscoin:
          try {
            // Use cached UTXO price fetching (same pattern as EVM)
            const priceData = await this.getUtxoPriceData(
              activeNetwork.url,
              currency
            );

            store.dispatch(
              setPrices({
                asset: currency,
                price: priceData.price,
                priceChange24h: priceData.priceChange24h,
              })
            );
            return;
          } catch (error) {
            // If price API is not available (e.g., on testnets), just set price to 0
            store.dispatch(setPrices({ asset: currency, price: 0 }));
          }
          break;

        case INetworkType.Ethereum:
          try {
            // Use optimized price fetching for EVM networks
            const priceData = await this.getTokenPriceData(
              activeNetwork.chainId,
              currency
            );

            store.dispatch(
              setPrices({
                asset: currency,
                price: priceData.price,
                priceChange24h: priceData.priceChange24h,
              })
            );
            return;
          } catch (error) {
            logError('Failed to retrieve asset price - EVM', '', error);
            store.dispatch(setPrices({ asset: currency, price: 0 }));
          }
          break;
      }
    });
  }

  public setHasEthProperty(exist: boolean) {
    store.dispatch(setHasEthProperty(exist));
  }

  public async saveCurrentState(
    reason = 'manual-save',
    sync = true
  ): Promise<void> {
    // Public method to trigger a state save - this is considered user activity
    return this.saveWalletState(reason, true, sync);
  }

  public async setAdvancedSettings(
    advancedProperty: string,
    value: boolean | number
  ) {
    // Update Redux state
    store.dispatch(setAdvancedSettings({ advancedProperty, value }));

    // Save wallet state after changing settings - this is user activity
    this.saveWalletState('update-settings', true);

    // If this is the autolock setting, handle timer
    if (advancedProperty === 'autolock' && typeof value === 'number') {
      // Validate timer range (0 to disable, or 5-120 minutes)
      if (value !== 0 && (value < 5 || value > 120)) {
        throw new Error(
          'Auto-lock timer must be 0 (disabled) or between 5 and 120 minutes'
        );
      }

      // If value is 0, stop the timer. Otherwise, restart it
      if (value === 0) {
        await this.stopAutoLockTimer();
      } else {
        await this.startAutoLockTimer();
      }
    }
  }

  private async startAutoLockTimer() {
    try {
      const vaultGlobalState = store.getState().vaultGlobal;

      // Get the timer value from advancedSettings
      const autoLockTimer = vaultGlobalState?.advancedSettings?.autolock ?? 0; // Use 0 (disabled) as default

      // If autolock is 0, it's disabled - don't start the timer
      if (autoLockTimer === 0) {
        console.log('[MainController] Auto-lock is disabled (set to 0)');
        return;
      }

      if (!this.isUnlocked()) {
        return;
      }

      // Clear any existing auto-lock alarm
      await this.stopAutoLockTimer();

      // Create Chrome alarm for auto-lock
      chrome.alarms.create(this.autoLockAlarmName, {
        delayInMinutes: autoLockTimer as number,
      });

      console.log(
        `[MainController] Auto-lock timer started: ${autoLockTimer} minutes`
      );
    } catch (error) {
      console.error('[MainController] Error in startAutoLockTimer:', error);
      // Fail silently - auto-lock is a convenience feature, not critical
    }
  }

  private async stopAutoLockTimer() {
    // Clear the Chrome alarm
    chrome.alarms.clear(this.autoLockAlarmName);

    // Clear any pending reset timeout
    if (this.autoLockResetTimeout) {
      clearTimeout(this.autoLockResetTimeout);
      this.autoLockResetTimeout = null;
    }

    // Clear any pending save timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    console.log('[MainController] Auto-lock timer stopped');
  }

  // Reset auto-lock timer on user activity (debounced to prevent loops)
  public resetAutoLockTimer() {
    try {
      // Clear any existing reset timeout to debounce rapid calls
      if (this.autoLockResetTimeout) {
        clearTimeout(this.autoLockResetTimeout);
      }

      // Debounce the actual timer reset by 500ms to prevent rapid consecutive calls
      this.autoLockResetTimeout = setTimeout(() => {
        try {
          const vaultGlobalState = store.getState().vaultGlobal;

          // Get the timer value from advancedSettings
          const autoLockTimer =
            vaultGlobalState?.advancedSettings?.autolock ?? 0; // Use 0 (disabled) as default

          // Only restart timer if it's enabled (not 0) and wallet is unlocked
          if (autoLockTimer !== 0 && this.isUnlocked()) {
            // Restart the timer
            this.startAutoLockTimer().catch((error) => {
              console.error(
                '[MainController] Failed to restart auto-lock timer:',
                error
              );
            });
          }
        } catch (error) {
          console.error(
            '[MainController] Error in debounced resetAutoLockTimer:',
            error
          );
        } finally {
          this.autoLockResetTimeout = null;
        }
      }, 500); // 500ms debounce delay
    } catch (error) {
      console.error('[MainController] Error in resetAutoLockTimer:', error);
      // Fail silently - auto-lock is a convenience feature, not critical
    }
  }

  // Perform deferred vault save in background (non-blocking)
  private performDeferredVaultSave(deferredSaveData: {
    slip44: number;
    vaultState: any;
  }) {
    // Use setTimeout to defer the save, but handle async errors properly
    setTimeout(async () => {
      try {
        await vaultCache.setSlip44Vault(
          deferredSaveData.slip44,
          deferredSaveData.vaultState
        );
      } catch (error) {
        console.error(
          `[MainController] Deferred save failed for slip44 ${deferredSaveData.slip44}:`,
          error
        );
        // Since we're in an async context, we can't re-throw to the caller
        // Instead, we should handle the error appropriately here
        // For now, logging is sufficient as this is a background save
      }
    }, 10);
  }

  // Internal method to perform the actual save
  private async performSave(operation: string): Promise<void> {
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;

    if (activeSlip44 !== null) {
      const currentVaultState = store.getState().vault;

      // Save vault state to slip44-specific storage
      await vaultCache.setSlip44Vault(activeSlip44, currentVaultState);

      // Save main state (global settings)
      await saveMainState();

      console.log(
        `[MainController] Wallet state saved successfully for operation: ${operation}`
      );
    } else {
      console.warn(
        `[MainController] No active slip44 to save wallet state for operation: ${operation}`
      );
    }
  }

  // Centralized wallet state saving with debouncing - auto-lock timer reset only for user operations
  private async saveWalletState(
    operation: string,
    isUserActivity = false,
    sync = false
  ): Promise<void> {
    try {
      // Only reset auto-lock timer for explicit user activities, not automatic saves
      if (isUserActivity) {
        this.resetAutoLockTimer();
      }

      // If sync is true, save immediately
      if (sync) {
        // Clear any pending debounced save to prevent duplicate saves
        if (this.saveTimeout) {
          clearTimeout(this.saveTimeout);
          this.saveTimeout = null;
        }

        try {
          await this.performSave(operation);
        } catch (error) {
          console.error(
            `[MainController] Failed to save wallet state for operation ${operation}:`,
            error
          );
          throw error; // Re-throw for sync saves so caller knows it failed
        }
        return;
      }

      // Clear any existing save timeout to debounce rapid calls
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }

      // Debounce the actual save by 100ms to prevent rapid consecutive saves
      this.saveTimeout = setTimeout(async () => {
        try {
          await this.performSave(operation);
        } catch (error) {
          console.error(
            `[MainController] Failed to save wallet state for operation ${operation}:`,
            error
          );
          // Don't throw - the operation already succeeded, saving is just persistence
        } finally {
          this.saveTimeout = null;
        }
      }, 100); // 100ms debounce delay
    } catch (error) {
      console.error(
        `[MainController] Error in saveWalletState for operation ${operation}:`,
        error
      );
      // Fail silently for async saves - the main operation succeeded, saving is just persistence
      if (sync) {
        throw error;
      }
    }
  }

  public async forgetWallet(pwd: string) {
    // FIRST: Validate password - throws if wrong password or wallet locked
    // This prevents unnecessary cleanup if validation fails
    await this.forgetMainWallet(pwd);

    // Now proceed with cleanup since password is valid
    // Clear all timers first to prevent any background operations
    this.clearAllTimers();

    // Clean up notification manager to prevent memory leaks
    notificationManager.cleanup();

    // Properly dispose of all keyrings to prevent memory leaks
    this.disposeAllKeyrings();

    // Clear all keyring instances from memory
    this.keyrings.clear();

    // Clean up persistent providers
    this.cleanupPersistentProviders();

    // Cancel any pending async operations
    if (this.cancellablePromises.transactionPromise) {
      this.cancellablePromises.transactionPromise.cancel();
    }
    if (this.cancellablePromises.assetsPromise) {
      this.cancellablePromises.assetsPromise.cancel();
    }
    if (this.cancellablePromises.balancePromise) {
      this.cancellablePromises.balancePromise.cancel();
    }
    if (this.cancellablePromises.nftsPromise) {
      this.cancellablePromises.nftsPromise.cancel();
    }
    if (this.currentPromise) {
      this.currentPromise.cancel();
      this.currentPromise = null;
    }

    // Stop auto-lock timer
    await this.stopAutoLockTimer();

    // Reset internal state flags
    this.justUnlocked = false;
    this.isStartingUp = false;
    this.isAccountSwitching = false;
    this.isNetworkSwitching = false;

    // Clear vault cache (no emergency save - we're forgetting the wallet!)
    vaultCache.clearCache();

    // Clear all in-memory caches and session data
    if (this.transactionsManager) {
      this.transactionsManager.utils.clearCache();
    }
    clearProviderCache();
    clearFetchBackendAccountCache();
    clearRpcCaches();

    // Clear all vault-related storage completely
    // Remove vault from Chrome storage (both legacy and current keys)
    try {
      await chromeStorage.removeItem('sysweb3-vault');
      await chromeStorage.removeItem('sysweb3-vault-keys');
    } catch (error) {
      console.error('Error clearing vault storage:', error);
    }

    // Clear all slip44-specific vault states
    try {
      // Note: chromeStorage doesn't have a direct equivalent to chrome.storage.local.get(null)
      // so we'll keep this as direct chrome.storage.local for now as it's a specialized operation
      const allItems = await new Promise<{ [key: string]: any }>(
        (resolve, reject) => {
          chrome.storage.local.get(null, (items) => {
            if (chrome.runtime.lastError) {
              reject(
                new Error(
                  `Failed to get all items: ${chrome.runtime.lastError.message}`
                )
              );
              return;
            }
            resolve(items);
          });
        }
      );

      const keysToRemove = Object.keys(allItems).filter(
        (key) =>
          key.match(/^state-vault-\d+$/) ||
          key.startsWith('sysweb3-vault-') ||
          key === 'state' ||
          key.startsWith('state-')
      );

      if (keysToRemove.length > 0) {
        // Remove keys individually using chromeStorage
        await Promise.all(
          keysToRemove.map((key) => chromeStorage.removeItem(key))
        );
      }
    } catch (error) {
      console.error('Error clearing slip44 vault states:', error);
    }

    // Clear global settings via Redux
    store.dispatch(setHasEncryptedVault(false));
    store.dispatch(
      setAdvancedSettings({
        advancedProperty: 'refresh',
        value: false,
        isFirstTime: true,
      })
    );

    // Reset activeSlip44 to default after forgetting wallet
    // This ensures clean state regardless of what the previous wallet supported

    store.dispatch(setActiveSlip44(DEFAULT_UTXO_SLIP44));
    console.log(
      `[MainController] Reset activeSlip44 to default: ${DEFAULT_UTXO_SLIP44}`
    );

    store.dispatch(forgetWallet());
    store.dispatch(setLastLogin());

    // Send a specific message to indicate wallet was forgotten (not just locked)
    chrome.runtime.sendMessage({ type: 'wallet_forgotten' }).catch(() => {
      // Ignore errors - message handling is best effort
    });
  }

  public async unlockFromController(pwd: string): Promise<boolean> {
    // Ensure clean network state during login
    store.dispatch(resetNetworkStatus());
    const controller = getController();

    try {
      console.log('[MainController] Attempting unlock...');

      // Ensure storage is initialized before attempting unlock
      const storageManager = StorageManager.getInstance();
      await storageManager.ensureInitialized();
      console.log(
        '[MainController] Storage initialized, proceeding with unlock...'
      );

      // DEFENSIVE CHECK: Ensure vault state is properly initialized before keyring operations
      const currentVaultState = store.getState().vault;

      if (!currentVaultState.activeNetwork) {
        console.warn(
          '[MainController] activeNetwork is undefined during unlock, initializing vault state'
        );
        store.dispatch(
          setNetworkChange({
            activeNetwork: SYSCOIN_UTXO_MAINNET_NETWORK,
          })
        );
      }

      if (!currentVaultState.activeAccount) {
        console.warn(
          '[MainController] activeAccount is undefined during unlock, setting default'
        );
        store.dispatch(
          setActiveAccount({
            id: 0,
            type: KeyringAccountType.HDAccount,
          })
        );
      }

      this.lockAllKeyrings();
      const { canLogin, needsAccountCreation } = await this.unlock(pwd);

      if (!canLogin) {
        console.error('[MainController] Unlock failed - invalid password');
        throw new Error('Invalid password');
      }

      console.log('[MainController] Unlock successful');

      // Check if this is a migration from old vault format that needs account creation
      if (needsAccountCreation) {
        console.log(
          '[MainController] Detected migration from old vault format - creating first account'
        );

        try {
          const keyring = this.getActiveKeyring();
          const account = await keyring.createFirstAccount();

          console.log(
            '[MainController] Created first account after migration:',
            account.address
          );

          // Add account to Redux state
          store.dispatch(
            createAccount({
              account: account,
              accountType: KeyringAccountType.HDAccount,
            })
          );

          store.dispatch(
            setActiveAccount({
              id: account.id,
              type: KeyringAccountType.HDAccount,
            })
          );

          // Save the newly created account
          this.saveWalletState('migration-account-creation', true);
        } catch (error) {
          console.error(
            '[MainController] Failed to create account after migration:',
            error
          );
          throw new Error('Failed to create account after migration');
        }
      }

      // REPAIR CHECK: Detect and fix accounts with missing xpub/xprv
      await this.repairCorruptedAccounts();

      // Set flags to indicate we just unlocked and are starting up
      this.justUnlocked = true;
      this.isStartingUp = true;

      // Redux state should already be correct from persistence
      // The active keyring and Redux should be in sync - no need to update

      controller.dapp
        .handleStateChange(PaliEvents.lockStateChanged, {
          method: PaliEvents.lockStateChanged,
          params: {
            // Don't send accounts array - let DAppController determine accounts per dapp
            isUnlocked: true, // We just unlocked successfully
          },
        })
        .catch((error) => {
          console.error(
            '[MainController] Failed to notify dapps about unlock:',
            error
          );
          // Non-critical - popup update failure doesn't affect unlock success
        });

      // No need to update xprv in Redux store - private keys should only be accessed
      // through KeyringManager methods for security
      store.dispatch(setLastLogin());

      // Set connecting status for initial connection attempt
      store.dispatch(startConnecting());

      // Run full Pali update in background (non-blocking)
      setTimeout(() => {
        // Fetch fresh fiat prices immediately after successful unlock
        Promise.all([
          this.setFiat().catch((error) =>
            console.error(
              '[MainController] Failed to set fiat after unlock:',
              error
            )
          ),
          this.getLatestUpdateForCurrentAccount(false, true).catch((error) =>
            console.error(
              '[MainController] Failed to update account after unlock:',
              error
            )
          ),
        ]);
      }, 10);

      // Start auto-lock timer if enabled (not 0)
      const { advancedSettings } = store.getState().vaultGlobal;
      if (advancedSettings?.autolock && advancedSettings.autolock !== 0) {
        await this.startAutoLockTimer();
      }

      // Clear startup flags after 2 seconds
      setTimeout(() => {
        this.justUnlocked = false;
        this.isStartingUp = false;

        // Also clean up stale network quality data after startup
        store.dispatch(clearNetworkQualityIfStale());
      }, 2000); // 2 seconds - enough time for all initialization

      return canLogin;
    } catch (error) {
      console.error('[MainController] Unlock error:', error);
      throw error;
    }
  }

  /**
   * Repair corrupted accounts using an already-unlocked keyring (no password needed)
   * This is used during network switches when we already have session data
   */
  private async repairCorruptedAccountsWithSession(
    keyring: KeyringManager
  ): Promise<void> {
    try {
      const { accounts } = store.getState().vault;

      if (!keyring || !keyring.isUnlocked()) {
        console.log(
          '[MainController] Keyring not unlocked, skipping account repair'
        );
        return;
      }

      // Check if any HD accounts have missing xpub
      let hasCorruptedAccounts = false;
      if (accounts.HDAccount) {
        for (const account of Object.values(accounts.HDAccount)) {
          if (!account.xpub || account.xpub === '') {
            hasCorruptedAccounts = true;
            break;
          }
        }
      }

      if (!hasCorruptedAccounts) {
        console.log(
          '[MainController] No corrupted accounts found, skipping repair'
        );
        return;
      }

      console.log(
        '[MainController] Found corrupted HD accounts, recreating all accounts...'
      );

      // Store old account data for labels and metadata
      const oldAccounts = { ...accounts.HDAccount };
      const maxAccountId = Math.max(
        ...Object.keys(oldAccounts).map((id) => parseInt(id))
      );

      console.log(
        `[MainController] Will recreate ${maxAccountId + 1} HD accounts`
      );

      // Store accounts to recreate in a transaction array
      const recreatedAccounts: Array<{
        account: IKeyringAccountState;
        accountType: KeyringAccountType;
      }> = [];

      // First, validate we can recreate all accounts before modifying state
      for (let i = 0; i <= maxAccountId; i++) {
        try {
          const oldAccount = oldAccounts[i];
          const label =
            oldAccount?.label || (i === 0 ? 'Account 1' : `Account ${i + 1}`);

          let newAccount;
          if (i === 0) {
            // First account
            newAccount = await keyring.createFirstAccount();
            // Update the label if needed
            if (label !== 'Account 1') {
              newAccount.label = label;
            }
          } else {
            // Subsequent accounts
            newAccount = await keyring.addNewAccount(label);
          }

          console.log(`[MainController] Recreated HD account ${i}:`, {
            address: newAccount.address,
            xpub: newAccount.xpub ? 'present' : 'missing',
            label: newAccount.label,
            oldAddress: oldAccount?.address,
            addressMatch: newAccount.address === oldAccount?.address,
          });

          // Store for later commit
          recreatedAccounts.push({
            account: newAccount,
            accountType: KeyringAccountType.HDAccount,
          });

          // Warn if address changed (shouldn't happen with same seed)
          if (oldAccount && newAccount.address !== oldAccount.address) {
            console.error(
              `[MainController] WARNING: Address mismatch for account ${i}! Old: ${oldAccount.address}, New: ${newAccount.address}`
            );
          }
        } catch (error) {
          console.error(
            `[MainController] Failed to recreate HD account ${i}:`,
            error
          );
          throw error; // Stop the repair process on error
        }
      }

      // Now commit all changes atomically
      // Clear all HD accounts from Redux
      Object.keys(oldAccounts).forEach((idStr) => {
        const id = parseInt(idStr);
        store.dispatch(
          removeAccount({
            id,
            type: KeyringAccountType.HDAccount,
          })
        );
      });

      // Add all recreated accounts
      recreatedAccounts.forEach(({ account, accountType }) => {
        store.dispatch(
          createAccount({
            account,
            accountType,
          })
        );
      });

      // Save the repaired wallet state
      this.saveWalletState('repair-corrupted-accounts');

      console.log('[MainController] Account repair completed successfully');
    } catch (error) {
      console.error(
        '[MainController] Failed to repair corrupted accounts:',
        error
      );
      // Don't throw - we don't want to prevent network switch if repair fails
    }
  }

  /**
   * Detect and repair accounts with missing xpub/xprv by recreating them from the seed
   * This handles slip44 mismatches and corrupted account states
   */
  private async repairCorruptedAccounts(): Promise<void> {
    try {
      const { accounts, activeNetwork } = store.getState().vault;
      const keyring = this.getActiveKeyring();

      if (!keyring || !keyring.isUnlocked()) {
        console.log(
          '[MainController] Keyring not unlocked, skipping account repair'
        );
        return;
      }

      // Check if any HD accounts have missing xpub
      let hasCorruptedAccounts = false;
      if (accounts.HDAccount) {
        for (const account of Object.values(accounts.HDAccount)) {
          if (!account.xpub || account.xpub === '') {
            hasCorruptedAccounts = true;
            break;
          }
        }
      }

      if (!hasCorruptedAccounts) {
        console.log(
          '[MainController] No corrupted accounts found, skipping repair'
        );
        return;
      }

      console.log(
        '[MainController] Found corrupted HD accounts, recreating all accounts...'
      );

      // Store old account data for labels and metadata
      const oldAccounts = { ...accounts.HDAccount };
      const maxAccountId = Math.max(
        ...Object.keys(oldAccounts).map((id) => parseInt(id))
      );

      console.log(
        `[MainController] Will recreate ${maxAccountId + 1} HD accounts`
      );

      // Clear all HD accounts from Redux
      Object.keys(oldAccounts).forEach((idStr) => {
        const id = parseInt(idStr);
        store.dispatch(
          removeAccount({
            id,
            type: KeyringAccountType.HDAccount,
          })
        );
      });

      // Recreate all accounts in order
      for (let i = 0; i <= maxAccountId; i++) {
        try {
          const oldAccount = oldAccounts[i];
          const label =
            oldAccount?.label || (i === 0 ? 'Account 1' : `Account ${i + 1}`);

          let newAccount;
          if (i === 0) {
            // First account
            newAccount = await keyring.createFirstAccount();
            // Update the label if needed
            if (label !== 'Account 1') {
              newAccount.label = label;
            }
          } else {
            // Subsequent accounts
            newAccount = await keyring.addNewAccount(label);
          }

          console.log(`[MainController] Recreated HD account ${i}:`, {
            address: newAccount.address,
            xpub: newAccount.xpub ? 'present' : 'missing',
            label: newAccount.label,
            oldAddress: oldAccount?.address,
            addressMatch: newAccount.address === oldAccount?.address,
          });

          // Add the recreated account to Redux
          store.dispatch(
            createAccount({
              account: newAccount,
              accountType: KeyringAccountType.HDAccount,
            })
          );

          // Warn if address changed (shouldn't happen with same seed)
          if (oldAccount && newAccount.address !== oldAccount.address) {
            console.error(
              `[MainController] WARNING: Address mismatch for account ${i}! Old: ${oldAccount.address}, New: ${newAccount.address}`
            );
          }
        } catch (error) {
          console.error(
            `[MainController] Failed to recreate HD account ${i}:`,
            error
          );
          throw error; // Stop the repair process on error
        }
      }

      // Handle imported accounts separately - we can't repair these without private keys
      if (accounts.Imported) {
        let hasCorruptedImported = false;
        for (const account of Object.values(accounts.Imported)) {
          if (!account.xpub || account.xpub === '') {
            hasCorruptedImported = true;
            break;
          }
        }

        if (hasCorruptedImported) {
          console.warn(
            '[MainController] Found corrupted imported accounts - these cannot be auto-repaired without private keys'
          );
        }
      }

      // Ensure the active keyring network matches the current network
      await keyring.setSignerNetwork(activeNetwork);

      // Save the repaired wallet state
      this.saveWalletState('repair-corrupted-accounts');

      console.log('[MainController] Account repair completed successfully');
    } catch (error) {
      console.error(
        '[MainController] Failed to repair corrupted accounts:',
        error
      );
      // Don't throw - we don't want to prevent unlock if repair fails
      // The wallet might still be usable even with some corrupted accounts
    }
  }

  public async createWallet(password: string, phrase: string): Promise<void> {
    try {
      // CRITICAL FIX: Ensure vault state is properly initialized before keyring operations
      // The keyring manager expects activeNetwork and activeAccount to exist
      const currentVaultState = store.getState().vault;

      if (!currentVaultState.activeNetwork) {
        console.warn(
          '[MainController] activeNetwork is undefined, initializing vault state'
        );
        // Force initialization of vault state with defaults
        // This ensures activeNetwork exists before keyring operations
        store.dispatch(
          setNetworkChange({
            activeNetwork: SYSCOIN_UTXO_MAINNET_NETWORK,
          })
        );
      }

      if (!currentVaultState.activeAccount) {
        console.warn(
          '[MainController] activeAccount is undefined, setting default'
        );
        // Ensure activeAccount exists
        store.dispatch(
          setActiveAccount({
            id: 0,
            type: KeyringAccountType.HDAccount,
          })
        );
      }

      const keyring = this.getActiveKeyring();

      // This now uses the separated approach internally:
      // 1. initializeSession() - creates session data only
      // 2. createFirstAccount() - creates account without signer setup
      const account = await keyring.initializeWalletSecurely(phrase, password);

      // Add account to Redux state FIRST (before signer setup)
      store.dispatch(
        createAccount({
          account: account,
          accountType: KeyringAccountType.HDAccount,
        })
      );
      store.dispatch(
        setActiveAccount({
          id: account.id,
          type: KeyringAccountType.HDAccount,
        })
      );

      // Now account exists in vault state, so signer setup will work properly
      // (This is handled in the session transfer logic for network switching)

      // Update global settings to mark that we now have an encrypted vault
      store.dispatch(setHasEncryptedVault(true));
      store.dispatch(setLastLogin());

      // Save vault state to persistent storage after creating the first account
      // Use sync=true to ensure save completes before continuing
      await this.saveWalletState('create-wallet', true, true);

      // Start auto-lock timer if enabled (not 0)
      const { advancedSettings } = store.getState().vaultGlobal;
      if (advancedSettings?.autolock && advancedSettings.autolock !== 0) {
        await this.startAutoLockTimer();
      }

      setTimeout(() => {
        // Wrap in try-catch to prevent unhandled errors
        Promise.all([
          this.setFiat().catch((error) =>
            console.error(
              '[MainController] Failed to set fiat after wallet creation:',
              error
            )
          ),
          this.getLatestUpdateForCurrentAccount(false, true).catch((error) =>
            console.error(
              '[MainController] Failed to update account after wallet creation:',
              error
            )
          ),
        ]);
      }, 10);
    } catch (error) {
      console.error('[MainController] Failed to create wallet:', error);
      throw error;
    }
  }

  public lock() {
    const controller = getController();

    // Clear any pending timers before locking
    this.clearAllTimers();

    // Clean up notification manager to prevent memory leaks
    notificationManager.cleanup();

    this.logout();

    // Stop auto-lock timer when wallet is locked
    // This is best-effort - don't let timer cleanup failures prevent wallet lock
    this.stopAutoLockTimer().catch((error) => {
      console.error(
        '[MainController] Failed to stop auto-lock timer on lock:',
        error
      );
      // Continue with lock even if timer cleanup fails
      // The timer will be cleared on next unlock anyway
    });

    // Emergency save any dirty vaults before clearing cache
    vaultCache.emergencySave().catch((error) => {
      console.error(
        '[MainController] Failed to emergency save on lock:',
        error
      );
    });

    // Clear vault cache on lock
    vaultCache.clearCache();

    // Stop all rapid polling when wallet is locked
    this.stopAllRapidPolling();

    // Clear notification state when wallet is locked
    // Preserve pending transaction tracking when wallet is locked
    // This allows notifications to still show when transactions confirm
    notificationManager.clearState(true);

    store.dispatch(setLastLogin());

    // Send lockStateChanged event which will trigger accountsChanged internally
    // The provider will call _handleUnlockStateChanged which then calls _handleAccountsChanged
    controller.dapp
      .handleStateChange(PaliEvents.lockStateChanged, {
        method: PaliEvents.lockStateChanged,
        params: {
          // Don't send accounts array - DAppController will set it to empty when isUnlocked is false
          isUnlocked: false, // Explicitly set to false when locking
        },
      })
      .catch((error) => {
        console.error(
          '[MainController] Failed to notify dapps about lock state:',
          error
        );
        // Non-critical - dapp notification failure doesn't prevent wallet lock
      });
    return;
  }

  public async createAccount(label?: string): Promise<IKeyringAccountState> {
    const keyring = this.getActiveKeyring();
    const newAccount = await keyring.addNewAccount(label);

    // Validate account creation was successful before storing in Redux
    if (!newAccount.address || !newAccount.xpub) {
      console.error(
        '[MainController] Account creation returned invalid data:',
        {
          hasAddress: !!newAccount.address,
          hasXpub: !!newAccount.xpub,
          keyringUnlocked: keyring.isUnlocked(),
        }
      );
      throw new Error(
        'Account creation failed: invalid account data returned from keyring'
      );
    }

    store.dispatch(
      createAccount({
        account: newAccount,
        accountType: KeyringAccountType.HDAccount,
      })
    );
    store.dispatch(
      setActiveAccount({
        id: newAccount.id,
        type: KeyringAccountType.HDAccount,
      })
    );

    // Save wallet state after creating account
    // Use sync=true to ensure save completes before verification
    await this.saveWalletState('create-account', true, true);

    // Double-check the account was stored correctly
    const { accounts } = store.getState().vault;
    const storedAccount = accounts.HDAccount[newAccount.id];
    if (!storedAccount?.xpub) {
      console.error(
        '[MainController] WARNING: Account stored without xpub, attempting repair...'
      );
      // Attempt immediate repair
      store.dispatch(
        setAccountPropertyByIdAndType({
          id: newAccount.id,
          type: KeyringAccountType.HDAccount,
          property: 'xpub',
          value: newAccount.xpub,
        })
      );
    }

    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false, true).catch((error) => {
        console.error(
          '[MainController] Failed to update account after creation:',
          error
        );
        // This is non-critical - account was created successfully
        // The balance/transaction update will happen on next poll
      });
    }, 10);
    return newAccount;
  }

  public async setAccount(
    id: number,
    type: KeyringAccountType,
    sync = false
  ): Promise<void> {
    // Use AsyncMutex for cross-context synchronization
    // This prevents concurrent account switches across all contexts
    return accountSwitchMutex.runExclusive(async () => {
      try {
        // Cancel any pending async operations before switching accounts
        if (this.cancellablePromises.transactionPromise) {
          this.cancellablePromises.transactionPromise.cancel();
        }
        if (this.cancellablePromises.assetsPromise) {
          this.cancellablePromises.assetsPromise.cancel();
        }
        if (this.cancellablePromises.balancePromise) {
          this.cancellablePromises.balancePromise.cancel();
        }
        if (this.cancellablePromises.nftsPromise) {
          this.cancellablePromises.nftsPromise.cancel();
        }

        // Set switching account loading state
        store.dispatch(setIsSwitchingAccount(true));

        // Set active account
        store.dispatch(setActiveAccount({ id, type }));

        // Defer heavy operations to prevent blocking the UI
        if (sync) {
          await this.performPostAccountSwitchOperations();
        } else {
          this.performPostAccountSwitchOperations();
        }
      } catch (error) {
        console.error('Failed to set active account:', error);
        // Re-throw to let the UI handle the error
        throw error;
      }
    });
  }

  private async performPostAccountSwitchOperations() {
    try {
      await this.getLatestUpdateForCurrentAccount(false, true);
      // IMPORTANT: We do NOT automatically update dapp connections when switching accounts.
      // Each dapp maintains its own connection to a specific account. When a dapp needs
      // to interact with its connected account while a different account is active,
      // it will prompt the user to switch accounts (see message-handler/requests.ts).
      // This matches the behavior of MetaMask and other wallets.

      // Note: We do NOT emit global account change events here anymore.
      // Account change events should only be sent to dapps that are actually
      // connected to the specific account. This prevents confusion where all
      // dapps receive account change events even when they're not affected.
    } catch (error) {
      console.error('Error in post-account-switch operations:', error);
    } finally {
      store.dispatch(setIsSwitchingAccount(false));
      await this.saveWalletState('account-switch', true, true); // sync=true for immediate save
    }
  }

  public async setActiveNetwork(
    network: INetwork,
    syncUpdates = false
  ): Promise<{ chainId: string; networkVersion: number }> {
    // Cancel the current promise if it exists
    if (this.currentPromise) {
      this.currentPromise.cancel();
      this.currentPromise = null;
    }

    // Cancel any in-progress rapid polling
    this.stopAllRapidPolling();

    // Cancel any pending async operations upfront before switching networks
    if (this.cancellablePromises.transactionPromise) {
      this.cancellablePromises.transactionPromise.cancel();
    }
    if (this.cancellablePromises.assetsPromise) {
      this.cancellablePromises.assetsPromise.cancel();
    }
    if (this.cancellablePromises.balancePromise) {
      this.cancellablePromises.balancePromise.cancel();
    }
    if (this.cancellablePromises.nftsPromise) {
      this.cancellablePromises.nftsPromise.cancel();
    }

    // Ensure the network object has all required properties
    const completeNetwork: INetwork = {
      ...network,
      label: network.label || `Chain ${network.chainId}`,
    };

    const promiseWrapper = this.createCancellablePromise<{
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
    }>((resolve, reject) => {
      completeNetwork.kind;
      this.setActiveNetworkLogic(completeNetwork, resolve, reject);
    });

    this.currentPromise = promiseWrapper;

    // Return the promise chain with error handling attached
    return promiseWrapper.promise
      .then(async () => {
        await this.handleNetworkChangeSuccess(completeNetwork, syncUpdates);

        // Return the success result
        const isBitcoinBased = completeNetwork.kind === INetworkType.Syscoin;
        return {
          chainId: `0x${completeNetwork.chainId.toString(16)}`,
          networkVersion: completeNetwork.chainId,
          isBitcoinBased,
          network: completeNetwork,
        };
      })
      .catch((error) => {
        // Handle the error
        this.handleNetworkChangeError(error);

        // Don't re-throw cancellation errors
        if (
          error === 'Network change cancelled' ||
          (error && error.message === 'Network change cancelled') ||
          (error && typeof error === 'string' && error.includes('cancelled')) ||
          (error &&
            error.message &&
            error.message.includes('Cancel by network changing'))
        ) {
          // Return a success-like result for cancellations to prevent navigation issues
          return {
            chainId: `0x${completeNetwork.chainId.toString(16)}`,
            networkVersion: completeNetwork.chainId,
            cancelled: true,
          };
        }

        // Re-throw other errors so ChainErrorPage sees them
        throw error;
      });
  }

  public removeWindowEthProperty() {
    const controller = getController();
    controller.dapp.handleStateChange(PaliEvents.removeProperty, {
      method: PaliEvents.removeProperty,
      params: {
        type: PaliEvents.removeProperty,
      },
    });
  }

  public addWindowEthProperty() {
    const controller = getController();
    controller.dapp.handleStateChange(PaliEvents.addProperty, {
      method: PaliEvents.addProperty,
      params: {
        type: PaliEvents.addProperty,
      },
    });
  }

  public resolveError() {
    store.dispatch(setStoreError(null));
  }

  public async getRpc(
    data: ICustomRpcParams,
    retryCount = 0
  ): Promise<INetwork> {
    const MAX_RETRIES = 3;
    const INITIAL_RETRY_DELAY = 1000; // 1 second

    try {
      let result;
      if (data.isSyscoinRpc) {
        const sysRpcResult = await getSysRpc(data);
        result = sysRpcResult?.rpc?.formattedNetwork;
      } else {
        const ethRpcResult = await getEthRpc(data, false);
        result = ethRpcResult?.formattedNetwork;
      }

      if (!result) {
        throw new Error('Failed to get network configuration from RPC');
      }

      return result as INetwork;
    } catch (error: any) {
      console.error(
        `[MainController] getRpc error (attempt ${retryCount + 1}):`,
        error
      );

      // Check for authentication errors - don't retry these
      if (
        error.message?.includes('Authentication required') ||
        error.message?.includes('API key') ||
        error.message?.includes('unauthorized') ||
        error.message?.includes('forbidden')
      ) {
        throw new Error(
          'This RPC endpoint requires authentication. Please use an RPC URL that includes your API key or choose a different provider.'
        );
      }

      // Check for quality issues - don't retry these
      if (
        error.message?.includes('RPC response too fast') ||
        error.message?.includes('quality assurance')
      ) {
        throw error; // Pass through the quality error message
      }

      // Check for rate limiting and other retryable errors
      if (
        retryCount < MAX_RETRIES &&
        (error.message?.includes('429') ||
          error.message?.includes('503') ||
          error.message?.includes('Too many requests') ||
          error.message?.includes('Service Unavailable') ||
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('NetworkError') ||
          error.message?.includes('timeout'))
      ) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
        console.log(`[MainController] Retrying getRpc after ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.getRpc(data, retryCount + 1);
      }

      // Pass through the actual error message
      if (error instanceof Error) {
        throw error;
      }

      // Fallback for non-Error objects
      throw new Error(
        'Could not add your network, please try a different RPC endpoint'
      );
    }
  }

  public async handleWatchAsset(assetPreview: ITokenDetails): Promise<boolean> {
    const { isBitcoinBased } = store.getState().vault;

    if (isBitcoinBased) {
      throw new Error('Watch asset is not supported on Bitcoin networks');
    }

    try {
      // Use the provided asset details (already fetched by getAssetInfo) and convert to vault format
      const assetToAdd: ITokenEthProps = {
        tokenSymbol: assetPreview.symbol,
        contractAddress: assetPreview.contractAddress,
        decimals: assetPreview.decimals,
        isNft: assetPreview.isNft || false,
        balance: assetPreview.balance,
        logo:
          assetPreview.image?.large ||
          assetPreview.image?.small ||
          assetPreview.image?.thumb,
        chainId: assetPreview.chainId,
        name: assetPreview.name,
        id: assetPreview.id,
        tokenStandard: assetPreview.tokenStandard || 'ERC-20',
      };
      console.log(
        `[MainController] Using provided asset details for ${assetPreview.symbol}`
      );

      await this.saveTokenInfo(assetToAdd);

      console.log(
        `[MainController] Successfully added token ${assetToAdd.tokenSymbol} via dApp request`
      );
      return true;
    } catch (error) {
      console.error(
        '[MainController] Error handling dApp watch asset request:',
        error
      );
      throw new Error(error.message || 'Failed to add token');
    }
  }

  public async getAssetInfo(
    asset: IWatchAssetTokenProps
  ): Promise<ITokenDetails> {
    const {
      activeAccount: activeAccountInfo,
      accounts,
      isBitcoinBased,
    } = store.getState().vault;

    if (isBitcoinBased) {
      throw new Error('Asset info is not available on Bitcoin networks');
    }

    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];

    try {
      // Use market data validation to get enhanced token info including logos
      const tokenDetails = await this.getTokenDetailsWithMarketData(
        asset.address,
        activeAccount.address
      );

      if (!tokenDetails) {
        throw new Error('Invalid token contract or token not found');
      }

      // Use CoinGecko image if available, otherwise fall back to provided image or Pali logo
      const tokenLogo =
        tokenDetails.image?.large ||
        tokenDetails.image?.small ||
        tokenDetails.image?.thumb ||
        asset?.image ||
        PaliLogo;

      // Return the complete token details - UX will handle currency selection
      console.log(
        `[MainController] Retrieved enhanced asset info for ${tokenDetails.tokenStandard} token ${tokenDetails.symbol}`,
        {
          hasLogo: !!tokenLogo && tokenLogo !== PaliLogo,
          isVerified: tokenDetails.isVerified,
        }
      );

      return {
        ...tokenDetails,
        // Override with any provided asset data
        name: tokenDetails.name || asset.symbol || tokenDetails.symbol,
        // Use enhanced logo
        image: tokenLogo
          ? { large: tokenLogo, small: tokenLogo, thumb: tokenLogo }
          : tokenDetails.image,
      };
    } catch (error) {
      console.error('[MainController] Error getting asset info:', error);
      throw new Error(error.message || 'Failed to get token information');
    }
  }

  public async addCustomRpc(network: INetwork): Promise<INetwork> {
    const { networks } = store.getState().vaultGlobal;

    // Validate required fields
    if (
      !network.url ||
      network.chainId === null ||
      network.chainId === undefined ||
      !network.label
    ) {
      throw new Error('Missing required network configuration fields');
    }

    // Check if network already exists
    const networkType =
      network.kind === INetworkType.Syscoin ? 'syscoin' : 'ethereum';
    if (networks[networkType][network.chainId]) {
      throw new Error('network already exists, remove or edit it');
    }

    let networkWithCustomParams = {
      ...network,
      default: false,
    } as INetwork;

    // Auto-detect CoinGecko IDs for EVM networks
    if (network.kind === INetworkType.Ethereum) {
      try {
        console.log(
          `[MainController] Auto-detecting CoinGecko IDs for chainId ${network.chainId}`
        );
        const coinGeckoIds = await this.evmAssetsController.detectCoinGeckoIds(
          network.chainId
        );

        if (coinGeckoIds) {
          networkWithCustomParams = {
            ...networkWithCustomParams,
            ...(coinGeckoIds.coingeckoId && {
              coingeckoId: coinGeckoIds.coingeckoId,
            }),
            ...(coinGeckoIds.coingeckoPlatformId && {
              coingeckoPlatformId: coinGeckoIds.coingeckoPlatformId,
            }),
          };

          console.log(
            `[MainController] Successfully detected CoinGecko IDs for ${network.label}:`,
            {
              coingeckoId: coinGeckoIds.coingeckoId,
              coingeckoPlatformId: coinGeckoIds.coingeckoPlatformId,
            }
          );
        } else {
          console.log(
            `[MainController] No CoinGecko IDs found for ${network.label} (chainId: ${network.chainId})`
          );
        }
      } catch (error) {
        console.warn(
          `[MainController] Failed to auto-detect CoinGecko IDs for ${network.label}:`,
          error
        );
        // Continue without CoinGecko IDs - network will still work for basic functionality
      }
    }

    store.dispatch(setNetwork({ network: networkWithCustomParams }));

    // Save wallet state after adding custom network
    // Use sync=true to ensure save completes before returning
    await this.saveWalletState('add-custom-network', true, true);

    return networkWithCustomParams;
  }

  public async editCustomRpc(network: INetwork): Promise<INetwork> {
    // Update the network in the global networks store
    // The setNetwork reducer will automatically preserve CoinGecko IDs and other metadata
    store.dispatch(setNetwork({ network, isEdit: true }));

    // Save wallet state after editing network
    await this.saveWalletState('edit-network', true, true);
    return network;
  }

  public editAccountLabel(
    label: string,
    accountId: number,
    accountType: KeyringAccountType
  ) {
    store.dispatch(
      setAccountLabel({
        label,
        accountId,
        accountType,
      })
    );

    // Save wallet state after editing account label
    this.saveWalletState('edit-account-label', true);
  }

  public async removeAccount(
    accountId: number,
    accountType: KeyringAccountType
  ) {
    const { accounts, activeAccount } = store.getState().vault;

    // Safety check: Don't allow removing the active account
    if (activeAccount.id === accountId && activeAccount.type === accountType) {
      throw new Error(
        'Cannot remove the currently active account. Please switch to another account first.'
      );
    }

    // Safety check: Don't allow removing the last account
    const allAccountsCount = Object.values(accounts).reduce(
      (total, accountTypeAccounts) =>
        total + Object.keys(accountTypeAccounts).length,
      0
    );

    if (allAccountsCount <= 1) {
      throw new Error('Cannot remove the last remaining account.');
    }

    // Safety check: For HD accounts, don't allow removing if it's the only one
    if (accountType === KeyringAccountType.HDAccount) {
      const hdAccountsCount = Object.keys(accounts.HDAccount).length;
      if (hdAccountsCount <= 1) {
        throw new Error(
          'Cannot remove the only HD account. At least one HD account must remain.'
        );
      }
    }

    // Remove from store
    store.dispatch(removeAccount({ id: accountId, type: accountType }));

    // Notify connected DApps if needed
    const controller = getController();
    const { dapps } = store.getState().dapp;

    // Check if any dApps were connected to this account and disconnect them
    Object.keys(dapps).forEach((dappHost) => {
      const dapp = dapps[dappHost];
      if (
        dapp &&
        dapp.accountId === accountId &&
        dapp.accountType === accountType
      ) {
        controller.dapp.disconnect(dappHost);
      }
    });
    // Save wallet state after removing account
    await this.saveWalletState('remove-account', true, true);
  }

  public async removeKeyringNetwork(
    chain: INetworkType,
    chainId: number,
    rpcUrl: string,
    label: string,
    key?: string
  ) {
    // For UTXO networks, also remove the keyring and vault state since addresses might be different
    // when a new testnet/network with the same slip44 is added later
    if (chain === INetworkType.Syscoin) {
      const { networks } = store.getState().vaultGlobal;
      const networkToRemove = networks.syscoin[chainId];

      if (networkToRemove && networkToRemove.slip44 !== undefined) {
        const slip44ToRemove = networkToRemove.slip44;
        console.log(
          `[MainController] Removing keyring and vault state for slip44: ${slip44ToRemove} when removing network: ${label}`
        );

        // Remove the keyring for this slip44
        this.keyrings.delete(slip44ToRemove);

        // Also clear the persisted vault state for this slip44
        this.clearSlip44VaultState(slip44ToRemove).catch((error) => {
          console.error(
            `[MainController] Failed to clear vault state for slip44 ${slip44ToRemove}:`,
            error
          );
        });
      }
    }

    store.dispatch(removeNetwork({ chain, chainId, rpcUrl, label, key }));

    // Save wallet state after removing network
    await this.saveWalletState('remove-network', true, true);
  }

  private async clearSlip44VaultState(slip44: number): Promise<void> {
    try {
      // Clear the vault state from storage
      const storageKey = `state-vault-${slip44}`;
      await chromeStorage.removeItem(storageKey);

      // Clear from vault cache as well
      vaultCache.clearSlip44FromCache(slip44);

      console.log(
        `[MainController] Successfully cleared vault state for slip44: ${slip44}`
      );
    } catch (error) {
      console.error(
        `[MainController] Error clearing vault state for slip44 ${slip44}:`,
        error
      );
      throw error;
    }
  }

  public getRecommendedFee() {
    const { isBitcoinBased, activeNetwork } = store.getState().vault;

    try {
      if (isBitcoinBased) {
        return this.syscoinTransaction.getRecommendedFee(activeNetwork.url);
      } else {
        return this.ethereumTransaction.getRecommendedGasPrice(true);
      }
    } catch (error) {
      console.error('[MainController] Error getting recommended fee:', error);
      // Return fallback values
      return isBitcoinBased ? 0.0000001 : '20000000000'; // 20 gwei
    }
  }

  public async importAccountFromPrivateKey(privKey: string, label?: string) {
    const importedAccount = await this.getActiveKeyring().importAccount(
      privKey,
      label
    );
    store.dispatch(
      createAccount({
        account: importedAccount,
        accountType: KeyringAccountType.Imported,
      })
    );
    store.dispatch(
      setActiveAccount({
        id: importedAccount.id,
        type: KeyringAccountType.Imported,
      })
    );

    // Save wallet state after importing account from private key
    // Use sync=true to ensure save completes before continuing
    await this.saveWalletState('import-account-private-key', true, true);

    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false, true).catch((error) =>
        console.error(
          '[MainController] Failed to update account after importing private key:',
          error
        )
      );
    }, 10);

    return importedAccount;
  }

  public async importTrezorAccountFromController(label?: string) {
    let importedAccount;
    try {
      importedAccount = await this.getActiveKeyring().importTrezorAccount(
        label
      );
    } catch (error) {
      console.error('[MainController] Trezor import failed:', error);

      // Provide more specific error messages
      if (error.message?.includes('device is in use')) {
        throw new Error(
          'Trezor device is being used by another application. Please close other apps and try again.'
        );
      } else if (error.message?.includes('cancelled')) {
        throw new Error('Trezor operation was cancelled by the user.');
      } else if (error.message?.includes('disconnected')) {
        throw new Error(
          'Trezor device was disconnected. Please reconnect and try again.'
        );
      }

      throw new Error(
        'Could not import your account. Please ensure your Trezor is connected and unlocked.'
      );
    }

    store.dispatch(
      createAccount({
        account: importedAccount,
        accountType: KeyringAccountType.Trezor,
      })
    );
    store.dispatch(
      setActiveAccount({
        id: importedAccount.id,
        type: KeyringAccountType.Trezor,
      })
    );

    // Save wallet state after importing Trezor account
    await this.saveWalletState('import-account-trezor', true, true);

    // Update account with initial data
    try {
      await this.getLatestUpdateForCurrentAccount(false, true);
    } catch (updateError) {
      console.error(
        '[MainController] Failed to update Trezor account after import:',
        updateError
      );
      // Non-critical - account exists, just initial update failed
    }

    return importedAccount;
  }

  public async importLedgerAccountFromController(label?: string) {
    let importedAccount;
    try {
      importedAccount = await this.getActiveKeyring().importLedgerAccount(
        label
      );
    } catch (error) {
      console.error('[MainController] Ledger import failed:', error);

      // Provide more specific error messages
      if (error.message?.includes('Ledger device locked')) {
        throw new Error(
          'Ledger device is locked. Please unlock it and open the Syscoin app.'
        );
      } else if (error.message?.includes('app not open')) {
        throw new Error(
          'Please open the app on your Ledger device and try again.'
        );
      } else if (error.message?.includes('disconnected')) {
        throw new Error(
          'Ledger device was disconnected. Please reconnect and try again.'
        );
      } else if (error.message?.includes('cancelled')) {
        throw new Error('Ledger operation was cancelled by the user.');
      }

      throw new Error(
        'Could not import your account. Please ensure your Ledger is connected and the Syscoin app is open.'
      );
    }

    store.dispatch(
      createAccount({
        account: importedAccount,
        accountType: KeyringAccountType.Ledger,
      })
    );
    store.dispatch(
      setActiveAccount({
        id: importedAccount.id,
        type: KeyringAccountType.Ledger,
      })
    );

    // Save wallet state after importing Ledger account
    await this.saveWalletState('import-account-ledger', true, true);

    // Update account with initial data
    try {
      await this.getLatestUpdateForCurrentAccount(false, true);
    } catch (updateError) {
      console.error(
        '[MainController] Failed to update Ledger account after import:',
        updateError
      );
      // Non-critical - account exists, just initial update failed
    }

    return importedAccount;
  }

  public setEvmTransactionAsCanceled(txHash: string, chainID: number) {
    store.dispatch(
      setTransactionStatusToCanceled({
        txHash,
        chainID,
      })
    );
  }

  public setEvmTransactionAsAccelerated(
    oldTxHash: string,
    chainID: number,
    newTxValue: IEvmTransactionResponse
  ) {
    // Mark the old transaction as replaced
    store.dispatch(
      setTransactionStatusToAccelerated({
        oldTxHash,
        chainID,
      })
    );

    // Add metadata to the new transaction to indicate it's a speed-up
    const transactionWithMetadata = {
      ...newTxValue,
      timestamp: Math.floor(Date.now() / 1000), // Convert to seconds
      isSpeedUp: true,
      replacesHash: oldTxHash,
    };

    // Add the new transaction
    store.dispatch(
      setSingleTransactionToState({
        chainId: chainID,
        networkType: TransactionsType.Ethereum,
        transaction: transactionWithMetadata,
      })
    );
  }

  public updateUserTransactionsState({
    isBitcoinBased,
    activeNetwork,
    isPolling = false,
    isRapidPolling = false,
  }: {
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling?: boolean;
    isRapidPolling?: boolean;
  }) {
    // For polling, we don't need keyring access - we're just fetching public transaction data
    // Only check if unlocked for non-polling operations
    if (!isPolling) {
      const keyring = this.getActiveKeyring();
      if (!keyring.isUnlocked()) {
        console.log(
          '[MainController] Wallet is locked, skipping non-polling transaction updates'
        );
        // Return a resolved promise to maintain API consistency
        return Promise.resolve();
      }
    }

    const { accounts, activeAccount, accountTransactions } =
      store.getState().vault;
    const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
    const currentAccountTxs =
      accountTransactions[activeAccount.type]?.[activeAccount.id];
    const { currentPromise: transactionPromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            // Only set loading state for non-polling updates
            if (!isPolling) {
              store.dispatch(setIsLoadingTxs(true));
            }

            // Safe access to transaction objects with error handling
            const web3Provider = this.ethereumTransaction?.web3Provider;
            const txs =
              await this.transactionsManager.utils.updateTransactionsFromCurrentAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                web3Provider,
                currentAccountTxs,
                isPolling,
                isRapidPolling
              );

            // Dispatch transactions for both UTXO and EVM
            if (txs && !isEmpty(txs)) {
              store.dispatch(
                setAccountTransactions({
                  chainId: activeNetwork.chainId,
                  networkType: isBitcoinBased
                    ? TransactionsType.Syscoin
                    : TransactionsType.Ethereum,
                  transactions: txs,
                })
              );
            }

            // Clear loading state on success only if we set it
            if (!isPolling) {
              store.dispatch(setIsLoadingTxs(false));
            }
            resolve();
          } catch (error) {
            reject(error);
            // Don't clear loading state on error - let it stay until successful update
          }
        }
      );

    this.cancellablePromises.setPromise(PromiseTargets.TRANSACTION, {
      transactionPromise,
      cancel,
    });

    this.cancellablePromises.runPromise(PromiseTargets.TRANSACTION);
    return transactionPromise;
  }

  private async sendAndSaveTransaction(
    tx: IEvmTransactionResponse | ISysTransaction | ITxid
  ) {
    const { isBitcoinBased, activeNetwork } = store.getState().vault;

    // Handle ITxid type for UTXO transactions (returned by sendTransaction)
    if ('txid' in tx && Object.keys(tx).length === 1) {
      // This is an ITxid, create a minimal transaction object
      const minimalTx: Partial<ISysTransaction> = {
        txid: tx.txid,
        blockTime: Math.floor(Date.now() / 1000),
        confirmations: 0,
        blockHash: '',
        blockHeight: 0,
        fees: '0',
        hex: '',
        value: '0',
        valueIn: '0',
        version: 0,
        vin: [],
        vout: {} as any,
      };

      store.dispatch(
        setSingleTransactionToState({
          chainId: activeNetwork.chainId,
          networkType: TransactionsType.Syscoin,
          transaction: minimalTx as ISysTransaction,
        })
      );

      // Start rapid polling for this transaction
      try {
        console.log(
          `[MainController] Starting rapid polling for transaction ${tx.txid}`
        );
        this.startRapidTransactionPolling(tx.txid, activeNetwork.chainId, true);
        await this.saveWalletState('send-and-save-transaction', true, true);
      } catch (error) {
        console.error(
          '[MainController] Failed to start rapid transaction polling:',
          error
        );
      }

      // Always clear navigation state after successfully saving transaction
      try {
        await clearNavigationState();
        console.log(
          '[MainController] Navigation state cleared after transaction'
        );
      } catch (e) {
        console.error('[MainController] Failed to clear navigation state:', e);
      }

      return;
    }

    // Original logic for full transaction objects
    const txWithTimestamp = {
      ...tx,
      [`${isBitcoinBased ? 'blockTime' : 'timestamp'}`]: Math.floor(
        Date.now() / 1000
      ),
    } as IEvmTransactionResponse & ISysTransaction;

    store.dispatch(
      setSingleTransactionToState({
        chainId: activeNetwork.chainId,
        networkType: isBitcoinBased
          ? TransactionsType.Syscoin
          : TransactionsType.Ethereum,
        transaction: txWithTimestamp,
      })
    );

    // Start rapid polling for this transaction to detect confirmation quickly
    try {
      const txHash = isBitcoinBased
        ? (tx as ISysTransaction).txid
        : (tx as IEvmTransactionResponse).hash;

      console.log(
        `[MainController] Starting rapid polling for transaction ${txHash}`
      );

      // Start rapid polling inline to avoid import issues
      this.startRapidTransactionPolling(
        txHash,
        activeNetwork.chainId,
        isBitcoinBased
      );
      await this.saveWalletState('send-and-save-transaction', true, true);
    } catch (error) {
      console.error(
        '[MainController] Failed to start rapid transaction polling:',
        error
      );
    }

    // Always clear navigation state after successfully saving transaction
    try {
      await clearNavigationState();
      console.log(
        '[MainController] Navigation state cleared after transaction'
      );
    } catch (e) {
      console.error('[MainController] Failed to clear navigation state:', e);
    }
  }

  /**
   * Atomic wrapper that handles sign, send, and save in one operation
   * This ensures the transaction completes even if the popup window loses focus
   */
  public async signSendAndSaveTransaction(params: {
    isLedger?: boolean; // For UTXO transactions
    isTrezor?: boolean;
    pathIn?: string;
    psbt?: any;
  }): Promise<any> {
    const { isBitcoinBased } = store.getState().vault;

    try {
      if (isBitcoinBased && params.psbt) {
        // UTXO flow: sign -> send -> save
        const controller = getController();

        // Step 1: Sign the PSBT
        const signedPsbt = await controller.wallet.syscoinTransaction.signPSBT({
          psbt: params.psbt,
          isTrezor: params.isTrezor,
          isLedger: params.isLedger,
          pathIn: params.pathIn,
        });

        // Step 2: Send the transaction
        const txResult =
          await controller.wallet.syscoinTransaction.sendTransaction(
            signedPsbt
          );

        // Step 3: Save the transaction (this will also clear navigation state)
        await this.sendAndSaveTransaction(txResult);

        return txResult;
      } else {
        throw new Error('Unsupported transaction type for this wrapper');
      }
    } catch (error) {
      // Clear navigation state on error as well
      try {
        await clearNavigationState();
        console.error('[MainController] Navigation state cleared on error');
      } catch (e) {
        console.error(
          '[MainController] Failed to clear navigation state on error:',
          e
        );
      }
      throw error;
    }
  }

  /**
   * Atomic wrapper for EVM transactions
   * Combines send and save operations to ensure completion
   */
  public async sendAndSaveEthTransaction(
    params: any,
    isLegacy?: boolean
  ): Promise<IEvmTransactionResponse> {
    try {
      const controller = getController();

      // Check recipient address against blacklist
      if (params.to) {
        const blacklistResult = await blacklistService.checkAddress(params.to);
        if (
          blacklistResult.isBlacklisted &&
          (blacklistResult.severity === 'critical' ||
            blacklistResult.severity === 'high')
        ) {
          throw new Error(
            `Transaction blocked: ${
              blacklistResult.reason || 'Recipient address is blacklisted'
            }. Severity: ${blacklistResult.severity}`
          );
        }
      }

      // Send the formatted transaction
      const txResponse =
        await controller.wallet.ethereumTransaction.sendFormattedTransaction(
          params,
          isLegacy
        );

      // Save the transaction (this will also clear navigation state)
      await this.sendAndSaveTransaction(txResponse);

      return txResponse;
    } catch (error) {
      // Clear navigation state on error as well
      try {
        await clearNavigationState();
        console.error('[MainController] Navigation state cleared on error');
      } catch (e) {
        console.error(
          '[MainController] Failed to clear navigation state on error:',
          e
        );
      }
      throw error;
    }
  }

  /**
   * Get recommended nonce for batch transactions
   * Safely calls the ethereum transaction method to get the next nonce
   */
  public async getRecommendedNonceForBatch(address: string): Promise<number> {
    try {
      const controller = getController();
      return await controller.wallet.ethereumTransaction.getRecommendedNonce(
        address
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Atomic wrapper for token transactions (ERC20, ERC721, ERC1155)
   * Combines send and save operations to ensure completion
   */
  public async sendAndSaveTokenTransaction(
    tokenType: 'ERC20' | 'ERC721' | 'ERC1155',
    params: any
  ): Promise<IEvmTransactionResponse> {
    try {
      const controller = getController();

      // Check token recipient address against blacklist
      if (params.receiver) {
        const blacklistResult = await blacklistService.checkAddress(
          params.receiver
        );
        if (
          blacklistResult.isBlacklisted &&
          (blacklistResult.severity === 'critical' ||
            blacklistResult.severity === 'high')
        ) {
          throw new Error(
            `Token transfer blocked: ${
              blacklistResult.reason || 'The recipient address is blacklisted'
            }. Severity: ${
              blacklistResult.severity
            }. Please verify the token recipient address before proceeding.`
          );
        }
      }

      let txResponse;

      // Call the appropriate method based on token type
      switch (tokenType) {
        case 'ERC20':
          txResponse =
            await controller.wallet.ethereumTransaction.sendSignedErc20Transaction(
              params
            );
          break;
        case 'ERC721':
          txResponse =
            await controller.wallet.ethereumTransaction.sendSignedErc721Transaction(
              params
            );
          break;
        case 'ERC1155':
          txResponse =
            await controller.wallet.ethereumTransaction.sendSignedErc1155Transaction(
              params
            );
          break;
        default:
          throw new Error(`Unsupported token type: ${tokenType}`);
      }

      // Save the transaction (this will also clear navigation state)
      await this.sendAndSaveTransaction(txResponse);

      return txResponse;
    } catch (error) {
      // Clear navigation state on error as well
      try {
        await clearNavigationState();
        console.error('[MainController] Navigation state cleared on error');
      } catch (e) {
        console.error(
          '[MainController] Failed to clear navigation state on error:',
          e
        );
      }
      throw error;
    }
  }

  public async getState() {
    const state = store.getState();
    return state;
  }

  public updateAssetsFromCurrentAccount({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
    isPolling = false,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling?: boolean;
  }) {
    // Set loading state immediately for non-polling updates
    if (!isPolling) {
      store.dispatch(setIsLoadingAssets(true));
    }

    // For polling, we don't need keyring access - we're just fetching public asset balances
    // Only check if unlocked for non-polling operations
    if (!isPolling) {
      const keyring = this.getActiveKeyring();
      if (!keyring.isUnlocked()) {
        console.log(
          '[MainController] Wallet is locked, skipping non-polling asset updates'
        );
        // Clear loading state and return
        store.dispatch(setIsLoadingAssets(false));
        return Promise.resolve();
      }
    }

    const { accounts, accountAssets } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
    const currentAssets = accountAssets[activeAccount.type]?.[activeAccount.id];

    // Check if account exists before proceeding
    if (!currentAccount) {
      console.warn('[updateAssetsFromCurrentAccount] Active account not found');
      store.dispatch(setIsLoadingAssets(false));
      return Promise.resolve();
    }

    // Capture isPolling for use in the inner async function
    const isPollingUpdate = isPolling;

    const { currentPromise: assetsPromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            // Safe access to transaction objects with error handling
            const web3Provider = this.ethereumTransaction?.web3Provider;

            const updatedAssets =
              await this.assetsManager.utils.updateAssetsFromCurrentAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                activeNetwork.chainId,
                web3Provider,
                currentAssets || { ethereum: [], syscoin: [] }
              );
            const validateUpdatedAndPreviousAssetsLength =
              updatedAssets.ethereum.length < currentAssets.ethereum.length ||
              updatedAssets.syscoin.length < currentAssets.syscoin.length;

            const validateIfUpdatedAssetsStayEmpty =
              (currentAssets.ethereum.length > 0 &&
                isEmpty(updatedAssets.ethereum)) ||
              (currentAssets.syscoin.length > 0 &&
                isEmpty(updatedAssets.syscoin));

            const validateIfBothUpdatedIsEmpty =
              isEmpty(updatedAssets.ethereum) && isEmpty(updatedAssets.syscoin);

            const validateIfNotNullEthValues = updatedAssets.ethereum.some(
              (value) => isNil(value)
            );

            const validateIfIsInvalidDispatch =
              validateUpdatedAndPreviousAssetsLength ||
              validateIfUpdatedAssetsStayEmpty ||
              validateIfBothUpdatedIsEmpty ||
              validateIfNotNullEthValues;

            if (validateIfIsInvalidDispatch) {
              // Skip dispatch but still resolve - empty data might be valid
              // Only clear loading state if we set it
              if (!isPollingUpdate) {
                store.dispatch(setIsLoadingAssets(false));
              }
              resolve();
              return;
            }

            store.dispatch(
              setAccountAssets({
                accountId: activeAccount.id,
                accountType: activeAccount.type,
                assets: updatedAssets,
              })
            );

            // Clear loading state on success only if we set it
            if (!isPollingUpdate) {
              store.dispatch(setIsLoadingAssets(false));
            }
            resolve();
          } catch (error) {
            reject(error);
            // Don't clear loading state on error - let it stay until successful update
          }
        }
      );

    this.cancellablePromises.setPromise(PromiseTargets.ASSETS, {
      assetsPromise,
      cancel,
    });
    this.cancellablePromises.runPromise(PromiseTargets.ASSETS);

    // Return the promise so callers can wait for it to complete
    return assetsPromise;
  }

  public updateUserNativeBalance({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
    isPolling = false,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling?: boolean;
  }) {
    // Set loading state immediately for non-polling updates
    // This prevents skeleton flashing by ensuring loading state is set before any async operations
    if (!isPolling) {
      store.dispatch(setIsLoadingBalances(true));
    }

    // For polling, we don't need keyring access - we're just fetching public balance data
    // Only check if unlocked for non-polling operations
    if (!isPolling) {
      const keyring = this.getActiveKeyring();
      if (!keyring.isUnlocked()) {
        console.log(
          '[MainController] Wallet is locked, skipping non-polling balance updates'
        );
        // Clear loading state and return
        store.dispatch(setIsLoadingBalances(false));
        return Promise.resolve();
      }
    }

    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];

    // Check if account exists before proceeding
    if (!currentAccount) {
      console.warn(
        '[updateBalancesFromCurrentAccount] Active account not found'
      );
      store.dispatch(setIsLoadingBalances(false));
      return Promise.resolve();
    }

    // Capture isPolling for use in the inner async function
    const isPollingUpdate = isPolling;

    // No need to create a new provider - let the BalancesManager use its own provider
    // The BalancesManager already handles EVM vs UTXO networks correctly

    const { currentPromise: balancePromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          // Track start time for latency measurement
          const startTime = Date.now();

          try {
            // Safe access to transaction objects with error handling
            const web3Provider = this.ethereumTransaction?.web3Provider;

            const updatedBalance =
              await this.balancesManager.utils.getBalanceUpdatedForAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                web3Provider
                // No need to pass a provider - let the manager use its own
              );

            // Calculate latency
            const latency = Date.now() - startTime;

            // Update network quality state with latency info
            // The state will persist until the next balance update naturally occurs
            store.dispatch(
              updateNetworkQualityLatency({
                latency,
                minAcceptableLatency: 1000,
                criticalThreshold: 10000,
              })
            );

            if (latency > 1000) {
              console.warn(
                `[MainController] Balance update took ${latency}ms - network quality is poor`
              );
            } else if (latency > 500) {
              console.log(
                `[MainController] Balance update took ${latency}ms - exceeds minimum quality threshold`
              );
            } else {
              console.log(
                `[MainController] Balance update took ${latency}ms - network quality is good`
              );
            }

            const actualUserBalance = isBitcoinBased
              ? currentAccount.balances[INetworkType.Syscoin]
              : currentAccount.balances[INetworkType.Ethereum];
            const validateIfCanDispatch = areBalancesDifferent(
              actualUserBalance,
              updatedBalance
            );

            if (validateIfCanDispatch) {
              store.dispatch(
                setAccountPropertyByIdAndType({
                  id: activeAccount.id,
                  type: activeAccount.type,
                  property: 'balances',
                  value: {
                    ...currentAccount.balances,
                    [isBitcoinBased
                      ? INetworkType.Syscoin
                      : INetworkType.Ethereum]: updatedBalance,
                  },
                })
              );
            }

            // Clear loading state on success only if we set it
            if (!isPollingUpdate) {
              store.dispatch(setIsLoadingBalances(false));
            }
            resolve();
          } catch (error) {
            // Mark network quality as slow/poor on error
            const latency = Date.now() - startTime;
            store.dispatch(
              updateNetworkQualityLatency({
                latency: latency > 0 ? latency : 10000, // Use actual latency or 10s if immediate failure
                minAcceptableLatency: 1000,
                criticalThreshold: 10000,
              })
            );

            reject(error);
            // Don't clear loading state on error - let it stay until successful update
            // This keeps the status indicator visible when RPC is failing
          }
        }
      );

    this.cancellablePromises.setPromise(PromiseTargets.BALANCE, {
      balancePromise,
      cancel,
    });
    this.cancellablePromises.runPromise(PromiseTargets.BALANCE);

    // Return the promise so callers can wait for it to complete
    return balancePromise;
  }

  public async getLatestUpdateForCurrentAccount(
    isPolling = false,
    forceUpdate = false, // Force update even if just unlocked
    isRapidPolling = false // Skip expensive operations for rapid polling
  ): Promise<boolean> {
    // Set polling state early so getActiveKeyring knows it's a polling call
    store.dispatch(setIsPollingUpdate(isPolling));

    // For polling, we don't need the wallet to be unlocked - we're just fetching public data
    // Only check if unlocked for non-polling operations that might need private keys
    if (!isPolling) {
      const keyring = this.getActiveKeyring();
      if (!keyring.isUnlocked()) {
        console.log(
          '[MainController] Wallet is locked, skipping non-polling account updates'
        );
        store.dispatch(setIsPollingUpdate(false)); // Clear polling state
        return false;
      }
    }

    const {
      accounts,
      activeAccount,
      isBitcoinBased,
      activeNetwork,
      accountTransactions,
    } = store.getState().vault;

    const { isSwitchingAccount } = store.getState().vaultGlobal;

    const activeAccountValues =
      accounts[activeAccount.type]?.[activeAccount.id];
    if (!activeAccountValues) {
      console.warn(
        '[getLatestUpdateForCurrentAccount] Active account not found in accounts map',
        activeAccount
      );
      store.dispatch(setIsPollingUpdate(false)); // Clear polling state
      return false;
    }
    const currentAccountTransactions =
      accountTransactions[activeAccount.type][activeAccount.id];

    // Skip if we just unlocked and this is not a polling call or forced update
    // This prevents duplicate calls on startup - let polling handle it
    if (this.justUnlocked && !isPolling && !forceUpdate) {
      console.log(
        '[MainController] Skipping non-polling update right after unlock - polling will handle it'
      );
      store.dispatch(setIsPollingUpdate(false)); // Clear polling state
      return false;
    }

    // Guard: Skip EVM operations if web3Provider isn't ready (during keyring switches)
    // For polling when locked, we might not have access to ethereumTransaction
    try {
      if (!isBitcoinBased) {
        // Try to access the provider, but don't fail if locked during polling
        const provider =
          isPolling && !this.isUnlocked()
            ? null // Will be handled by the transaction/balance managers
            : this.ethereumTransaction?.web3Provider;

        if (!provider && !isPolling) {
          console.log(
            '[MainController] Skipping EVM update - web3Provider not ready (keyring may be switching)'
          );
          store.dispatch(setIsPollingUpdate(false)); // Clear polling state
          return false;
        }
      }
    } catch (error) {
      // During polling, this error is expected if wallet is locked
      if (!isPolling) {
        console.log(
          '[MainController] Cannot access ethereumTransaction - wallet may be locked or keyring switching'
        );
      }
      store.dispatch(setIsPollingUpdate(false)); // Clear polling state
      return false;
    }

    // Store initial state for change detection - latest tx object + balances
    const getLatestTx = (transactions: any) => {
      const networkType = isBitcoinBased ? 'syscoin' : 'ethereum';
      const chainTxs = transactions?.[networkType]?.[activeNetwork.chainId];

      if (!Array.isArray(chainTxs) || chainTxs.length === 0) {
        return null;
      }

      // Get the first transaction (should be latest due to desc sort)
      const latestTx = chainTxs[0];

      if (!latestTx) return null;

      // Create a normalized version that excludes confirmation changes after initial confirmation
      // We want to detect all changes EXCEPT confirmation increases after first confirmation
      // Shallow copy is safe since confirmations is a primitive number
      const normalizedTx = { ...latestTx };

      // If transaction has been confirmed (confirmations > 0), normalize confirmations to 1
      // This prevents hasChanges from being triggered by confirmation count increases
      // but still allows detection of 0 -> 1+ confirmation transitions
      // Works for both UTXO (blockbook) and EVM (web3) transaction formats
      if (
        typeof normalizedTx.confirmations === 'number' &&
        normalizedTx.confirmations > 0
      ) {
        normalizedTx.confirmations = 1; // Normalize to 1 to indicate "confirmed" (does not modify original)
      }

      return normalizedTx;
    };

    const initialStateSnapshot = JSON.stringify({
      balances: activeAccountValues.balances,
      latestTx: getLatestTx(currentAccountTransactions),
    });

    // Use Promise.allSettled for coordinated updates
    // This ensures all updates complete even if some fail
    const updatePromises = [
      this.updateAssetsFromCurrentAccount({
        isBitcoinBased,
        activeNetwork,
        activeAccount,
        isPolling,
      }),
      this.updateUserTransactionsState({
        isBitcoinBased,
        activeNetwork,
        isPolling,
        isRapidPolling,
      }),
      this.updateUserNativeBalance({
        isBitcoinBased,
        activeNetwork,
        activeAccount,
        isPolling,
      }),
    ];

    const results = await Promise.allSettled(updatePromises);

    // Log any failures for debugging and track which operations failed
    let balanceFailed = false;
    let transactionsFailed = false;
    let assetsFailed = false;

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        // Track which specific operations failed
        if (index === 0) assetsFailed = true;
        if (index === 1) transactionsFailed = true;
        if (index === 2) balanceFailed = true;
      }
    });

    // Clear loading states only for operations that succeeded
    // Keep loading states active for failed operations to show error state
    // Only clear if we set them in the first place (not polling)
    if (!isPolling) {
      const loadingStates = store.getState().vaultGlobal.loadingStates;

      if (!assetsFailed && loadingStates.isLoadingAssets) {
        store.dispatch(setIsLoadingAssets(false));
      }

      if (!transactionsFailed && loadingStates.isLoadingTxs) {
        store.dispatch(setIsLoadingTxs(false));
      }

      if (!balanceFailed && loadingStates.isLoadingBalances) {
        store.dispatch(setIsLoadingBalances(false));
      }
    }

    // If any core operation failed, set network status to error so timeout/error handling can trigger chain error page
    // But only for non-polling updates - we don't want to show error UI during background polling
    if (balanceFailed || transactionsFailed || assetsFailed) {
      console.error('[MainController] Account update failed', {
        balanceFailed,
        transactionsFailed,
        assetsFailed,
        isPolling,
      });
      store.dispatch(switchNetworkError());
    } else {
      // Balance succeeded - check if we need to clear connecting, switching, or error state
      const currentNetworkStatus = store.getState().vaultGlobal.networkStatus;
      if (currentNetworkStatus !== 'idle') {
        store.dispatch(switchNetworkSuccess()); // This sets networkStatus to 'idle'
      }
    }

    // Clear the post-network-switch loading flag now that initial load is complete
    // This allows UI elements (like faucet modals) to appear if needed
    store.dispatch(setPostNetworkSwitchLoading(false));

    // Always clear polling state when done
    store.dispatch(setIsPollingUpdate(false));

    // Check if anything changed by comparing initial and final state
    const {
      accounts: finalAccounts,
      accountTransactions: finalAccountTransactions,
    } = store.getState().vault;
    const finalAccountTxs =
      finalAccountTransactions[activeAccount.type]?.[activeAccount.id];
    const finalStateSnapshot = JSON.stringify({
      balances: finalAccounts[activeAccount.type]?.[activeAccount.id]?.balances,
      latestTx: getLatestTx(finalAccountTxs),
    });

    const hasChanges = initialStateSnapshot !== finalStateSnapshot;

    // Reduce logging during account switching to avoid noise
    if (!isSwitchingAccount) {
      console.log(
        `[MainController] Update detection: ${
          hasChanges ? 'CHANGES FOUND' : 'No changes'
        }`
      );
    }

    // Clear caches if changes were detected (balance/transaction activity)
    // This ensures fresh data on next call after activity occurs
    if (hasChanges && !isPolling) {
      console.log('[MainController] Clearing caches due to detected changes');
      if (this.transactionsManager) {
        this.transactionsManager.utils.clearCache();
        clearRpcCaches();
      }
      clearProviderCache();
      clearFetchBackendAccountCache();
    }

    return hasChanges;
  }

  public async setFaucetModalState({
    chainId,
    isOpen,
  }: {
    chainId: number;
    isOpen: boolean;
  }) {
    store.dispatch(setFaucetModalState({ chainId, isOpen }));
  }

  // Rapid transaction polling methods
  private startRapidTransactionPolling(
    txHash: string,
    chainId: number,
    isBitcoinBased: boolean
  ) {
    const pollKey = `${txHash}_${chainId}`;
    const maxPolls = 4;
    const pollInterval = 4000; // 4 seconds

    // Cancel any existing poll for this transaction
    if (this.activeRapidPolls.has(pollKey)) {
      clearTimeout(this.activeRapidPolls.get(pollKey)!);
      this.activeRapidPolls.delete(pollKey);
    }

    console.log(
      `[RapidPoll] Starting rapid polling for transaction ${txHash} on chain ${chainId}`
    );

    let pollCount = 0;

    const poll = async () => {
      pollCount++;
      console.log(
        `[RapidPoll] Poll ${pollCount}/${maxPolls} for transaction ${txHash}`
      );

      try {
        // Pass true for isPolling to handle errors silently
        // Pass true for isRapidPolling to skip expensive RPC scanning
        await checkForUpdates(true, true);
        // Check current transaction state before polling
        const { accountTransactions, activeAccount, activeNetwork } =
          store.getState().vault;

        if (!activeAccount || activeNetwork.chainId !== chainId) {
          console.log(
            '[RapidPoll] Network or account changed, stopping rapid poll'
          );
          this.activeRapidPolls.delete(pollKey);
          return;
        }

        const txs = accountTransactions[activeAccount.type]?.[activeAccount.id];
        const networkType = isBitcoinBased ? 'syscoin' : 'ethereum';
        const chainTxs = txs?.[networkType]?.[chainId];

        // Check if we have transactions array
        if (Array.isArray(chainTxs)) {
          // Find the specific transaction
          const tx = isBitcoinBased
            ? (chainTxs as ISysTransaction[]).find((t) => t.txid === txHash)
            : (chainTxs as IEvmTransactionResponse[]).find(
                (t) => t.hash === txHash
              );

          // Check if transaction is already confirmed
          if (tx && isTransactionInBlock(tx)) {
            const blockInfo = getTransactionBlockInfo(tx);
            console.log(
              `[RapidPoll] Transaction ${txHash} confirmed! In block: ${blockInfo}. Stopping rapid poll.`
            );
            this.activeRapidPolls.delete(pollKey);

            return;
          }
        }

        // Continue polling if not confirmed and haven't reached max polls
        if (pollCount < maxPolls) {
          console.log(
            `[RapidPoll] Transaction ${txHash} still pending, scheduling next poll...`
          );
          const timeoutId = setTimeout(poll, pollInterval);
          this.activeRapidPolls.set(pollKey, timeoutId);
        } else {
          console.log(
            `[RapidPoll] Reached max polls (${maxPolls}) for transaction ${txHash}. Regular background polling will continue.`
          );
          this.activeRapidPolls.delete(pollKey);
        }
      } catch (error) {
        console.error('[RapidPoll] Error during rapid polling:', error);
        this.activeRapidPolls.delete(pollKey);
      }
    };

    // Start the first poll after a delay
    const timeoutId = setTimeout(poll, pollInterval);
    this.activeRapidPolls.set(pollKey, timeoutId);
  }

  // Clean up all active polls (called when wallet locks)
  private stopAllRapidPolling() {
    this.activeRapidPolls.forEach((timeoutId) => clearTimeout(timeoutId));
    this.activeRapidPolls.clear();
    console.log('[RapidPoll] Stopped all rapid polling');
  }

  private handleStateChange(
    events: { method: PaliEvents | PaliSyscoinEvents; params: any }[]
  ) {
    const controller = getController();
    events.forEach((event: { method: PaliEvents; params: any }) => {
      controller.dapp.handleStateChange(event.method, event);
    });
  }
  private handleNetworkChangeError = (reason: any) => {
    const { activeNetwork } = store.getState().vault;

    console.error('Network change error:', reason);
    console.error('Error type:', typeof reason);
    if (reason) {
      console.error('Error structure:', {
        hasResponse: !!reason.response,
        hasData: !!reason.data,
        hasMessage: !!reason.message,
        hasError: !!reason.error,
        responseData: reason.response?.data,
        errorMessage: reason.message,
      });
    }

    // Check if this is a cancellation error - if so, ignore it
    if (
      reason === 'Network change cancelled' ||
      (reason && reason.message === 'Network change cancelled') ||
      (reason && typeof reason === 'string' && reason.includes('cancelled')) ||
      (reason &&
        reason.message &&
        reason.message.includes('Cancel by network changing'))
    ) {
      console.log('Network change was cancelled, ignoring error');
      // Don't set error state or dispatch error action
      return;
    }

    let errorMessage = `Failed to switch to ${activeNetwork.label}`;

    // Try to extract the actual error message from various error structures
    if (reason) {
      // Check for API response error (like from Infura)
      if (reason.response?.data?.message) {
        errorMessage = reason.response.data.message;
      } else if (reason.response?.data?.error?.message) {
        errorMessage = reason.response.data.error.message;
      } else if (
        reason.response?.data &&
        typeof reason.response?.data === 'string'
      ) {
        // Handle plain text responses (like "project ID does not have access to this network")
        errorMessage = reason.response.data;
      } else if (reason.data?.message) {
        errorMessage = reason.data.message;
      } else if (reason.error?.message) {
        errorMessage = reason.error.message;
      } else if (reason.message) {
        // Standard Error object - extract the meaningful part
        const msg = reason.message;

        // Look for JSON parsing errors that might contain the actual message
        // Match patterns like: Unexpected token 'p', "project ID..." is not valid JSON
        const jsonErrorMatch = msg.match(
          /Unexpected token\s*'.*?',\s*"([^"]+)"\s*.*?is not valid JSON/i
        );
        if (jsonErrorMatch && jsonErrorMatch[1]) {
          errorMessage = jsonErrorMatch[1];
        } else {
          // Also try to match simpler patterns
          const simpleMatch = msg.match(/"([^"]+)"\s*is not valid JSON/i);
          if (simpleMatch && simpleMatch[1]) {
            errorMessage = simpleMatch[1];
          } else {
            // Remove error prefixes
            errorMessage = msg
              .replace(/^Error:\s*/i, '')
              .replace(/^Error\s+/i, '')
              .trim();
          }
        }
      } else if (typeof reason === 'string') {
        errorMessage = reason;
      }
    }

    console.log('Final error message to display:', errorMessage);

    store.dispatch(setStoreError(errorMessage));
    store.dispatch(switchNetworkError());

    // Don't automatically reset network status for polling errors
    // Keep the error state so the status indicator stays red
    // Users can click on it to go to the error page and retry manually
  };

  private async configureNetwork(network: INetwork): Promise<{
    error?: any;
    success: boolean;
  }> {
    try {
      // setSignerNetwork will validate the network when setting up the provider
      const { success } = await this.setSignerNetwork(network);

      if (success) {
        return { success, error: null };
      }

      return {
        success: false,
        error: new Error('Failed to configure network'),
      };
    } catch (error) {
      console.error('configureNetwork error:', error);
      return { success: false, error };
    }
  }

  private resolveNetworkConfiguration(
    resolve: (value: {
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
    }) => void,
    {
      chainId,
      isBitcoinBased,
      network,
      networkVersion,
    }: {
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
    }
  ) {
    resolve({
      chainId,
      isBitcoinBased,
      network,
      networkVersion,
    });
  }
  private bindMethods() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      // Skip constructor and getters to avoid evaluating them during binding
      if (key === 'constructor') continue;

      // Get property descriptor to check if it's a getter
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (descriptor && descriptor.get) {
        // Skip getters - they should not be bound
        continue;
      }

      // Only bind actual methods
      if (typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }

  private createCancellablePromise<T>(
    executor: (
      resolve: (value: T) => void,
      reject: (reason?: any) => void
    ) => void
  ): { cancel: () => void; promise: Promise<T> } {
    let cancel = () => {
      // no-op
    };
    const promise: Promise<T> = new Promise((resolve, reject) => {
      cancel = () => {
        reject('Network change cancelled');
      };
      executor(resolve, reject);
    });

    return { promise, cancel };
  }
  private setActiveNetworkLogic = async (
    network: INetwork,
    resolve: (value: {
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
    }) => void,
    reject: (reason?: any) => void
  ) => {
    // Always dispatch startSwitchNetwork to ensure we're in the correct state
    store.dispatch(startSwitchNetwork(network));

    // Only reset network quality when switching to a different network
    const currentNetwork = store.getState().vault.activeNetwork;
    if (currentNetwork && currentNetwork.chainId !== network.chainId) {
      // Switching to a different network - reset quality tracking
      store.dispatch(resetNetworkQualityForNewNetwork());
    } else {
      // Same network - preserve quality state but clear stale data
      store.dispatch(clearNetworkQualityIfStale());
    }

    const isBitcoinBased = network.kind === INetworkType.Syscoin;
    try {
      const { success, error } = await this.configureNetwork(network);
      const chainId = network.chainId.toString(16);
      const networkVersion = network.chainId;

      if (success) {
        this.resolveNetworkConfiguration(resolve, {
          chainId,
          isBitcoinBased,
          network,
          networkVersion,
        });
      } else {
        // If there's an error from configureNetwork, use it; otherwise use a generic message
        const errorToReject =
          error ||
          new Error(
            'Failed to configure network - please check your connection'
          );
        reject(errorToReject);
      }
    } catch (error) {
      // Propagate the actual error instead of replacing it
      reject(error);
    }
  };
  private async handleNetworkChangeSuccess(
    network: INetwork,
    syncUpdates = false
  ) {
    const isBitcoinBased = network.kind === INetworkType.Syscoin;

    const { activeAccount } = store.getState().vault;
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;
    console.log(
      '[MainController] Network switch success - replacing vault state from keyring:',
      {
        slip44: activeSlip44,
        networkChainId: network.chainId,
        activeAccount: {
          id: activeAccount.id,
          type: activeAccount.type,
        },
      }
    );

    // Complete state replacement from keyring - this syncs everything automatically:
    // - activeAccount (id + type)
    // - activeNetwork
    // - all accounts
    // - network configuration
    // - isBitcoinBased (derived from activeChain)
    store.dispatch(setNetworkChange({ activeNetwork: network }));

    // Dispatch success immediately to prevent getting stuck in "switching" state
    store.dispatch(switchNetworkSuccess());

    // Execute updates synchronously if requested, otherwise with a small delay
    if (syncUpdates) {
      try {
        await this.setFiat();
        await this.getLatestUpdateForCurrentAccount(false);
      } finally {
        await this.saveWalletState('network-switch-after-updates', false, true);
      }
      // Don't throw error here - let the UI handle the network status
    } else {
      // Use Promise to ensure these operations complete even if popup closes
      Promise.resolve().then(async () => {
        try {
          await this.setFiat();
          await this.getLatestUpdateForCurrentAccount(false);
        } catch (error) {
          console.error(
            '[MainController] Failed to update after network change:',
            error
          );
          // Don't change network status here - it's already set to success
          // The error is just for balance updates, not the network switch itself
        } finally {
          // Ensure state is saved synchronously even on error
          try {
            await this.saveWalletState('network-switch-final', false, true);
          } catch (saveError) {
            console.error(
              '[MainController] Failed to save final state:',
              saveError
            );
          }
        }
      });
    }

    // Skip dapp notifications during startup
    if (this.isStartingUp) {
      console.log(
        '[MainController] Skipping network change dapp notifications during startup'
      );
      return;
    }
    // Get latest updates for the newly active account
    const { accounts } = store.getState().vault;
    const activeAccountData = accounts[activeAccount.type]?.[activeAccount.id];
    this.handleStateChange([
      {
        method: PaliEvents.chainChanged,
        params: {
          chainId: `0x${network.chainId.toString(16)}`,
          networkVersion: network.chainId,
          isBitcoinBased,
        },
      },
      {
        method: PaliEvents.isBitcoinBased,
        params: { isBitcoinBased },
      },
      {
        method: PaliSyscoinEvents.blockExplorerChanged,
        params: isBitcoinBased ? network.url : null,
      },
    ]);

    if (isBitcoinBased) {
      this.handleStateChange([
        {
          method: PaliEvents.xpubChanged,
          params: activeAccountData.xpub,
        },
        {
          method: PaliEvents.accountsChanged,
          params: null,
        },
      ]);
    } else {
      this.handleStateChange([
        {
          method: PaliEvents.xpubChanged,
          params: null,
        },
        {
          method: PaliEvents.accountsChanged,
          params: [activeAccountData.address],
        },
      ]);
    }
    // Don't dispatch success here - let getLatestUpdateForCurrentAccount handle it
    // after verifying the network actually works
  }
  // Transaction utilities from sysweb3-utils (previously from ControllerUtils)
  private txUtils = txUtils();

  // Expose txUtils methods individually for better type safety
  public getRawTransaction = this.txUtils.getRawTransaction;

  // Add decodeRawTransaction method for PSBT/transaction details display
  public decodeRawTransaction = (psbtOrHex: any, isRawHex = false) => {
    try {
      return this.syscoinTransaction.decodeRawTransaction(psbtOrHex, isRawHex);
    } catch (error) {
      console.error('Error decoding raw transaction:', error);
      throw new Error(`Failed to decode raw transaction: ${error.message}`);
    }
  };

  // Network status management
  public resetNetworkStatus(): void {
    store.dispatch(resetNetworkStatus());
  }

  // Initialize startup state when wallet is already unlocked
  public initializeStartupState(): void {
    if (this.isUnlocked()) {
      this.isStartingUp = true;
      setTimeout(() => {
        this.isStartingUp = false;
      }, 2000);
    }
  }

  // Wrapper methods for UI components to access provider functionality
  public getProviderStatus(): {
    errorMessage: string;
    isInCooldown: boolean;
    serverHasAnError: boolean;
  } {
    const provider = this.ethereumTransaction?.web3Provider;
    if (!provider) {
      return {
        isInCooldown: false,
        serverHasAnError: false,
        errorMessage: '',
      };
    }
    return {
      isInCooldown: provider.isInCooldown || false,
      serverHasAnError: provider.serverHasAnError || false,
      errorMessage: provider.errorMessage || '',
    };
  }

  // Get current block with latest data
  public async getCurrentBlock(): Promise<any> {
    const { isBitcoinBased } = store.getState().vault;

    if (isBitcoinBased) {
      throw new Error('getCurrentBlock is not available on Bitcoin networks');
    }

    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('Web3 provider not available');
    }

    return await this.ethereumTransaction.web3Provider.send(
      'eth_getBlockByNumber',
      ['latest', false]
    );
  }

  // Create EVM controller once (no provider stored)
  private evmAssetsController = EvmAssetsController();
  private evmTransactionsController = EvmTransactionsController();

  // Direct EVM methods for cleaner UI access

  public async checkContractType(contractAddress: string) {
    return this.evmAssetsController.checkContractType(
      contractAddress,
      this.ethereumTransaction.web3Provider
    );
  }

  public async getERC20TokenInfo(
    contractAddress: string,
    accountAddress: string
  ) {
    return this.evmAssetsController.getERC20TokenInfo(
      contractAddress,
      accountAddress,
      this.ethereumTransaction.web3Provider
    );
  }

  // Direct transaction EVM method for UI access
  public async testExplorerApi(apiUrl: string) {
    // The evmTransactionsController.testExplorerApi doesn't need a web3Provider
    // It just makes HTTP requests to test the API endpoint
    return this.evmTransactionsController.testExplorerApi(apiUrl);
  }

  /**
   * Fetch individual EVM transaction details from API (efficient, like getRawTransaction for UTXO)
   */
  public async getEvmTransactionFromAPI(hash: string, apiUrl: string) {
    return this.evmTransactionsController.fetchTransactionDetailsFromAPI(
      hash,
      apiUrl
    );
  }

  /**
   * Helper function to safely convert hex values and BigNumber objects to numbers or strings
   */
  private convertHexValue(
    hexValue: any,
    returnType: 'number' | 'string' = 'string'
  ): any {
    if (hexValue === null || hexValue === undefined) return null;

    // Handle BigNumber objects from web3 provider
    if (hexValue && typeof hexValue === 'object') {
      // Check for different BigNumber structures
      let hexString = null;

      if (hexValue.hex) {
        hexString = hexValue.hex;
      } else if (hexValue._hex) {
        hexString = hexValue._hex;
      } else if (hexValue.type === 'BigNumber' && hexValue.toHexString) {
        // Try calling toHexString method if available
        try {
          hexString = hexValue.toHexString();
        } catch (e) {
          console.warn('Failed to call toHexString on BigNumber:', e);
        }
      }

      if (hexString && hexString.startsWith('0x')) {
        try {
          const parsed = parseInt(hexString, 16);
          const result = returnType === 'number' ? parsed : parsed.toString();
          return result;
        } catch (error) {
          console.warn(`Failed to convert BigNumber ${hexString}:`, error);
          return hexValue;
        }
      }
    }

    // Handle hex strings
    const hexStr = hexValue.toString();
    if (!hexStr.startsWith('0x')) return hexValue; // Already converted or not hex

    try {
      const parsed = parseInt(hexStr, 16);
      return returnType === 'number' ? parsed : parsed.toString();
    } catch (error) {
      console.warn(`Failed to convert hex value ${hexStr}:`, error);
      return hexValue;
    }
  }

  /**
   * Fetch individual EVM transaction details from blockchain (for networks without API)
   */
  public async getEvmTransactionFromProvider(hash: string) {
    try {
      // Get transaction from provider
      const tx = await this.ethereumTransaction.web3Provider.getTransaction(
        hash
      );
      if (!tx) return null;

      // Get receipt for confirmation status
      let receipt = null;
      try {
        receipt =
          await this.ethereumTransaction.web3Provider.getTransactionReceipt(
            hash
          );
      } catch (receiptError) {
        // Transaction might be pending, receipt not available yet
        console.log(
          `Transaction ${hash} receipt not available (likely pending)`
        );
      }

      // Get current block number for confirmation count
      const latestBlock =
        await this.ethereumTransaction.web3Provider.getBlockNumber();
      const blockNumber = receipt
        ? this.convertHexValue(receipt.blockNumber, 'number')
        : null;
      const confirmations = blockNumber
        ? Math.max(0, latestBlock - blockNumber)
        : 0;

      // Get block timestamp for accurate timestamp (better than Date.now())
      let timestamp = Math.floor(Date.now() / 1000);
      if (receipt && receipt.blockNumber) {
        try {
          const block = await this.ethereumTransaction.web3Provider.getBlock(
            receipt.blockNumber
          );
          timestamp = block ? block.timestamp : timestamp;
        } catch (blockError) {
          console.log(
            `Could not fetch block ${receipt.blockNumber} for timestamp`
          );
        }
      }

      // Convert status from hex to boolean for proper comparison
      const isSuccess = receipt
        ? this.convertHexValue(receipt.status, 'number') === 1
        : null;

      // Return transaction in the same format as API (normalize for Enhanced component)
      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: this.convertHexValue(tx.value) || '0',
        blockNumber: blockNumber,
        blockHash: receipt ? receipt.blockHash : null,
        timestamp: timestamp,
        confirmations,
        chainId: this.convertHexValue(tx.chainId, 'number'),
        input: tx.data,
        gasPrice: this.convertHexValue(tx.gasPrice),
        gas: this.convertHexValue(tx.gasLimit),
        gasLimit: this.convertHexValue(tx.gasLimit), // Enhanced component expects gasLimit
        nonce: this.convertHexValue(tx.nonce, 'number'),
        gasUsed: receipt ? this.convertHexValue(receipt.gasUsed) : null,
        // Use effectiveGasPrice from receipt if available (more accurate for EIP-1559)
        effectiveGasPrice:
          receipt && receipt.effectiveGasPrice
            ? this.convertHexValue(receipt.effectiveGasPrice)
            : null,
        status:
          isSuccess === null ? 'pending' : isSuccess ? 'success' : 'failed',
        // Normalize to match Enhanced component expectations
        success: isSuccess,
        isError: isSuccess === null ? null : isSuccess ? '0' : '1',
        logs: receipt ? receipt.logs || [] : [], // Actual logs from receipt
        revertReason: null, // Not available from provider
        maxFeePerGas: this.convertHexValue(tx.maxFeePerGas),
        maxPriorityFeePerGas: this.convertHexValue(tx.maxPriorityFeePerGas),
        // Add other fields that Enhanced component might expect
        contractAddress: receipt ? receipt.contractAddress : null,
        cumulativeGasUsed: receipt
          ? this.convertHexValue(receipt.cumulativeGasUsed)
          : null,
        transactionIndex: receipt
          ? this.convertHexValue(receipt.transactionIndex, 'number')
          : null,
        // Method detection for enhanced display
        method: tx.data && tx.data !== '0x' ? 'Contract Interaction' : null,
        // Add type for EIP-1559 vs legacy transactions
        type: this.convertHexValue(tx.type),
        // Add any L1 fee info if available (for L2 chains like Optimism)
        l1Fee:
          receipt && receipt.l1Fee ? this.convertHexValue(receipt.l1Fee) : null,
        l1GasPrice:
          receipt && receipt.l1GasPrice
            ? this.convertHexValue(receipt.l1GasPrice)
            : null,
        l1GasUsed:
          receipt && receipt.l1GasUsed
            ? this.convertHexValue(receipt.l1GasUsed)
            : null,
        l1FeeScalar:
          receipt && receipt.l1FeeScalar ? receipt.l1FeeScalar : null, // This might be a decimal string
      };
    } catch (error) {
      console.error('Error fetching EVM transaction from provider:', error);
      return null;
    }
  }

  // Direct Syscoin methods for consistency
  public async getSysAssetsByXpub(xpub: string, url: string, chainId: number) {
    return this.assetsManager.sys.getSysAssetsByXpub(xpub, url, chainId);
  }

  public async addSysDefaultToken(assetGuid: string, networkUrl: string) {
    return this.assetsManager.sys.addSysDefaultToken(assetGuid, networkUrl);
  }

  public async getSysAssetMetadata(
    assetGuid: string,
    networkUrl: string
  ): Promise<ISysAssetMetadata | null> {
    return this.assetsManager.sys.getAssetCached(networkUrl, assetGuid);
  }

  public async saveTokenInfo(token: any) {
    const { isBitcoinBased } = store.getState().vault;
    let result;

    // Handle Ethereum tokens
    if (!isBitcoinBased || token.contractAddress) {
      result = await this.account.eth.saveTokenInfo(token);
    } else {
      // Handle Syscoin tokens
      result = await this.account.sys.saveTokenInfo(token);
    }

    // Save wallet state after adding token
    this.saveWalletState('add-token', true);

    return result;
  }

  public async deleteTokenInfo(tokenToDelete: any, chainId?: number) {
    const { isBitcoinBased, activeNetwork } = store.getState().vault;
    const currentChainId = chainId ?? activeNetwork.chainId;
    let result;

    // Handle Ethereum tokens (tokenToDelete is contractAddress string)
    if (
      !isBitcoinBased ||
      (typeof tokenToDelete === 'string' && tokenToDelete.startsWith('0x'))
    ) {
      result = await this.account.eth.deleteTokenInfo(
        tokenToDelete,
        currentChainId
      );
    } else {
      // Handle Syscoin tokens (tokenToDelete is assetGuid string)
      result = await this.account.sys.deleteTokenInfo(tokenToDelete);
    }

    // Save wallet state after deleting token
    await this.saveWalletState('delete-token', true, true);

    return result;
  }

  // Clean up persistent providers
  private cleanupPersistentProviders(): void {
    console.log('[MainController] Cleaning up persistent providers');

    this.persistentProviders.forEach((provider, url) => {
      try {
        // Remove all listeners if the provider has that method
        if (typeof provider.removeAllListeners === 'function') {
          provider.removeAllListeners();
        }
      } catch (error) {
        console.warn(
          `[MainController] Error cleaning up provider for ${url}:`,
          error
        );
      }
    });

    // Clear the map
    this.persistentProviders.clear();
  }
  /**
   * Get current network platform - delegates to EvmAssetsController
   */
  public getCurrentNetworkPlatform(): string | null {
    return this.evmAssetsController.getCurrentNetworkPlatform();
  }

  /**
   * Get fiat price data for network native token - delegates to EvmAssetsController
   */
  public async getTokenPriceData(chainId: number, currency?: string) {
    return await this.evmAssetsController.getTokenPriceData(chainId, currency);
  }

  /**
   * Cached UTXO price data fetching (same pattern as EVM)
   */
  private async getUtxoPriceData(
    networkUrl: string,
    currency = 'usd'
  ): Promise<{
    price: number;
    priceChange24h?: number;
  }> {
    // Check cache first
    const cacheKey = `${networkUrl}-${currency}`;
    const cached = this.utxoPriceDataCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.UTXO_PRICE_CACHE_DURATION) {
      console.log(
        `[MainController] Using cached UTXO price data for ${networkUrl}`
      );
      return cached.data;
    }

    try {
      const activeNetworkURL = ensureTrailingSlash(networkUrl);
      const response = await retryableFetch(
        `${activeNetworkURL}${ASSET_PRICE_API}`
      );
      const currencies = await response.json();

      if (currencies && currencies.rates && currencies.rates[currency]) {
        const result = {
          price: currencies.rates[currency],
          priceChange24h: undefined, // Backend doesn't provide 24h change for UTXO yet
        };

        // Cache the result
        this.utxoPriceDataCache.set(cacheKey, {
          data: result,
          timestamp: now,
        });

        console.log(
          `[MainController] Fetched and cached UTXO price data for ${networkUrl}`
        );
        return result;
      }

      console.warn(
        `[MainController] Failed to fetch UTXO price for currency ${currency} from ${networkUrl}`
      );
      return { price: 0 };
    } catch (error) {
      console.error(
        `[MainController] Error fetching UTXO price from ${networkUrl}:`,
        error
      );
      return { price: 0 };
    }
  }

  /**
   * Get basic token details from blockchain - delegates to EvmAssetsController
   */
  public async getTokenDetails(contractAddress: string, walletAddress: string) {
    return this.evmAssetsController.getTokenDetails(
      contractAddress,
      walletAddress,
      this.ethereumTransaction.web3Provider
    );
  }

  /**
   * PATH 1: Get tokens user actually owns via Blockscout API - delegates to EvmAssetsController
   */
  public async getUserOwnedTokens(walletAddress: string) {
    const {
      isBitcoinBased,
      accounts,
      activeAccount: activeAccountMeta,
    } = store.getState().vault;

    if (isBitcoinBased) {
      // For UTXO networks, use xpub to get SPT tokens
      const account = accounts[activeAccountMeta.type][activeAccountMeta.id];
      if (!account?.xpub) {
        throw new Error('No xpub found for active account');
      }
      return this.assetsManager.sys.getUserOwnedTokens(account.xpub);
    } else {
      // For EVM networks, use existing implementation
      return this.evmAssetsController.getUserOwnedTokens(walletAddress);
    }
  }

  /**
   * PATH 2: Validate and get basic fungible token info (for import forms) - delegates to EvmAssetsController
   */

  public async validateERC20Only(
    contractAddress: string,
    walletAddress: string
  ): Promise<ITokenDetails | null> {
    return this.evmAssetsController.validateERC20Only(
      contractAddress,
      walletAddress,
      this.ethereumTransaction.web3Provider
    );
  }

  /**
   * Get full token details with market data (for details screens) - delegates to EvmAssetsController
   */
  public async getTokenDetailsWithMarketData(
    contractAddress: string,
    walletAddress: string
  ) {
    return this.evmAssetsController.getTokenDetailsWithMarketData(
      contractAddress,
      walletAddress,
      this.ethereumTransaction.web3Provider
    );
  }

  /**
   * Get only market data from CoinGecko without any blockchain calls - delegates to EvmAssetsController
   */
  public async getOnlyMarketData(contractAddress: string) {
    return this.evmAssetsController.getOnlyMarketData(contractAddress);
  }

  /**
   * Fetch specific NFT token IDs for a collection
   */
  public async fetchNftTokenIds(
    contractAddress: string,
    ownerAddress: string,
    tokenStandard: 'ERC-721' | 'ERC-1155'
  ): Promise<{ balance: number; tokenId: string }[]> {
    return this.evmAssetsController.fetchNftTokenIds(
      contractAddress,
      ownerAddress,
      tokenStandard
    );
  }

  /**
   * Verify ownership of ERC-721 token IDs
   */
  public async verifyERC721Ownership(
    contractAddress: string,
    ownerAddress: string,
    tokenIds: string[]
  ): Promise<{ balance: number; tokenId: string; verified: boolean }[]> {
    return this.evmAssetsController.verifyERC721Ownership(
      contractAddress,
      ownerAddress,
      tokenIds,
      this.ethereumTransaction.web3Provider
    );
  }

  /**
   * Verify ownership of ERC-1155 token IDs
   */
  public async verifyERC1155Ownership(
    contractAddress: string,
    ownerAddress: string,
    tokenIds: string[]
  ): Promise<{ balance: number; tokenId: string; verified: boolean }[]> {
    return this.evmAssetsController.verifyERC1155Ownership(
      contractAddress,
      ownerAddress,
      tokenIds,
      this.ethereumTransaction.web3Provider
    );
  }

  public async validateSPTOnly(assetGuid: string, xpub: string) {
    const { activeNetwork } = store.getState().vault;
    // This method is for UTXO only
    return this.assetsManager.sys.validateSPTOnly(
      assetGuid,
      xpub,
      activeNetwork.url
    );
  }

  /**
   * Validate NFT contract for custom import - detects type and conditionally fetches balance
   */
  public async validateNftContract(
    contractAddress: string,
    walletAddress: string
  ) {
    const state = await this.getState();
    const { activeNetwork } = state.vault;

    if (activeNetwork.slip44 !== 60) {
      throw new Error('NFT validation only supported on EVM networks');
    }

    const abortController = new AbortController();
    const provider = new CustomJsonRpcProvider(
      abortController.signal,
      activeNetwork.url
    );

    return this.evmAssetsController.validateNftContract(
      contractAddress,
      walletAddress,
      provider
    );
  }

  /**
   * Validate Syscoin address for the given network
   */
  public validateSysAddress(address: string, chainId: number): boolean {
    return isValidSYSAddress(address, chainId);
  }

  /**
   * Get ERC20 ABI from sysweb3-utils
   */
  public getErc20Abi(): any[] {
    return getErc20Abi();
  }

  public getErc721Abi(): any[] {
    return getErc21Abi(); // Note: getErc21Abi returns ERC721 ABI
  }

  public getErc1155Abi(): any[] {
    return getErc55Abi(); // Note: getErc55Abi returns ERC1155 ABI
  }

  /**
   * Validate Ethereum EOA address
   */
  public async validateEOAAddress(
    address: string,
    provider: CustomJsonRpcProvider
  ): Promise<{
    contract: boolean | undefined;
    wallet: boolean | undefined;
  }> {
    const result = await validateEOAAddress(address, provider);
    return result;
  }

  /**
   * Test RPC connection using validateRpcBatchUniversal
   */
  public async testRpcConnection(
    url: string,
    networkType: INetworkType,
    chainId: number,
    maxLatency: number = 5000,
    minLatency: number = 500
  ): Promise<{ data?: any; error?: string; success: boolean }> {
    try {
      const result = await validateRpcBatchUniversal(
        url,
        networkType,
        chainId,
        maxLatency,
        minLatency
      );
      return result;
    } catch (error: any) {
      return { success: false, error: error.message || 'Connection failed' };
    }
  }

  /**
   * Decode EVM transaction data to determine transaction type and method
   * Used by transaction detail components to properly categorize transactions
   */
  public async decodeEvmTransactionData(
    transaction: any
  ): Promise<IDecodedTx | null> {
    try {
      // Validate the destination address to determine if it's a contract or wallet
      if (!transaction.to) {
        // No destination address - likely a contract deployment
        return {
          method: 'Contract Deployment',
          types: [],
          inputs: [],
          names: [],
        };
      }

      // Normalize transaction data - decodeTransactionData expects 'data' field
      const normalizedTransaction = {
        ...transaction,
        data: transaction.data || transaction.input, // Use 'data' field if available, otherwise use 'input'
      };

      // Use the existing decodeTransactionData function with web3Provider
      const decodedTx = await decodeTransactionData(
        normalizedTransaction,
        this.ethereumTransaction.web3Provider,
        this
      );

      return decodedTx as IDecodedTx;
    } catch (error) {
      console.error('Error decoding EVM transaction data:', error);
      return null;
    }
  }

  /**
   * Check if an address is a contract address for EVM networks
   * @param address - The address to check
   * @returns true if the address is a contract, false otherwise
   */
  public async isContractAddress(address: string): Promise<boolean> {
    try {
      // Check if we're on an EVM network
      const { isBitcoinBased } = store.getState().vault;
      if (isBitcoinBased) {
        throw new Error('isContractAddress is only available for EVM networks');
      }

      // Get the web3Provider from ethereumTransaction
      const web3Provider = this.ethereumTransaction?.web3Provider;
      if (!web3Provider) {
        throw new Error('Web3 provider not available');
      }

      // Check if the address has code
      const code = await web3Provider.getCode(address);
      return code && code !== '0x';
    } catch (error) {
      console.error('Error checking if address is contract:', error);
      return false;
    }
  }

  // Manual cleanup utility for vault data in main state
  public async cleanupMainStateVault() {
    try {
      // Load current main state
      const currentState = await chromeStorage.getItem('state');

      if (currentState && currentState.vault) {
        console.log(
          '[MainController] Found vault data in main state, cleaning up...'
        );

        // Remove vault data from state
        const { vault: _vault, ...cleanState } = currentState;
        void _vault; // Mark as intentionally unused

        // Save cleaned state
        await chromeStorage.setItem('state', cleanState);

        console.log(
          '[MainController] Successfully cleaned vault data from main state'
        );
        return true;
      }

      console.log('[MainController] No vault data found in main state');
      return false;
    } catch (error) {
      console.error('[MainController] Error cleaning up main state:', error);
      return false;
    }
  }

  public async getBalanceForAccount(
    account: IKeyringAccountState,
    isBitcoinBased: boolean,
    networkUrl: string
  ): Promise<string> {
    try {
      // For EVM networks, use the existing web3 provider
      const provider = isBitcoinBased
        ? null
        : this.ethereumTransaction.web3Provider;

      if (!isBitcoinBased && !provider) {
        console.error(
          '[MainController] No web3 provider available for EVM network'
        );
        return '0';
      }
      const balance =
        await this.balancesManager.utils.getBalanceUpdatedForAccount(
          account,
          isBitcoinBased,
          networkUrl,
          provider
        );

      return balance;
    } catch (error) {
      // Return 0 on error to allow UI to continue functioning
      return '0';
    }
  }

  // Chain info methods for frontend access
  public async getChainById(
    chainId: number,
    networkType?: INetworkType
  ): Promise<any> {
    try {
      const chainListService = ChainListService.getInstance();
      return await chainListService.getChainById(chainId, networkType);
    } catch (error) {
      console.error('[MainController] Error getting chain by ID:', error);
      return null;
    }
  }

  public async getChainData(networkType?: INetworkType): Promise<any[]> {
    try {
      const chainListService = ChainListService.getInstance();
      return await chainListService.getChainData(networkType);
    } catch (error) {
      console.error('[MainController] Error getting chain data:', error);
      return [];
    }
  }

  /**
   * Check if an address is blacklisted
   * @param address The address to check
   * @returns Blacklist check result with severity and reason
   */
  public async checkAddressBlacklist(
    address: string
  ): Promise<IBlacklistCheckResult> {
    try {
      return await blacklistService.checkAddress(address);
    } catch (error) {
      console.error('Error checking address blacklist:', error);
      // Return safe default on error
      return {
        isBlacklisted: false,
        severity: 'low',
      };
    }
  }
}

export default MainController;
