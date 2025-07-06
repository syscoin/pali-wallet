// Removed unused import: ethErrors
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';

import {
  KeyringManager,
  IKeyringAccountState,
  KeyringAccountType,
  CustomJsonRpcProvider,
} from '@pollum-io/sysweb3-keyring';
import {
  getSysRpc,
  getEthRpc,
  INetwork,
  INetworkType,
  clearRpcCaches,
  retryableFetch,
} from '@pollum-io/sysweb3-network';
import { txUtils } from '@pollum-io/sysweb3-utils';

import { getController } from '..';
import { checkForUpdates } from '../handlers/handlePaliUpdates';
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
  setIsLastTxConfirmed,
  setNetworkChange,
  setSingleTransactionToState,
  setAccountAssets,
  setAccountTransactions,
} from 'state/vault';
import { IOmmitedAccount, TransactionsType } from 'state/vault/types';
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
  setChangingConnectedAccount,
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
} from 'state/vaultGlobal';
import {
  ITokenEthProps,
  IWatchAssetTokenProps,
  ISysAssetMetadata,
  ITokenDetails,
} from 'types/tokens';
import { ICustomRpcParams } from 'types/transactions';
import { SYSCOIN_UTXO_MAINNET_NETWORK } from 'utils/constants';
import { logError } from 'utils/logger';
import { getNetworkChain } from 'utils/network';
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

  // Safe getter that checks if wallet is unlocked before returning keyring
  private getActiveKeyringIfUnlocked(): KeyringManager | null {
    const keyring = this.getActiveKeyring();

    if (!keyring.isUnlocked()) {
      // During network switching, the keyring might temporarily appear locked
      // due to session transfer between keyrings. Be more lenient in this case.
      if (this.isNetworkSwitching) {
        console.warn(
          '[MainController] Wallet appears locked during network switching, allowing operation to proceed'
        );
        return keyring; // Return the keyring anyway during network switching
      }

      // During polling, this might be a false positive - reduce log level
      const { isPollingUpdate } = store.getState().vaultGlobal;
      if (isPollingUpdate) {
        // Don't warn during polling - this is often a false positive
        return null;
      }

      console.warn('[MainController] Wallet is locked, skipping operation');
      return null;
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

    // 🔥 FIX: Capture unlocked keyring reference BEFORE any state changes
    // This ensures we have a valid keyring to transfer session from
    const anyUnlockedKeyring = isSwitchingSlip44
      ? Array.from(this.keyrings.values()).find((kr) => {
          try {
            return kr.isUnlocked();
          } catch (error) {
            console.warn(
              `[MainController] Error checking keyring unlock status:`,
              error
            );
            return false;
          }
        })
      : null;

    if (isSwitchingSlip44 && !anyUnlockedKeyring) {
      console.warn(
        `[MainController] WARNING: Switching slip44 but no unlocked keyring found! This will fail.`
      );
    }

    // Capture current vault state for deferred save (non-blocking)
    let deferredSaveData: { slip44: number; vaultState: any } | null = null;

    // CRITICAL: Defer activeSlip44 update if we need session transfer
    // This prevents getActiveKeyring() from returning the wrong (locked) keyring
    const shouldDeferActiveSlip44 = isSwitchingSlip44 && !!anyUnlockedKeyring;

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
        deferredSaveData = { slip44: activeSlip44, vaultState: vaultStateCopy };
      }

      // Load vault state for target slip44

      try {
        hasExistingVaultState = await loadAndActivateSlip44Vault(
          slip44,
          network,
          shouldDeferActiveSlip44 // Defer if session transfer needed
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

      // 🔥 FIX: Re-check if source keyring is still unlocked after state changes
      if (anyUnlockedKeyring && !anyUnlockedKeyring.isUnlocked()) {
        console.error(
          `[MainController] ERROR: Source keyring became locked during state update! Session transfer will fail.`
        );
      }
    }

    // Ensure the target keyring exists
    let targetKeyring = this.keyrings.get(slip44);
    let keyringWasJustCreated = false;
    if (!targetKeyring) {
      console.log('[MainController] Creating new keyring on demand');
      targetKeyring = this.createKeyringOnDemand();
      keyringWasJustCreated = true;
      // Store the new keyring immediately so it's available for subsequent operations
      this.keyrings.set(slip44, targetKeyring);
    }

    // 🔥 FIX: Transfer session if switching slip44 AND any keyring is unlocked
    // BUT skip if keyring was just created (already has session from createKeyringOnDemand)
    const needsSessionTransfer =
      isSwitchingSlip44 &&
      anyUnlockedKeyring &&
      (!keyringWasJustCreated || !targetKeyring.isUnlocked());

    if (!targetKeyring) {
      throw new Error(`Failed to get keyring for slip44: ${slip44}`);
    }

    // Handle session transfer if needed
    if (needsSessionTransfer && anyUnlockedKeyring) {
      try {
        const sourceSlip44 = Array.from(this.keyrings.entries()).find(
          ([, kr]) => kr === anyUnlockedKeyring
        )?.[0];

        // Double-check source keyring is still valid before transfer
        if (!anyUnlockedKeyring.isUnlocked()) {
          throw new Error(
            `Source keyring (slip44: ${sourceSlip44}) became locked before session transfer!`
          );
        }

        anyUnlockedKeyring.transferSessionTo(targetKeyring);

        // NOW it's safe to update activeSlip44 after session transfer
        if (shouldDeferActiveSlip44) {
          console.log(
            `[MainController] Setting activeSlip44 to ${slip44} after session transfer`
          );
          store.dispatch(setActiveSlip44(slip44));
        }

        // Only create accounts if no existing vault state was rehydrated
        if (!hasExistingVaultState) {
          // Ensure the keyring is properly unlocked before creating account
          if (!targetKeyring.isUnlocked()) {
            throw new Error(
              `Target keyring is not unlocked after session transfer! This should not happen.`
            );
          }

          // No existing vault state - create first account
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

    await targetKeyring.setSignerNetwork(network as any);

    // activeSlip44 is already set correctly by loadAndActivateSlip44Vault
    // No need to set it again - that could trigger unnecessary state updates

    // Ensure the keyring is stored in the map (might have been done earlier, but be sure)
    this.keyrings.set(slip44, targetKeyring);

    // Perform deferred save of previous vault state (non-blocking)
    if (deferredSaveData) {
      this.performDeferredVaultSave(deferredSaveData);
    }

    this.saveWalletState('network-switch');

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

  // Properly dispose of keyring instances to prevent memory leaks
  private disposeAllKeyrings(): void {
    this.keyrings.forEach((keyring, slip44) => {
      try {
        console.log(`[MainController] Disposing keyring for slip44: ${slip44}`);

        // Lock the keyring first to clear session data
        if (keyring.isUnlocked()) {
          keyring.lockWallet();
        }

        // Dispose of Trezor resources
        if (
          keyring.trezorSigner &&
          typeof keyring.trezorSigner.dispose === 'function'
        ) {
          keyring.trezorSigner.dispose();
        }

        // Clean up Web3 providers if they exist
        if (
          keyring.ethereumTransaction &&
          keyring.ethereumTransaction.web3Provider
        ) {
          try {
            // Remove all listeners from Web3 provider if it has removeAllListeners method
            const provider = keyring.ethereumTransaction.web3Provider;
            if (typeof provider.removeAllListeners === 'function') {
              provider.removeAllListeners();
            }
            // Destroy provider if it has a destroy method
            if (typeof provider.destroy === 'function') {
              provider.destroy();
            }
          } catch (providerError) {
            console.warn(
              `[MainController] Error disposing Web3 provider for slip44 ${slip44}:`,
              providerError
            );
          }
        }

        // If keyring has any other cleanup methods, call them here
        // Note: KeyringManager doesn't have a dispose method, but we've cleaned up its major components
      } catch (error) {
        console.error(
          `[MainController] Error disposing keyring for slip44 ${slip44}:`,
          error
        );
        // Continue with other keyrings even if one fails
      }
    });
  }

  // Proxy methods to active keyring - made public for UX access (used by controllerEmitter)
  public get syscoinTransaction() {
    const keyring = this.getActiveKeyringIfUnlocked();

    if (!keyring) {
      throw new Error(
        'Wallet is locked. Please unlock to access syscoin transactions.'
      );
    }

    const { isBitcoinBased } = store.getState().vault;
    if (!isBitcoinBased) {
      console.warn(
        '[MainController] Accessing syscoinTransaction for non-UTXO network'
      );
    }

    return keyring.syscoinTransaction;
  }

  public get ethereumTransaction() {
    const keyring = this.getActiveKeyringIfUnlocked();

    if (!keyring) {
      throw new Error(
        'Wallet is locked. Please unlock to access ethereum transactions.'
      );
    }

    const { isBitcoinBased } = store.getState().vault;
    if (isBitcoinBased) {
      console.warn(
        '[MainController] Accessing ethereumTransaction for UTXO network - this might cause issues'
      );
    }

    return keyring.ethereumTransaction;
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
    return this.getActiveKeyring().unlock(pwd);
  }

  public isUnlocked() {
    return this.getActiveKeyring().isUnlocked();
  }

  public isSeedValid(phrase: string) {
    return this.getActiveKeyring().isSeedValid(phrase);
  }

  private logout() {
    return this.getActiveKeyring().logout();
  }

  private async setSignerNetwork(network: INetwork) {
    // Set network switching flag for UI/logging purposes only
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
  }

  // Fiat price fetching functionality moved from ControllerUtils
  public async setFiat(currency?: string): Promise<void> {
    // Use Chrome storage as a global lock across all background script instances
    const FIAT_LOCK_KEY = 'pali_setfiat_lock';
    const LOCK_TIMEOUT = 30000; // 30 seconds timeout
    const MAX_RETRIES = 3;

    // Add random delay to prevent race conditions between multiple instances
    const randomDelay = Math.floor(Math.random() * 100) + 50; // 50-150ms
    await new Promise((resolve) => setTimeout(resolve, randomDelay));

    try {
      // Check and set global lock with retry mechanism
      const lockResult = await new Promise<boolean>((resolve) => {
        let retryCount = 0;

        const attemptLock = () => {
          chrome.storage.local.get([FIAT_LOCK_KEY], (storageResult) => {
            const existing = storageResult[FIAT_LOCK_KEY];
            const now = Date.now();

            // If no lock exists or lock is expired, acquire it
            if (!existing || now - existing.timestamp > LOCK_TIMEOUT) {
              // Use a unique identifier to detect race conditions
              const lockId = `${chrome.runtime.id}-${now}-${Math.random()}`;
              chrome.storage.local.set(
                {
                  [FIAT_LOCK_KEY]: {
                    timestamp: now,
                    instance: chrome.runtime.id,
                    lockId,
                  },
                },
                () => {
                  // Double-check that we actually got the lock (detect race conditions)
                  setTimeout(() => {
                    chrome.storage.local.get([FIAT_LOCK_KEY], (doubleCheck) => {
                      const currentLock = doubleCheck[FIAT_LOCK_KEY];
                      if (currentLock && currentLock.lockId === lockId) {
                        console.log(
                          `🔓 setFiat: Acquired global lock (attempt ${
                            retryCount + 1
                          }), proceeding`
                        );
                        resolve(true);
                      } else {
                        console.log(
                          `🔒 setFiat: Lost race condition (attempt ${
                            retryCount + 1
                          }), retrying...`
                        );
                        retryCount++;
                        if (retryCount < MAX_RETRIES) {
                          setTimeout(
                            attemptLock,
                            Math.floor(Math.random() * 200) + 100
                          ); // 100-300ms delay
                        } else {
                          console.log(
                            '🔒 setFiat: Max retries reached, skipping'
                          );
                          resolve(false);
                        }
                      }
                    });
                  }, 10); // Small delay for double-check
                }
              );
            } else {
              console.log(
                `🔒 setFiat: Global lock held by another instance (attempt ${
                  retryCount + 1
                }), skipping`
              );
              resolve(false);
            }
          });
        };

        attemptLock();
      });

      if (!lockResult) {
        return; // Another instance is handling it
      }

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
    } finally {
      // Release global lock
      chrome.storage.local.remove([FIAT_LOCK_KEY], () => {
        console.log('🔓 setFiat: Released global lock');
      });
    }
  }

  public setHasEthProperty(exist: boolean) {
    store.dispatch(setHasEthProperty(exist));
  }

  public async setAdvancedSettings(
    advancedProperty: string,
    value: boolean | number
  ) {
    // Update Redux state
    store.dispatch(setAdvancedSettings({ advancedProperty, value }));

    // Save wallet state after changing settings
    this.saveWalletState('update-settings');

    // If this is the autolock setting, restart the timer
    if (advancedProperty === 'autolock' && typeof value === 'number') {
      // Validate timer range (5-120 minutes)
      if (value < 5 || value > 120) {
        throw new Error('Auto-lock timer must be between 5 and 120 minutes');
      }

      // Always restart the timer since auto-lock is always enabled
      await this.startAutoLockTimer();
    }
  }

  private async startAutoLockTimer() {
    try {
      const vaultGlobalState = store.getState().vaultGlobal;

      // Auto-lock is always enabled, just get the timer value from advancedSettings
      const autoLockTimer = vaultGlobalState?.advancedSettings?.autolock || 5;

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

          // Auto-lock is always enabled, just get the timer value from advancedSettings
          const autoLockTimer = vaultGlobalState?.advancedSettings?.autolock;

          if (autoLockTimer && this.isUnlocked()) {
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
    try {
      setTimeout(() => {
        vaultCache.setSlip44Vault(
          deferredSaveData.slip44,
          deferredSaveData.vaultState
        );
      }, 10);
    } catch (error) {
      console.error(
        `[MainController] Deferred save failed for slip44 ${deferredSaveData.slip44}:`,
        error
      );
      throw error; // Re-throw to allow caller to handle
    }
  }

  // Centralized wallet state saving with debouncing and auto-lock timer reset
  private saveWalletState(operation: string): void {
    try {
      // Clear any existing save timeout to debounce rapid calls
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }

      // Reset auto-lock timer since this represents user activity
      this.resetAutoLockTimer();

      // Debounce the actual save by 100ms to prevent rapid consecutive saves
      this.saveTimeout = setTimeout(async () => {
        try {
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
      // Fail silently - the main operation succeeded, saving is just persistence
    }
  }

  public async forgetWallet(pwd: string) {
    // FIRST: Validate password - throws if wrong password or wallet locked
    // This prevents unnecessary cleanup if validation fails
    await this.forgetMainWallet(pwd);

    // Now proceed with cleanup since password is valid
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
      await new Promise<void>((resolve) => {
        chrome.storage.local.remove(
          ['sysweb3-vault', 'sysweb3-vault-keys'],
          () => {
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('Error clearing vault storage:', error);
    }

    // Clear all slip44-specific vault states
    try {
      const allItems = await new Promise<{ [key: string]: any }>((resolve) => {
        chrome.storage.local.get(null, (items) => {
          resolve(items);
        });
      });

      const keysToRemove = Object.keys(allItems).filter(
        (key) =>
          key.match(/^state-vault-\d+$/) ||
          key.startsWith('sysweb3-vault-') ||
          key === 'state' ||
          key.startsWith('state-')
      );

      if (keysToRemove.length > 0) {
        await new Promise<void>((resolve) => {
          chrome.storage.local.remove(keysToRemove, () => {
            resolve();
          });
        });
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
      const { canLogin } = await this.unlock(pwd);

      if (!canLogin) {
        console.error('[MainController] Unlock failed - invalid password');
        throw new Error('Invalid password');
      }

      console.log('[MainController] Unlock successful');

      // Set flags to indicate we just unlocked and are starting up
      this.justUnlocked = true;
      this.isStartingUp = true;

      // Redux state should already be correct from persistence
      // The active keyring and Redux should be in sync - no need to update

      controller.dapp
        .handleStateChange(PaliEvents.lockStateChanged, {
          method: PaliEvents.lockStateChanged,
          params: {
            accounts: [],
            isUnlocked: this.isUnlocked(),
          },
        })
        .catch((error) => console.error('Unlock', error));

      // No need to update xprv in Redux store - private keys should only be accessed
      // through KeyringManager methods for security
      store.dispatch(setLastLogin());

      // Set connecting status for initial connection attempt
      store.dispatch(startConnecting());

      // Run full Pali update in background (non-blocking)
      setTimeout(() => {
        // Fetch fresh fiat prices immediately after successful unlock
        this.setFiat();
        this.getLatestUpdateForCurrentAccount(false, true); // Force update after unlock
      }, 10);

      // Start auto-lock timer (always enabled)
      const { advancedSettings } = store.getState().vaultGlobal;
      if (advancedSettings?.autolock) {
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
      this.saveWalletState('create-wallet');

      setTimeout(() => {
        this.setFiat();
        this.getLatestUpdateForCurrentAccount(false, true); // Force update after wallet creation
      }, 10);
    } catch (error) {
      console.error('[MainController] Failed to create wallet:', error);
      throw error;
    }
  }

  public lock() {
    const controller = getController();
    this.logout();

    // Stop auto-lock timer when wallet is locked
    this.stopAutoLockTimer().catch((error) => {
      console.error(
        '[MainController] Failed to stop auto-lock timer on lock:',
        error
      );
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
    import('../notification-manager')
      .then(({ notificationManager }) => {
        // Preserve pending transaction tracking when wallet is locked
        // This allows notifications to still show when transactions confirm
        notificationManager.clearState(true);
      })
      .catch((error) => {
        console.error(
          '[MainController] Failed to clear notification state:',
          error
        );
      });

    store.dispatch(setLastLogin());

    controller.dapp
      .handleStateChange(PaliEvents.lockStateChanged, {
        method: PaliEvents.lockStateChanged,
        params: {
          accounts: [],
          isUnlocked: this.isUnlocked(),
        },
      })
      .catch((error) => console.error(error));
    return;
  }

  public async createAccount(label?: string): Promise<IKeyringAccountState> {
    const newAccount = await this.getActiveKeyring().addNewAccount(label);

    // Validate account creation was successful before storing in Redux
    if (!newAccount.address || !newAccount.xpub) {
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
    this.saveWalletState('create-account');

    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false, true); // Force update after account creation
    }, 10);
    return newAccount;
  }

  public async setAccount(
    id: number,
    type: KeyringAccountType,
    host?: string,
    connectedAccount?: IOmmitedAccount
  ): Promise<void> {
    const { accounts, activeAccount, isBitcoinBased } = store.getState().vault;

    try {
      // Prevent concurrent account switching
      if (this.isAccountSwitching) {
        console.log('Account switching already in progress, ignoring request');
        return;
      }

      this.isAccountSwitching = true;

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

      if (
        connectedAccount &&
        connectedAccount.address ===
          accounts[activeAccount.type][activeAccount.id].address
      ) {
        if (connectedAccount.address !== accounts[type][id].address) {
          store.dispatch(
            setChangingConnectedAccount({
              isChangingConnectedAccount: true,
              newConnectedAccount: accounts[type][id],
              connectedAccountType: type,
              host: host || undefined,
            })
          );
        }
      }

      // Set active account
      store.dispatch(setActiveAccount({ id, type }));

      // Defer heavy operations to prevent blocking the UI
      setTimeout(() => {
        this.performPostAccountSwitchOperations(
          isBitcoinBased,
          accounts,
          type,
          id
        );
      }, 0);
    } catch (error) {
      console.error('Failed to set active account:', error);
      // Re-throw to let the UI handle the error
      throw error;
    } finally {
      setTimeout(() => {
        store.dispatch(setIsSwitchingAccount(false));
        this.isAccountSwitching = false;
      }, 50); // Ensure this happens after other operations
    }
  }

  private async performPostAccountSwitchOperations(
    isBitcoinBased: boolean,
    accounts: any,
    type: KeyringAccountType,
    id: number
  ) {
    try {
      setTimeout(() => {
        this.getLatestUpdateForCurrentAccount(false, true); // Force update after account switch
      }, 10);

      // Skip dapp notifications and updates during startup
      if (this.isStartingUp) {
        console.log(
          '[MainController] Skipping dapp notifications and updates during startup'
        );
        return;
      }
      // Save wallet state after account switching (includes auto-lock timer reset)
      this.saveWalletState('account-switch');
      // Notify all connected DApps about the account change
      const controller = getController();
      const { dapps } = store.getState().dapp;
      const newAccount = accounts[type][id];

      // Update each connected DApp with the new account
      Object.keys(dapps).forEach((dappHost) => {
        if (dapps[dappHost]) {
          controller.dapp.changeAccount(dappHost, id, type);
        }
      });

      // Emit global account change events
      if (isBitcoinBased) {
        this.handleStateChange([
          {
            method: PaliEvents.xpubChanged,
            params: newAccount.xpub,
          },
        ]);
      } else {
        this.handleStateChange([
          {
            method: PaliEvents.accountsChanged,
            params: [newAccount.address],
          },
        ]);
      }
    } catch (error) {
      console.error('Error in post-account-switch operations:', error);
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

  public resolveAccountConflict() {
    store.dispatch(
      setChangingConnectedAccount({
        newConnectedAccount: undefined,
        host: undefined,
        isChangingConnectedAccount: false,
        connectedAccountType: undefined,
      })
    );
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
      };
      console.log(
        `[MainController] Using provided asset details for ${assetPreview.symbol}`
      );

      await this.account.eth.saveTokenInfo(assetToAdd);

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
    this.saveWalletState('add-custom-network');

    return networkWithCustomParams;
  }

  public async editCustomRpc(network: INetwork): Promise<INetwork> {
    // Update the network in the global networks store
    // The setNetwork reducer will automatically preserve CoinGecko IDs and other metadata
    store.dispatch(setNetwork({ network, isEdit: true }));

    // Save wallet state after editing network
    this.saveWalletState('edit-network');
    return network;
  }

  public setIsLastTxConfirmed(
    chainId: number,
    wasConfirmed: boolean,
    isFirstTime?: boolean
  ) {
    store.dispatch(
      setIsLastTxConfirmed({ chainId, wasConfirmed, isFirstTime })
    );
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
    this.saveWalletState('edit-account-label');
  }

  public removeAccount(accountId: number, accountType: KeyringAccountType) {
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

    // Save wallet state after removing account
    this.saveWalletState('remove-account');

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
  }

  public removeKeyringNetwork(
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
    this.saveWalletState('remove-network');
  }

  private async clearSlip44VaultState(slip44: number): Promise<void> {
    try {
      // Clear the vault state from storage
      const storageKey = `state-vault-${slip44}`;
      await new Promise<void>((resolve) => {
        chrome.storage.local.remove([storageKey], () => {
          resolve();
        });
      });

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
    this.saveWalletState('import-account-private-key');

    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false, true); // Force update after importing private key
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
      console.error(error);
      throw new Error(
        'Could not import your account, please try again: ' + error.message
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
    this.saveWalletState('import-account-trezor');

    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false, true); // Force update after importing Trezor account
    }, 10);

    return importedAccount;
  }

  public async importLedgerAccountFromController(
    isAlreadyConnected: boolean,
    label?: string
  ) {
    let importedAccount;
    try {
      importedAccount = await this.getActiveKeyring().importLedgerAccount(
        isAlreadyConnected,
        label
      );
    } catch (error) {
      console.error(error);
      throw new Error(
        'Could not import your account, please try again: ' + error.message
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
    this.saveWalletState('import-account-ledger');

    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false, true); // Force update after importing Ledger account
    }, 10);

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
  }: {
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling?: boolean;
  }) {
    // For polling, we don't need keyring access - we're just fetching public transaction data
    // Only check if unlocked for non-polling operations
    if (!isPolling) {
      const keyring = this.getActiveKeyringIfUnlocked();
      if (!keyring) {
        console.log(
          '[MainController] Wallet is locked, skipping non-polling transaction updates'
        );
        // Return a resolved promise to maintain API consistency
        return Promise.resolve();
      }
    }

    const { accounts, activeAccount, accountTransactions } =
      store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];
    const currentAccountTxs =
      accountTransactions[activeAccount.type][activeAccount.id];
    const { currentPromise: transactionPromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            // Only set loading state for non-polling updates
            if (!isPolling) {
              store.dispatch(setIsLoadingTxs(true));
            }

            // Safe access to transaction objects with error handling
            let web3Provider = null;
            try {
              if (!isBitcoinBased) {
                // Use persistent provider for polling or when locked
                if (isPolling || !this.isUnlocked()) {
                  web3Provider = this.getPersistentProvider(activeNetwork.url);
                } else {
                  web3Provider = this.ethereumTransaction.web3Provider;
                }
              }
            } catch (error) {
              // Fallback to persistent provider for EVM networks
              if (!isBitcoinBased) {
                web3Provider = this.getPersistentProvider(activeNetwork.url);
              } else {
                console.warn(
                  '[MainController] Cannot access ethereumTransaction:',
                  error
                );
                // Don't clear loading state on error - let it stay active
                reject(
                  new Error(
                    'Cannot access ethereumTransaction for transaction update'
                  )
                );
                return;
              }
            }

            const txs =
              await this.transactionsManager.utils.updateTransactionsFromCurrentAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                web3Provider,
                currentAccountTxs
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
            console.error('Error fetching transactions:', error);
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

  public async sendAndSaveTransaction(
    tx: IEvmTransactionResponse | ISysTransaction
  ) {
    const { isBitcoinBased, activeNetwork } = store.getState().vault;

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
    } catch (error) {
      console.error(
        '[MainController] Failed to start rapid transaction polling:',
        error
      );
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
    // For polling, we don't need keyring access - we're just fetching public asset balances
    // Only check if unlocked for non-polling operations
    if (!isPolling) {
      const keyring = this.getActiveKeyringIfUnlocked();
      if (!keyring) {
        console.log(
          '[MainController] Wallet is locked, skipping non-polling asset updates'
        );
        // Return a resolved promise to maintain API consistency
        return Promise.resolve();
      }
    }

    const { accounts, accountAssets } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];
    const currentAssets = accountAssets[activeAccount.type][activeAccount.id];

    // Only set loading state for non-polling updates
    if (!isPolling) {
      store.dispatch(setIsLoadingAssets(true));
    }

    // Capture isPolling for use in the inner async function
    const isPollingUpdate = isPolling;

    const { currentPromise: assetsPromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            // Safe access to transaction objects with error handling
            let web3Provider = null;
            try {
              if (!isBitcoinBased) {
                // Use persistent provider for polling or when locked
                if (isPollingUpdate || !this.isUnlocked()) {
                  web3Provider = this.getPersistentProvider(activeNetwork.url);
                } else {
                  web3Provider = this.ethereumTransaction.web3Provider;
                }
              }
            } catch (error) {
              // Fallback to persistent provider for EVM networks
              if (!isBitcoinBased) {
                web3Provider = this.getPersistentProvider(activeNetwork.url);
              } else {
                console.warn(
                  '[MainController] Cannot access ethereumTransaction for asset update:',
                  error
                );
                // Don't clear loading state on error - let it stay active
                reject(
                  new Error(
                    'Cannot access ethereumTransaction for asset update'
                  )
                );
                return;
              }
            }

            const updatedAssets =
              await this.assetsManager.utils.updateAssetsFromCurrentAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                activeNetwork.chainId,
                web3Provider,
                currentAssets
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
    // For polling, we don't need keyring access - we're just fetching public balance data
    // Only check if unlocked for non-polling operations
    if (!isPolling) {
      const keyring = this.getActiveKeyringIfUnlocked();
      if (!keyring) {
        console.log(
          '[MainController] Wallet is locked, skipping non-polling balance updates'
        );
        // Return a resolved promise to maintain API consistency
        return Promise.resolve();
      }
    }

    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    // Only set loading state for non-polling updates
    if (!isPolling) {
      store.dispatch(setIsLoadingBalances(true));
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
            let web3Provider = null;
            try {
              if (!isBitcoinBased) {
                // Use persistent provider for polling or when locked
                if (isPollingUpdate || !this.isUnlocked()) {
                  web3Provider = this.getPersistentProvider(activeNetwork.url);
                } else {
                  web3Provider = this.ethereumTransaction.web3Provider;
                }
              }
            } catch (error) {
              // Fallback to persistent provider for EVM networks
              if (!isBitcoinBased) {
                web3Provider = this.getPersistentProvider(activeNetwork.url);
              } else {
                console.warn(
                  '[MainController] Cannot access ethereumTransaction for balance update:',
                  error
                );
                // Don't clear loading state on error - let it stay active
                reject(
                  new Error(
                    'Cannot access ethereumTransaction for balance update'
                  )
                );
                return;
              }
            }

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
            const validateIfCanDispatch = Boolean(
              Number(actualUserBalance) !== parseFloat(updatedBalance)
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

            console.error(
              `[MainController] Balance update failed after ${latency}ms:`,
              error
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
    forceUpdate = false // Force update even if just unlocked
  ): Promise<boolean> {
    // Set polling state early so getActiveKeyringIfUnlocked knows it's a polling call
    store.dispatch(setIsPollingUpdate(isPolling));

    // For polling, we don't need the wallet to be unlocked - we're just fetching public data
    // Only check if unlocked for non-polling operations that might need private keys
    if (!isPolling) {
      const keyring = this.getActiveKeyringIfUnlocked();
      if (!keyring) {
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

    const activeAccountValues = accounts[activeAccount.type][activeAccount.id];
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
        const updateNames = ['assets', 'transactions', 'balance'];
        console.error(
          `[MainController] Failed to update ${updateNames[index]}:`,
          result.reason
        );

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

    // If balance failed, set network status to error to prevent green success indicator
    if (balanceFailed) {
      console.error(
        '[MainController] Balance update failed - keeping error state active'
      );
      store.dispatch(switchNetworkError());
    } else {
      // Only dispatch success if critical operations like balance succeeded
      store.dispatch(switchNetworkSuccess());

      // Don't clear network quality state here - let it persist to show the actual network quality
      // It will be cleared when switching to a different network or if it becomes stale
    }

    // Always clear polling state when done
    store.dispatch(setIsPollingUpdate(false));

    // Check if anything changed by comparing initial and final state
    const {
      accounts: finalAccounts,
      accountTransactions: finalAccountTransactions,
    } = store.getState().vault;
    const finalAccountTxs =
      finalAccountTransactions[activeAccount.type][activeAccount.id];
    const finalStateSnapshot = JSON.stringify({
      balances: finalAccounts[activeAccount.type][activeAccount.id].balances,
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
        await checkForUpdates();
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

    // Execute updates synchronously if requested, otherwise with a small delay
    if (syncUpdates) {
      await this.setFiat();
      await this.getLatestUpdateForCurrentAccount(false);
      // Don't throw error here - let the UI handle the network status
    } else {
      setTimeout(() => {
        this.setFiat();
        this.getLatestUpdateForCurrentAccount(false);
      }, 10);
    }

    // Skip dapp notifications during startup
    if (this.isStartingUp) {
      console.log(
        '[MainController] Skipping network change dapp notifications during startup'
      );
      // Don't dispatch success here - let getLatestUpdateForCurrentAccount handle it
      // after verifying the network actually works
      return;
    }
    // Get latest updates for the newly active account
    const { accounts } = store.getState().vault;
    const activeAccountData = accounts[activeAccount.type][activeAccount.id];
    this.handleStateChange([
      {
        method: PaliEvents.chainChanged,
        params: {
          chainId: `0x${network.chainId.toString(16)}`,
          networkVersion: network.chainId,
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
    const keyring = this.getActiveKeyring();
    if (!keyring) {
      throw new Error(
        'Wallet is locked. Please unlock to decode transactions.'
      );
    }
    try {
      return keyring.syscoinTransaction.decodeRawTransaction(
        psbtOrHex,
        isRawHex
      );
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
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
    return this.evmAssetsController.checkContractType(
      contractAddress,
      this.ethereumTransaction.web3Provider
    );
  }

  public async getERC20TokenInfo(
    contractAddress: string,
    accountAddress: string
  ) {
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
    return this.evmAssetsController.getERC20TokenInfo(
      contractAddress,
      accountAddress,
      this.ethereumTransaction.web3Provider
    );
  }

  public async updateAllEvmTokens(
    account: any,
    currentNetworkChainId: number,
    web3Provider: CustomJsonRpcProvider,
    accountAssets: ITokenEthProps[]
  ) {
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
    return this.evmAssetsController.updateAllEvmTokens(
      account,
      currentNetworkChainId,
      this.ethereumTransaction.web3Provider,
      accountAssets
    );
  }

  // Direct transaction EVM method for UI access
  public async testExplorerApi(apiUrl: string) {
    // The evmTransactionsController.testExplorerApi doesn't need a web3Provider
    // It just makes HTTP requests to test the API endpoint
    return this.evmTransactionsController.testExplorerApi(apiUrl);
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

  public async saveTokenInfo(token: any, tokenType?: string) {
    const { isBitcoinBased } = store.getState().vault;
    let result;

    // Handle Ethereum tokens
    if (!isBitcoinBased || token.contractAddress) {
      result = await this.account.eth.saveTokenInfo(token, tokenType);
    } else {
      // Handle Syscoin tokens
      result = await this.account.sys.saveTokenInfo(token);
    }

    // Save wallet state after adding token
    this.saveWalletState('add-token');

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
    this.saveWalletState('delete-token');

    return result;
  }

  // Get or create a persistent provider for a network
  private getPersistentProvider(
    networkUrl: string
  ): CustomJsonRpcProvider | null {
    // Use network URL as the key for provider caching
    const providerKey = networkUrl;

    // Check if we already have a provider for this network
    let provider = this.persistentProviders.get(providerKey);

    if (!provider) {
      try {
        console.log(
          `[MainController] Creating persistent provider for ${networkUrl}`
        );

        // Create a simple abort controller for the provider
        const abortController = new AbortController();

        // Create provider without needing keyring access
        provider = new CustomJsonRpcProvider(
          abortController.signal,
          networkUrl
        );

        // Store the provider for future use
        this.persistentProviders.set(providerKey, provider);
      } catch (error) {
        console.error(
          '[MainController] Failed to create persistent provider:',
          error
        );
        return null;
      }
    }

    return provider;
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
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
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
    // This method is for EVM only
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }

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
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
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
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
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
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
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
}

export default MainController;
