import { ethErrors } from 'helpers/errors';
import floor from 'lodash/floor';
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
} from '@pollum-io/sysweb3-network';
import {
  getSearch,
  getTokenStandardMetadata,
  txUtils,
} from '@pollum-io/sysweb3-utils';

import { getController } from '..';
import PaliLogo from 'assets/all_assets/favicon-32.png';
import { ASSET_PRICE_API } from 'constants/index';
import { setPrices, setCoins } from 'state/price';
import store from 'state/store';
import { loadAndActivateSlip44Vault, saveMainState } from 'state/store';
import {
  createAccount as addAccountToStore,
  forgetWallet,
  removeNetwork,
  setAccountPropertyByIdAndType,
  setActiveAccount,
  setTransactionStatusToAccelerated,
  setTransactionStatusToCanceled,
  setFaucetModalState,
  setIsLastTxConfirmed,
  setIsLoadingAssets,
  setIsLoadingBalances,
  setIsLoadingNfts,
  setIsLoadingTxs,
  setMultipleTransactionToState,
  setNetworkChange,
  setSingleTransactionToState,
  setNetwork,
  setAccountAssets,
  setAccountsWithLabelEdited,
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
  setCoinsList,
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
} from 'state/vaultGlobal';
import { ITokenEthProps, IWatchAssetTokenProps } from 'types/tokens';
import { ICustomRpcParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';
import { logError } from 'utils/logger';
import { getNetworkChain } from 'utils/network';

import EthAccountController, { IEthAccountController } from './account/evm';
import SysAccountController, { ISysAccountController } from './account/syscoin';
import AssetsManager from './assets';
import EvmAssetsController from './assets/evm';
import { IAssetsManager, INftController } from './assets/types';
import { ensureTrailingSlash } from './assets/utils';
import BalancesManager from './balances';
import { IBalancesManager } from './balances/types';
import { clearProviderCache } from './message-handler/requests';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';
import NftsController from './nfts/nfts';
import {
  CancellablePromises,
  PromiseTargets,
} from './promises/cancellablesPromises';
import {
  patchFetchWithPaliHeaders,
  getPaliHeaders,
} from './providers/patchFetchWithPaliHeaders';
import { StorageManager } from './storageManager';
import TransactionsManager from './transactions';
import EvmTransactionsController from './transactions/evm';
import {
  IEvmTransactionResponse,
  ISysTransaction,
  ITransactionsManager,
} from './transactions/types';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

// Constants for fiat price functionality
const COINS_LIST_CACHE_KEY = 'pali_coinsListCache';
const COINS_LIST_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

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
  private nftsController: INftController;
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
        if (vaultState?.activeNetwork?.slip44) {
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

    this.nftsController = NftsController();
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
      console.warn(
        `[MainController] No keyring found for slip44: ${activeSlip44}, creating on-demand`
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
    // 🔥 FIX: Find ANY unlocked keyring to transfer session from (handles undefined state)
    const anyUnlockedKeyring = Array.from(this.keyrings.values()).find((kr) =>
      kr.isUnlocked()
    );

    // Save current vault state before switching if we're changing slip44
    if (slip44 !== activeSlip44) {
      console.log(
        `[MainController] Switching keyring from slip44 ${activeSlip44} to ${slip44}`
      );

      // Save current vault state to cache and storage (background)
      const currentState = store.getState().vault;
      if (currentState && activeSlip44 !== null) {
        vaultCache
          .setSlip44Vault(activeSlip44, currentState)
          .then(() => {
            console.log(
              `[MainController] Pre-switch: background save completed for slip44=${activeSlip44}`
            );
          })
          .catch((error) => {
            console.error(
              `[MainController] Pre-switch: background save failed for slip44=${activeSlip44}:`,
              error
            );
          });
      }

      // Load vault state for target slip44 (this also sets activeSlip44 and saves main state)
      hasExistingVaultState = await loadAndActivateSlip44Vault(slip44, network);

      // Update vault state with correct network info
      store.dispatch(setNetworkChange({ activeNetwork: network }));

      // 🔥 Background save for network switching (don't block UI)
      vaultCache
        .setSlip44Vault(slip44, store.getState().vault)
        .then(() => {
          console.log(
            `[MainController] Network switch: background save completed for slip44=${slip44}`
          );
        })
        .catch((error) => {
          console.error(
            `[MainController] Network switch: background save failed for slip44=${slip44}:`,
            error
          );
        });
    }

    // 🔥 FIX: Transfer session if switching slip44 AND any keyring is unlocked
    const needsSessionTransfer = slip44 !== activeSlip44 && anyUnlockedKeyring;

    // Ensure the target keyring exists
    let targetKeyring = this.keyrings.get(slip44);
    if (!targetKeyring) {
      console.log('[MainController] Creating new keyring on demand');
      targetKeyring = this.createKeyringOnDemand();
    }

    if (!targetKeyring) {
      throw new Error(`Failed to get keyring for slip44: ${slip44}`);
    }

    // Handle session transfer if needed
    if (needsSessionTransfer && anyUnlockedKeyring) {
      try {
        anyUnlockedKeyring.transferSessionTo(targetKeyring);

        // Only create accounts if no existing vault state was rehydrated
        if (!hasExistingVaultState) {
          // No existing vault state - create first account
          // Session data was already transferred, so we can create the first account directly
          const account = await targetKeyring.createFirstAccount();
          console.log('[MainController] Created new keyring account', account);

          store.dispatch(
            addAccountToStore({
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
      // If target keyring is not unlocked and we didn't transfer session, fail
      if (slip44 !== activeSlip44) {
        console.error(
          `[MainController] No unlocked keyring found to transfer session from. Available keyrings: ${Array.from(
            this.keyrings.keys()
          )}`
        );
      }
      throw new Error(
        `Target keyring for slip44 ${slip44} is locked. Please unlock the wallet first.`
      );
    }

    await targetKeyring.setSignerNetwork(network as any);

    // Lock all other keyrings for security (belt and suspenders approach)
    this.keyrings.forEach((keyring, keyringSlip44) => {
      if (keyringSlip44 !== slip44 && keyring.isUnlocked()) {
        console.log(
          `[MainController] Locking non-active keyring for slip44: ${keyringSlip44}`
        );
        keyring.lockWallet();
      }
    });

    // activeSlip44 is already set correctly by loadAndActivateSlip44Vault
    // No need to set it again - that could trigger unnecessary state updates

    this.keyrings.set(slip44, targetKeyring);
  }

  // Create a keyring on demand with storage access
  private createKeyringOnDemand(): KeyringManager {
    // Create new keyring with the wallet state
    const keyring = new KeyringManager();

    // Set up storage access - this gives it access to the global encrypted vault
    keyring.setStorage(chrome.storage.local);
    keyring.setVaultStateGetter(() => store.getState().vault);

    return keyring;
    // Note: Session transfer is now handled in switchActiveKeyring method
  }

  // Lock all keyrings - used when user explicitly locks wallet
  private lockAllKeyrings(): void {
    this.keyrings.forEach((keyring) => {
      if (keyring.isUnlocked()) {
        keyring.lockWallet();
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

  private forgetMainWallet(pwd: string) {
    return this.getActiveKeyring().forgetMainWallet(pwd);
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

  private updateNetworkConfig(network: any) {
    return this.getActiveKeyring().updateNetworkConfig(network);
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

      let coinsList = null;
      try {
        const cachedData = await new Promise((resolve) => {
          chrome.storage.local.get(COINS_LIST_CACHE_KEY, (result) =>
            resolve(result[COINS_LIST_CACHE_KEY])
          );
        });

        if (
          cachedData &&
          (cachedData as any).timestamp &&
          Date.now() - (cachedData as any).timestamp < COINS_LIST_CACHE_DURATION
        ) {
          coinsList = (cachedData as any).list;
          console.log('Using cached coinsList');
        } else {
          console.log('Fetching new coinsList from CoinGecko');
          const response = await fetch(
            'https://api.coingecko.com/api/v3/coins/list?include_platform=true'
          );
          if (!response.ok) {
            throw new Error(
              `CoinGecko API request failed with status ${response.status}`
            );
          }
          coinsList = await response.json();
          if (coinsList && Array.isArray(coinsList)) {
            chrome.storage.local.set({
              [COINS_LIST_CACHE_KEY]: {
                list: coinsList,
                timestamp: Date.now(),
              },
            });
            store.dispatch(setCoinsList(coinsList));
          } else {
            coinsList = null;
            console.error('Fetched coinsList is not in expected format');
          }
        }
      } catch (fetchError) {
        console.error('Failed to fetch or cache coinsList:', fetchError);
        const coinsListState = store.getState().vaultGlobal.coinsList;
        if (coinsListState?.length > 0) {
          coinsList = coinsListState;
          console.log(
            'Using potentially stale coinsList from Redux store after fetch failure'
          );
        }
      }

      if (!coinsList) {
        coinsList = store.getState().vaultGlobal.coinsList;
        if (!coinsList || coinsList.length === 0) {
          logError('setFiat: coinsList is empty and could not be fetched.', '');
        }
      }

      switch (id) {
        case INetworkType.Syscoin:
          try {
            const activeNetworkURL = ensureTrailingSlash(activeNetwork.url);
            // Try to fetch prices for all networks - no testnet differentiation
            const currencies = await (
              await fetch(`${activeNetworkURL}${ASSET_PRICE_API}`)
            ).json();
            if (currencies && currencies.rates) {
              store.dispatch(setCoins(currencies.rates));
              if (currencies.rates[currency]) {
                store.dispatch(
                  setPrices({
                    asset: currency,
                    price: currencies.rates[currency],
                  })
                );
                return;
              }
            }

            store.dispatch(setPrices({ asset: currency, price: 0 }));
          } catch (error) {
            // If price API is not available (e.g., on testnets), just set price to 0
            store.dispatch(setPrices({ asset: currency, price: 0 }));
          }
          break;

        case INetworkType.Ethereum:
          try {
            // Try to fetch prices for all networks - no testnet differentiation

            if (coinsList && Array.isArray(coinsList) && coinsList.length > 0) {
              const findCoinSymbolByNetwork = coinsList.find(
                (coin: any) => coin.symbol === activeNetwork.currency
              )?.id;

              if (findCoinSymbolByNetwork) {
                const coinPriceResponse = await fetch(
                  `https://api.coingecko.com/api/v3/simple/price?ids=${findCoinSymbolByNetwork}&vs_currencies=${currency}`
                );
                const coinPriceData = await coinPriceResponse.json();
                const currentNetworkCoinMarket =
                  coinPriceData[findCoinSymbolByNetwork]?.[
                    currency.toLowerCase()
                  ];

                store.dispatch(
                  setPrices({
                    asset: currency,
                    price: currentNetworkCoinMarket
                      ? currentNetworkCoinMarket
                      : 0,
                  })
                );
              } else {
                logError(
                  `Could not find ID for currency symbol: ${activeNetwork.currency} in CoinGecko list`,
                  ''
                );
                store.dispatch(setPrices({ asset: currency, price: 0 }));
              }
            } else {
              logError(
                'setFiat EVM: coinsList not available, attempting to use stale price or default to 0.',
                ''
              );
              const lastCoinsPrices = store.getState().price.coins;
              const findLastCurrencyValue =
                lastCoinsPrices[currency.toLowerCase()];
              store.dispatch(
                setPrices({
                  asset: currency,
                  price:
                    findLastCurrencyValue !== undefined
                      ? findLastCurrencyValue
                      : 0,
                })
              );
            }
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
    isActive: boolean
  ) {
    // Update Redux state - no need for separate global settings storage
    store.dispatch(setAdvancedSettings({ advancedProperty, isActive }));
  }

  public async forgetWallet(pwd: string) {
    this.forgetMainWallet(pwd);

    // Emergency save any dirty vaults before clearing
    await vaultCache.emergencySave();

    // Clear vault cache
    vaultCache.clearCache();

    // Clear global settings via Redux
    store.dispatch(setHasEncryptedVault(false));
    store.dispatch(
      setAdvancedSettings({
        advancedProperty: 'refresh',
        isActive: false,
        isFirstTime: true,
      })
    );
    store.dispatch(setCoinsList([]));

    store.dispatch(forgetWallet());
    store.dispatch(setLastLogin());
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

      // Fetch fresh fiat prices immediately after successful unlock
      this.setFiat();

      // 🔥 FIX: Start periodic safety saves after successful unlock
      vaultCache.startPeriodicSave();

      // Clear startup flags after 2 seconds
      setTimeout(() => {
        this.justUnlocked = false;
        this.isStartingUp = false;
      }, 2000); // 2 seconds - enough time for all initialization

      return canLogin;
    } catch (error) {
      console.error('[MainController] Unlock error:', error);
      throw error;
    }
  }

  public async createWallet(password: string, phrase: string): Promise<void> {
    store.dispatch(setIsLoadingBalances(true));
    try {
      const keyring = this.getActiveKeyring();

      // This now uses the separated approach internally:
      // 1. initializeSession() - creates session data only
      // 2. createFirstAccount() - creates account without signer setup
      const account = await keyring.initializeWalletSecurely(phrase, password);

      // Add account to Redux state FIRST (before signer setup)
      store.dispatch(
        addAccountToStore({
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
      store.dispatch(setIsLoadingBalances(false));
      store.dispatch(setLastLogin());

      setTimeout(() => {
        this.setFiat();
        this.getLatestUpdateForCurrentAccount(false);
      }, 10);
    } catch (error) {
      store.dispatch(setIsLoadingBalances(false));
      console.error('[MainController] Failed to create wallet:', error);
      throw error;
    }
  }

  public lock() {
    const controller = getController();
    this.logout();

    // Emergency save any dirty vaults before clearing cache
    vaultCache.emergencySave().catch((error) => {
      console.error(
        '[MainController] Failed to emergency save on lock:',
        error
      );
    });

    // Clear vault cache on lock
    vaultCache.clearCache();

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

    store.dispatch(
      addAccountToStore({
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
    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false);
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
        this.getLatestUpdateForCurrentAccount(false);
      }, 10);

      // Skip dapp notifications and updates during startup
      if (this.isStartingUp) {
        console.log(
          '[MainController] Skipping dapp notifications and updates during startup'
        );
        return;
      }

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
    network: INetwork
  ): Promise<{ chainId: string; networkVersion: number }> {
    // Cancel the current promise if it exists
    if (this.currentPromise) {
      this.currentPromise.cancel();
      this.currentPromise = null;
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
      this.setActiveNetworkLogic(completeNetwork, false, resolve, reject);
    });

    this.currentPromise = promiseWrapper;

    promiseWrapper.promise
      .then(async () => {
        await this.handleNetworkChangeSuccess(completeNetwork);
      })
      .catch(this.handleNetworkChangeError);

    return promiseWrapper.promise;
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

  public async getRpc(data: ICustomRpcParams): Promise<INetwork> {
    try {
      const { formattedNetwork } = data.isSyscoinRpc
        ? (await getSysRpc(data)).rpc
        : await getEthRpc(data, false);
      return {
        ...formattedNetwork,
      } as INetwork;
    } catch (error) {
      if (!data.isSyscoinRpc) {
        throw cleanErrorStack(ethErrors.rpc.internal());
      }
      throw new Error(
        'Could not add your network, please try a different RPC endpoint'
      );
    }
  }

  public async handleWatchAsset(
    type: string,
    asset: IWatchAssetTokenProps
  ): Promise<boolean> {
    const {
      activeAccount: activeAccountInfo,
      accounts,
      isBitcoinBased,
    } = store.getState().vault;

    if (isBitcoinBased) {
      throw new Error('Watch asset is not supported on Bitcoin networks');
    }

    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];
    if (type !== 'ERC20') {
      throw new Error(`Asset of type ${type} not supported`);
    }

    const metadata = await getTokenStandardMetadata(
      asset.address,
      activeAccount.address,
      this.ethereumTransaction.web3Provider
    );

    const balance = `${metadata.balance / 10 ** metadata.decimals}`;
    const formattedBalance = floor(parseFloat(balance), 4);

    try {
      const assetToAdd = {
        tokenSymbol: asset.symbol,
        contractAddress: asset.address,
        decimals: Number(asset.decimals),
        isNft: false,
        balance: formattedBalance ?? 0,
        logo: asset?.image,
      } as ITokenEthProps;

      await this.account.eth.saveTokenInfo(assetToAdd);

      return true;
    } catch (error) {
      throw new Error(error);
    }
  }

  public async getAssetInfo(type: string, asset: IWatchAssetTokenProps) {
    const {
      activeAccount: activeAccountInfo,
      accounts,
      activeNetwork,
      isBitcoinBased,
    } = store.getState().vault;

    if (isBitcoinBased) {
      throw new Error('Asset info is not available on Bitcoin networks');
    }

    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];
    if (type !== 'ERC20') {
      throw new Error(`Asset of type ${type} not supported`);
    }

    const metadata = await getTokenStandardMetadata(
      asset.address,
      activeAccount.address,
      this.ethereumTransaction.web3Provider
    );

    const balance = `${metadata.balance / 10 ** metadata.decimals}`;
    const formattedBalance = floor(parseFloat(balance), 4);

    let web3Token: ITokenEthProps;

    const assetToAdd = {
      tokenSymbol: asset.symbol,
      contractAddress: asset.address,
      decimals: Number(asset.decimals),
      isNft: false,
      balance: formattedBalance ?? 0,
      logo: asset?.image,
    } as ITokenEthProps;

    const { coins } = await getSearch(assetToAdd.tokenSymbol);

    if (coins && coins[0]) {
      const { name, thumb } = coins[0];

      web3Token = {
        ...assetToAdd,
        tokenSymbol: assetToAdd.tokenSymbol,
        balance: assetToAdd.balance,
        name,
        id: assetToAdd.contractAddress,
        logo: assetToAdd?.logo ? assetToAdd.logo : thumb,
        isNft: assetToAdd.isNft,
        chainId: activeNetwork.chainId,
      };
    } else {
      web3Token = {
        ...assetToAdd,
        tokenSymbol: assetToAdd.tokenSymbol,
        balance: assetToAdd.balance,
        name: assetToAdd.tokenSymbol,
        id: assetToAdd.contractAddress,
        logo: assetToAdd?.logo ? assetToAdd.logo : PaliLogo,
        isNft: assetToAdd.isNft,
        chainId: activeNetwork.chainId,
      };
    }

    return web3Token;
  }

  public async addCustomRpc(data: ICustomRpcParams): Promise<INetwork> {
    const { networks } = store.getState().vault;
    const network = await this.getRpc(data);

    if (networks[data.isSyscoinRpc ? 'syscoin' : 'ethereum'][network.chainId]) {
      throw new Error('network already exists, remove or edit it');
    }

    const networkWithCustomParams = {
      ...network,
      default: false,
      apiUrl: data.apiUrl ? data.apiUrl : network.apiUrl,
      explorer: data?.explorer ? data.explorer : network?.explorer || '',
      currency: data.symbol ? data.symbol : network.currency,
      kind: data.isSyscoinRpc ? INetworkType.Syscoin : INetworkType.Ethereum,
    } as INetwork;

    store.dispatch(setNetwork({ network: networkWithCustomParams }));

    const networksAfterDispatch =
      store.getState().vault.networks[networkWithCustomParams.kind];

    const findCorrectNetworkValue = Object.values(networksAfterDispatch).find(
      (netValues) =>
        netValues.chainId === networkWithCustomParams.chainId &&
        netValues.url === networkWithCustomParams.url &&
        netValues.label === networkWithCustomParams.label
    );

    return findCorrectNetworkValue;
  }

  public async editCustomRpc(
    newRpc: ICustomRpcParams,
    oldRpc: INetwork
  ): Promise<INetwork> {
    const changedChainId = oldRpc.chainId !== newRpc.chainId;
    const network = await this.getRpc(newRpc);

    if (network.chainId === oldRpc.chainId) {
      const newNetwork = {
        ...network,
        label: newRpc.label || oldRpc.label || network.label, // Preserve existing label if newRpc.label is undefined
        currency:
          newRpc.symbol === oldRpc.currency ? oldRpc.currency : newRpc.symbol,
        apiUrl: newRpc.apiUrl === oldRpc.apiUrl ? oldRpc.apiUrl : newRpc.apiUrl,
        url: newRpc.url === oldRpc.url ? oldRpc.url : newRpc.url,
        chainId:
          newRpc.chainId === oldRpc.chainId ? oldRpc.chainId : newRpc.chainId,
        default: oldRpc.default,
        kind: oldRpc.kind,
        ...(oldRpc?.key && { key: oldRpc.key }),
      } as INetwork;

      if (changedChainId) {
        throw new Error('RPC from a different chainId');
      }

      store.dispatch(setNetwork({ network: newNetwork, isEdit: true }));
      this.updateNetworkConfig(newNetwork);

      return newNetwork;
    }
    throw new Error(
      'You are trying to set a different network RPC in current network. Please, verify it and try again'
    );
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
      setAccountsWithLabelEdited({
        label,
        accountId,
        accountType,
      })
    );
  }

  public removeKeyringNetwork(
    chain: INetworkType,
    chainId: number,
    rpcUrl: string,
    label: string,
    key?: string
  ) {
    store.dispatch(removeNetwork({ chain, chainId, rpcUrl, label, key }));
  }

  public getRecommendedFee() {
    const { isBitcoinBased, activeNetwork } = store.getState().vault;

    // Check if wallet is unlocked first
    const keyring = this.getActiveKeyringIfUnlocked();
    if (!keyring) {
      console.warn(
        '[MainController] Wallet is locked, cannot get recommended fee'
      );
      // Return a default/fallback fee structure
      return isBitcoinBased
        ? { fastestFee: 1, halfHourFee: 1, hourFee: 1 }
        : '20000000000'; // 20 gwei
    }

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
      addAccountToStore({
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
    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false);
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
      addAccountToStore({
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
    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false);
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
      addAccountToStore({
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
    setTimeout(() => {
      this.getLatestUpdateForCurrentAccount(false);
    }, 10);

    return importedAccount;
  }

  public async getUserNftsByNetwork(
    userAddress: string,
    chainId: number,
    rpcUrl: string
  ) {
    if (chainId !== 57 && chainId !== 570) return [];

    const fetchedNfts = await this.nftsController.getUserNfts(
      userAddress,
      chainId,
      rpcUrl
    );

    return fetchedNfts;
  }

  public async fetchAndUpdateNftsState({
    activeNetwork,
    activeAccount,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
  }) {
    const { accounts, accountAssets } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];
    const currentAssets = accountAssets[activeAccount.type][activeAccount.id];

    const { currentPromise: nftsPromises, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            store.dispatch(setIsLoadingNfts(true));

            const updatedNfts = await this.getUserNftsByNetwork(
              currentAccount.address,
              activeNetwork.chainId,
              activeNetwork.url
            );

            const validateUpdatedAndPreviousNftsLength =
              updatedNfts.length < currentAssets.nfts.length;

            const validateIfUpdatedNftsStayEmpty =
              currentAssets.nfts.length > 0 && isEmpty(updatedNfts);

            const validateIfNftsUpdatedIsEmpty = isEmpty(updatedNfts);

            const validateIfNotNullNftsValues = updatedNfts.some((value) =>
              isNil(value)
            );
            const validateIfIsSameLength =
              updatedNfts.length === currentAssets.nfts.length;

            const validateIfIsInvalidDispatch =
              validateUpdatedAndPreviousNftsLength ||
              validateIfUpdatedNftsStayEmpty ||
              validateIfNftsUpdatedIsEmpty ||
              validateIfNotNullNftsValues ||
              validateIfIsSameLength;

            if (validateIfIsInvalidDispatch) {
              store.dispatch(setIsLoadingNfts(false));
              resolve();
              return;
            }

            store.dispatch(
              setAccountAssets({
                accountId: activeAccount.id,
                accountType: activeAccount.type,
                property: 'nfts',
                value: updatedNfts,
              })
            );

            store.dispatch(setIsLoadingNfts(false));
            resolve();
          } catch (error) {
            if (error && store.getState().vault.isLoadingNfts) {
              store.dispatch(setIsLoadingNfts(false));
            }
            reject(error);
          }
        }
      );
    this.cancellablePromises.setPromise(PromiseTargets.NFTS, {
      nftsPromises,
      cancel,
    });

    this.cancellablePromises.runPromise(PromiseTargets.NFTS);
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
    store.dispatch(
      setTransactionStatusToAccelerated({
        oldTxHash,
        chainID,
      })
    );

    const transactionWithTimestamp = {
      ...newTxValue,
      timestamp: Date.now(),
    };

    store.dispatch(
      setSingleTransactionToState({
        chainId: chainID,
        networkType: TransactionsType.Ethereum,
        transaction: transactionWithTimestamp,
      })
    );
  }

  public updateUserTransactionsState({
    isPolling,
    isBitcoinBased,
    activeNetwork,
  }: {
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling: boolean;
  }) {
    // Check if wallet is unlocked first - skip if locked
    const keyring = this.getActiveKeyringIfUnlocked();
    if (!keyring) {
      console.log(
        '[MainController] Wallet is locked, skipping transaction updates'
      );
      // Return a resolved promise to maintain API consistency
      return Promise.resolve();
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
            // Set loading state for non-polling calls
            if (!isPolling) {
              store.dispatch(setIsLoadingTxs(true));
            }

            // Safe access to transaction objects with error handling
            let web3Provider = null;
            try {
              web3Provider = isBitcoinBased
                ? null
                : this.ethereumTransaction.web3Provider;
            } catch (error) {
              console.warn(
                '[MainController] Cannot access ethereumTransaction:',
                error
              );
              if (!isPolling) {
                store.dispatch(setIsLoadingTxs(false));
              }
              resolve();
              return;
            }

            const txs =
              await this.transactionsManager.utils.updateTransactionsFromCurrentAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                web3Provider,
                currentAccountTxs
              );

            // For UTXO, handle dispatch (EVM handles it internally)
            if (isBitcoinBased && txs && !isEmpty(txs)) {
              store.dispatch(
                setMultipleTransactionToState({
                  chainId: activeNetwork.chainId,
                  networkType: TransactionsType.Syscoin,
                  transactions: txs,
                })
              );
            }

            resolve();
          } catch (error) {
            console.error('Error fetching transactions:', error);
            reject(error);
          } finally {
            if (!isPolling) {
              store.dispatch(setIsLoadingTxs(false));
            }
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

  public sendAndSaveTransaction(tx: IEvmTransactionResponse | ISysTransaction) {
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
  }

  public async getState() {
    const state = store.getState();
    return state;
  }

  public updateAssetsFromCurrentAccount({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
    isPolling,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling?: boolean | null;
  }) {
    // Check if wallet is unlocked first - skip if locked
    const keyring = this.getActiveKeyringIfUnlocked();
    if (!keyring) {
      console.log('[MainController] Wallet is locked, skipping asset updates');
      // Return a resolved promise to maintain API consistency
      return Promise.resolve();
    }

    const { accounts, accountAssets } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];
    const currentAssets = accountAssets[activeAccount.type][activeAccount.id];

    const { currentPromise: assetsPromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            // Safe access to transaction objects with error handling
            let web3Provider = null;
            try {
              web3Provider = isBitcoinBased
                ? null
                : this.ethereumTransaction.web3Provider;
            } catch (error) {
              console.warn(
                '[MainController] Cannot access ethereumTransaction for asset update:',
                error
              );
              resolve();
              return;
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
              resolve();
              return;
            }

            if (!isPolling) {
              store.dispatch(setIsLoadingAssets(true));
            }

            store.dispatch(
              setAccountAssets({
                accountId: activeAccount.id,
                accountType: activeAccount.type,
                assets: updatedAssets,
              })
            );

            store.dispatch(setIsLoadingAssets(false));
            resolve();
          } catch (error) {
            // Ensure loading state is cleared on error
            store.dispatch(setIsLoadingAssets(false));
            reject(error);
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
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
  }) {
    // Check if wallet is unlocked first - skip if locked
    const keyring = this.getActiveKeyringIfUnlocked();
    if (!keyring) {
      console.log(
        '[MainController] Wallet is locked, skipping balance updates'
      );
      // Return a resolved promise to maintain API consistency
      return Promise.resolve();
    }

    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    // No need to create a new provider - let the BalancesManager use its own provider
    // The BalancesManager already handles EVM vs UTXO networks correctly

    const { currentPromise: balancePromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            // Safe access to transaction objects with error handling
            let web3Provider = null;
            try {
              web3Provider = isBitcoinBased
                ? null
                : this.ethereumTransaction.web3Provider;
            } catch (error) {
              console.warn(
                '[MainController] Cannot access ethereumTransaction for balance update:',
                error
              );
              resolve();
              return;
            }

            const updatedBalance =
              await this.balancesManager.utils.getBalanceUpdatedForAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                web3Provider
                // No need to pass a provider - let the manager use its own
              );

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

            resolve();
          } catch (error) {
            reject(error);
          } finally {
            store.dispatch(setIsLoadingBalances(false));
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
    isPolling = false
  ): Promise<boolean> {
    // Check if wallet is unlocked first
    const keyring = this.getActiveKeyringIfUnlocked();
    if (!keyring) {
      console.log(
        '[MainController] Wallet is locked, skipping account updates'
      );
      return false;
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
      return false;
    }
    const currentAccountTransactions =
      accountTransactions[activeAccount.type][activeAccount.id];

    // Skip if we just unlocked and this is not a polling call
    // This prevents duplicate calls on startup - let polling handle it
    if (this.justUnlocked && !isPolling) {
      console.log(
        '[MainController] Skipping non-polling update right after unlock - polling will handle it'
      );
      return false;
    }

    // Guard: Skip EVM operations if web3Provider isn't ready (during keyring switches)
    // Note: we now use try-catch for transaction access since we check unlock status above
    try {
      if (!isBitcoinBased && !this.ethereumTransaction?.web3Provider) {
        console.log(
          '[MainController] Skipping EVM update - web3Provider not ready (keyring may be switching)'
        );
        return false;
      }
    } catch (error) {
      console.log(
        '[MainController] Cannot access ethereumTransaction - wallet may be locked or keyring switching'
      );
      return false;
    }

    // Store initial state for change detection - latest tx hash + balances only
    const getLatestTxHash = (transactions: any) => {
      const networkType = isBitcoinBased ? 'syscoin' : 'ethereum';
      const chainTxs = transactions?.[networkType]?.[activeNetwork.chainId];

      if (!Array.isArray(chainTxs) || chainTxs.length === 0) {
        return null;
      }

      // Get the first transaction (should be latest due to desc sort)
      // Use hash for EVM, txid for UTXO
      const latestTx = chainTxs[0];
      return latestTx?.hash || latestTx?.txid || null;
    };

    const initialStateSnapshot = JSON.stringify({
      balances: activeAccountValues.balances,
      latestTxHash: getLatestTxHash(currentAccountTransactions),
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
        isPolling,
        isBitcoinBased,
        activeNetwork,
      }),
      this.updateUserNativeBalance({
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      }),
    ];

    const results = await Promise.allSettled(updatePromises);

    // Log any failures for debugging
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const updateNames = ['assets', 'transactions', 'balance'];
        console.error(
          `[MainController] Failed to update ${updateNames[index]}:`,
          result.reason
        );
      }
    });

    store.dispatch(switchNetworkSuccess());

    // Check if anything changed by comparing initial and final state
    const {
      accounts: finalAccounts,
      accountTransactions: finalAccountTransactions,
    } = store.getState().vault;
    const finalAccountTxs =
      finalAccountTransactions[activeAccount.type][activeAccount.id];
    const finalStateSnapshot = JSON.stringify({
      balances: finalAccounts[activeAccount.type][activeAccount.id].balances,
      latestTxHash: getLatestTxHash(finalAccountTxs),
    });

    const hasChanges = initialStateSnapshot !== finalStateSnapshot;

    // Reduce logging during account switching to avoid noise
    if (!isSwitchingAccount) {
      console.log(
        `[MainController] Update detection: ${
          hasChanges ? 'CHANGES FOUND' : 'No changes'
        }`
      );

      if (hasChanges) {
        console.log('[MainController] Initial state:', initialStateSnapshot);
        console.log('[MainController] Final state:', finalStateSnapshot);

        // Try to parse and show differences
        try {
          const initial = JSON.parse(initialStateSnapshot);
          const final = JSON.parse(finalStateSnapshot);
          console.log('[MainController] Initial parsed:', initial);
          console.log('[MainController] Final parsed:', final);
        } catch (parseError) {
          console.error('[MainController] JSON parse error:', parseError);
        }
      }
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
    store.dispatch(setIsLoadingBalances(false));
    // Ensure we don't leave the network in switching state
    setTimeout(() => {
      const currentStatus = store.getState().vaultGlobal.networkStatus;
      if (currentStatus === 'switching' || currentStatus === 'error') {
        console.log('switchNetwork: Forcing network status reset after error');
        store.dispatch(resetNetworkStatus());
      }
    }, 1000);
  };

  private async configureNetwork(network: INetwork): Promise<{
    error?: any;
    success: boolean;
  }> {
    let networkCallError: any = null;
    const MAX_RETRIES = 3;
    const INITIAL_RETRY_DELAY = 1000; // 1 second

    // Helper function to test network connectivity with retries
    const testNetworkConnectivity = async (
      url: string,
      retryCount = 0
    ): Promise<any> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        // Determine the appropriate endpoint and method based on network type
        const isUtxo = network.kind === INetworkType.Syscoin;

        let testUrl: string;
        let requestConfig: RequestInit;

        if (isUtxo) {
          // For UTXO networks, use blockbook status endpoint
          testUrl = `${url}/api/v2`;
          requestConfig = {
            method: 'GET',
            headers: {
              // Add Pali headers for this test request
              ...getPaliHeaders(),
            },
            // Prevent browser authentication dialogs
            credentials: 'omit',
            // Add timeout using AbortController for compatibility
            signal: controller.signal,
          };
        } else {
          // For EVM networks, use RPC method
          testUrl = url;
          requestConfig = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Add Pali headers for this test request
              ...getPaliHeaders(),
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_chainId',
              params: [],
              id: 1,
            }),
            // Prevent browser authentication dialogs
            credentials: 'omit',
            // Add timeout using AbortController for compatibility
            signal: controller.signal,
          };
        }

        const response = await fetch(testUrl, requestConfig);

        clearTimeout(timeoutId);

        if (!response.ok) {
          const responseText = await response.text();
          console.error(
            `Network test response (attempt ${retryCount + 1}):`,
            response.status,
            responseText
          );

          // Check for rate limiting
          if (response.status === 429 || response.status === 503) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter
              ? parseInt(retryAfter) * 1000
              : INITIAL_RETRY_DELAY * Math.pow(2, retryCount);

            if (retryCount < MAX_RETRIES) {
              console.log(`Rate limited, retrying after ${delay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
              return testNetworkConnectivity(url, retryCount + 1);
            }
          }

          // Try to parse the error message
          if (responseText) {
            throw new Error(responseText);
          } else {
            throw new Error(
              `Network returned ${response.status} ${response.statusText}`
            );
          }
        }

        return response;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new Error(
            'Network request timed out - the network may be slow or unresponsive'
          );
        }

        // For connection errors, retry with backoff
        if (
          retryCount < MAX_RETRIES &&
          (error.message?.includes('Failed to fetch') ||
            error.message?.includes('NetworkError'))
        ) {
          const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
          console.log(`Connection error, retrying after ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return testNetworkConnectivity(url, retryCount + 1);
        }

        throw error;
      }
    };

    try {
      const { success } = await this.setSignerNetwork(network);

      if (success) {
        // Cancel any pending async operations before switching managers
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

        return { success };
      } else {
        // setSignerNetwork failed but didn't throw an error
        // Try to get the actual error by making a test call

        // Test network connectivity for both EVM and UTXO networks
        try {
          await testNetworkConnectivity(network.url);
        } catch (testError) {
          console.error('Network test error:', testError);
          networkCallError = testError;
        }

        return {
          success: false,
          error: networkCallError || new Error('Failed to configure network'),
        };
      }
    } catch (error) {
      console.error('configureNetwork error:', error);
      // Return with success: false and include the error
      return {
        success: false,
        error,
      };
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
    cancelled: boolean,
    resolve: (value: {
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
    }) => void,
    reject: (reason?: any) => void
  ) => {
    if (
      store.getState().vaultGlobal.networkStatus === 'switching' &&
      !cancelled
    ) {
      return;
    }
    store.dispatch(startSwitchNetwork(network));
    store.dispatch(setIsLoadingBalances(true));

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
  private async handleNetworkChangeSuccess(network: INetwork) {
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

    setTimeout(() => {
      this.setFiat();
      this.getLatestUpdateForCurrentAccount(false);
    }, 10);

    // Skip dapp notifications during startup
    if (this.isStartingUp) {
      console.log(
        '[MainController] Skipping network change dapp notifications during startup'
      );
      store.dispatch(switchNetworkSuccess());
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
    store.dispatch(switchNetworkSuccess());
  }
  // Transaction utilities from sysweb3-utils (previously from ControllerUtils)
  private txUtils = txUtils();

  // Expose txUtils methods individually for better type safety
  public getRawTransaction = this.txUtils.getRawTransaction;

  // Add decodeRawTransaction method for PSBT/transaction details display
  public decodeRawTransaction = (psbt: any) => {
    // Check if wallet is unlocked first
    const keyring = this.getActiveKeyringIfUnlocked();
    if (!keyring) {
      throw new Error(
        'Wallet is locked. Please unlock to decode transactions.'
      );
    }

    try {
      return this.syscoinTransaction.decodeRawTransaction(psbt);
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
  public async addCustomTokenByType(
    walletAddress: string,
    contractAddress: string,
    symbol: string,
    decimals: number
  ) {
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
    return this.evmAssetsController.addCustomTokenByType(
      walletAddress,
      contractAddress,
      symbol,
      decimals,
      this.ethereumTransaction.web3Provider
    );
  }

  public async addEvmDefaultToken(token: any, accountAddress: string) {
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
    return this.evmAssetsController.addEvmDefaultToken(
      token,
      accountAddress,
      this.ethereumTransaction.web3Provider
    );
  }

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

  public async getNftMetadata(contractAddress: string) {
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
    return this.evmAssetsController.getNftMetadata(
      contractAddress,
      this.ethereumTransaction.web3Provider
    );
  }

  public async getTokenMetadata(
    contractAddress: string,
    accountAddress: string
  ) {
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
    return this.evmAssetsController.getTokenMetadata(
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
    if (!this.ethereumTransaction?.web3Provider) {
      throw new Error('No valid web3Provider available');
    }
    return this.evmTransactionsController.testExplorerApi(apiUrl);
  }

  // Direct Syscoin methods for consistency
  public async getSysAssetsByXpub(xpub: string, url: string, chainId: number) {
    return this.assetsManager.sys.getSysAssetsByXpub(xpub, url, chainId);
  }

  public async addSysDefaultToken(assetGuid: string, networkUrl: string) {
    return this.assetsManager.sys.addSysDefaultToken(assetGuid, networkUrl);
  }

  public async saveTokenInfo(token: any, tokenType?: string) {
    const { isBitcoinBased } = store.getState().vault;

    // Handle Ethereum tokens
    if (!isBitcoinBased || token.contractAddress) {
      return this.account.eth.saveTokenInfo(token, tokenType);
    }

    // Handle Syscoin tokens
    return this.account.sys.saveTokenInfo(token);
  }

  public async editTokenInfo(token: any) {
    const { isBitcoinBased } = store.getState().vault;

    // Handle Ethereum tokens
    if (!isBitcoinBased || token.contractAddress) {
      return this.account.eth.editTokenInfo(token);
    }

    // Syscoin tokens don't currently have edit functionality
    throw new Error('Edit token is not supported for Syscoin tokens');
  }

  public async deleteTokenInfo(tokenToDelete: any) {
    const { isBitcoinBased } = store.getState().vault;

    // Handle Ethereum tokens (tokenToDelete is contractAddress string)
    if (
      !isBitcoinBased ||
      (typeof tokenToDelete === 'string' && tokenToDelete.startsWith('0x'))
    ) {
      return this.account.eth.deleteTokenInfo(tokenToDelete);
    }

    // Handle Syscoin tokens (tokenToDelete is assetGuid string)
    return this.account.sys.deleteTokenInfo(tokenToDelete);
  }
}

export default MainController;
