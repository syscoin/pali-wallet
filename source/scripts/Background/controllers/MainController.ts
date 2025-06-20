import { ethErrors } from 'helpers/errors';
import floor from 'lodash/floor';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';

import {
  KeyringManager,
  IKeyringAccountState,
  KeyringAccountType,
  IWalletState,
  initialWalletState,
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
import {
  forgetWallet as forgetWalletState,
  setActiveAccount,
  setLastLogin,
  createAccount as addAccountToStore,
  setNetwork,
  setNetworkChange,
  removeNetwork as removeNetworkFromStore,
  setStoreError,
  setChangingConnectedAccount,
  setHasEthProperty as setEthProperty,
  setIsLoadingTxs,
  setIsLoadingAssets,
  setIsLastTxConfirmed as setIsLastTxConfirmedToState,
  setIsLoadingBalances,
  setIsLoadingNfts,
  setAccountPropertyByIdAndType,
  setAccountAssets,
  setAccountsWithLabelEdited,
  setAdvancedSettings as setSettings,
  setMultipleTransactionToState,
  setSingleTransactionToState,
  setTransactionStatusToCanceled,
  setTransactionStatusToAccelerated,
  setOpenDAppErrorModal,
  setFaucetModalState as setShouldShowFaucetModal,
  setCoinsList,
  startSwitchNetwork,
  switchNetworkError,
  resetNetworkStatus,
  switchNetworkSuccess,
  setIsSwitchingAccount,
} from 'state/vault';
import { IOmmitedAccount, TransactionsType } from 'state/vault/types';
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
import ChainListService from './chainlist';
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
const DEFAULT_EVM_SLIP44 = 60; // Ethereum
const DEFAULT_UTXO_SLIP44 = 57; // Syscoin

class MainController {
  // Map of keyrings indexed by slip44
  private keyrings: Map<number, KeyringManager> = new Map();
  // Current active slip44
  private activeSlip44: number = DEFAULT_UTXO_SLIP44;

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

  constructor(walletState: any) {
    // Patch fetch to add Pali headers to all RPC requests
    patchFetchWithPaliHeaders();

    // Initialize ChainList service in background
    ChainListService.getInstance()
      .initialize()
      .catch((error) => {
        console.error(
          '[MainController] Failed to initialize ChainList service:',
          error
        );
      });

    // Determine initial slip44 based on wallet state
    let initialSlip44 = DEFAULT_UTXO_SLIP44;

    try {
      const storeState = store.getState().vault as any;
      // Handle new slip44-based structure
      if (storeState.activeSlip44 !== undefined) {
        initialSlip44 = storeState.activeSlip44;
        console.log(
          `[MainController] Using activeSlip44 from Redux: ${initialSlip44}`
        );
      } else {
        // Fallback to checking activeNetwork or isBitcoinBased
        const activeNetwork =
          walletState?.activeNetwork || storeState?.activeNetwork;

        if (activeNetwork && activeNetwork.slip44) {
          initialSlip44 = activeNetwork.slip44;
        } else if (
          storeState &&
          typeof storeState.isBitcoinBased === 'boolean'
        ) {
          // Fallback to isBitcoinBased flag
          initialSlip44 = storeState.isBitcoinBased
            ? DEFAULT_UTXO_SLIP44
            : DEFAULT_EVM_SLIP44;
        }
      }

      console.log(
        `[MainController] Constructor detected initial slip44: ${initialSlip44}`
      );
    } catch (error) {
      console.warn(
        '[MainController] Could not determine initial slip44, defaulting to Ethereum'
      );
    }

    // Initialize the appropriate keyring based on slip44
    this.activeSlip44 = initialSlip44;
    this.initializeKeyring(this.activeSlip44, walletState);

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
  private initializeKeyring(slip44: number, walletState?: any): KeyringManager {
    if (!this.keyrings.has(slip44)) {
      console.log(
        `[MainController] Initializing keyring for slip44: ${slip44}`
      );
      const keyring = new KeyringManager({
        ...walletState,
        slip44,
      });
      // Set up storage access for each keyring
      keyring.setStorage(chrome.storage.local);
      this.keyrings.set(slip44, keyring);
    }
    return this.keyrings.get(slip44)!;
  }

  // Get the active keyring
  private getActiveKeyring(): KeyringManager {
    const keyring = this.keyrings.get(this.activeSlip44);
    if (!keyring) {
      throw new Error(`No keyring found for slip44: ${this.activeSlip44}`);
    }
    return keyring;
  }

  // Get slip44 from network object
  private getSlip44ForNetwork(network: INetwork): number {
    // Network objects should always have slip44 property
    return (
      network.slip44 ||
      (network.kind === INetworkType.Syscoin
        ? DEFAULT_UTXO_SLIP44
        : DEFAULT_EVM_SLIP44)
    );
  }

  // Switch active keyring based on network
  private async switchActiveKeyring(network: INetwork): Promise<void> {
    const slip44 = this.getSlip44ForNetwork(network);

    // Get the current active keyring before switching
    const previousKeyring = this.keyrings.get(this.activeSlip44);
    const wasUnlocked = previousKeyring?.isUnlocked() || false;

    // If switching to a different slip44 and current keyring is unlocked, we'll need to transfer session
    const needsSessionTransfer = slip44 !== this.activeSlip44 && wasUnlocked;

    // Update our internal active slip44
    if (slip44 !== this.activeSlip44) {
      console.log(
        `[MainController] Switching keyring from slip44 ${this.activeSlip44} to ${slip44}`
      );
    }

    // Ensure the target keyring exists
    let targetKeyring = this.keyrings.get(slip44);
    let createdNewKeyring = false;
    if (!targetKeyring) {
      console.log('[MainController] Creating new keyring on demand');
      targetKeyring = this.createKeyringOnDemand(network);
      createdNewKeyring = true;
    } else {
      console.log('[MainController] Using existing keyring for slip44', slip44);
    }

    if (!targetKeyring) {
      throw new Error(`Failed to get keyring for slip44: ${slip44}`);
    }

    // Handle session transfer if needed
    if (needsSessionTransfer && previousKeyring) {
      try {
        console.log(
          `[MainController] Transferring session from slip44 ${previousKeyring.wallet.activeNetwork.slip44} to ${slip44}`
        );
        previousKeyring.transferSessionTo(targetKeyring);
        if (createdNewKeyring) {
          const account =
            (await targetKeyring.createKeyringVaultFromSession()) as IKeyringAccountState;
          console.log('[MainController] new keyring account', account);
          store.dispatch(
            addAccountToStore({
              account: account,
              accountType: KeyringAccountType.HDAccount,
            })
          );
        }
        console.log(
          `[MainController] Session transferred and previous keyring locked`
        );
      } catch (error) {
        console.error(`[MainController] Error transferring session:`, error);
        throw new Error(
          `Failed to transfer session to new keyring: ${error.message}`
        );
      }
    } else if (!targetKeyring.isUnlocked()) {
      // If target keyring is not unlocked and we didn't transfer session, fail
      throw new Error(
        `Target keyring for slip44 ${slip44} is locked. Please unlock the wallet first.`
      );
    }

    // Set up the network on the keyring
    console.log(
      `[MainController] Setting up network on keyring for slip44 ${slip44}`
    );
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

    // Update our active slip44 - the active account is now whatever this keyring says it is
    this.activeSlip44 = slip44;
    this.keyrings.set(slip44, targetKeyring);
  }

  // Create a keyring on demand with storage access
  private createKeyringOnDemand(network: INetwork): KeyringManager {
    console.log(
      `[MainController] Creating keyring on demand for network: ${network}`
    );

    // Get wallet state template from an existing keyring or use defaults
    const existingKeyring =
      this.keyrings.size > 0 ? Array.from(this.keyrings.values())[0] : null;

    // Create wallet state for the new keyring - minimal state needed
    const walletStateForNewKeyring = existingKeyring
      ? {
          // Copy structure from existing keyring but reset account-specific data
          accounts: {
            [KeyringAccountType.HDAccount]: {},
            [KeyringAccountType.Imported]: {},
            [KeyringAccountType.Trezor]: {},
            [KeyringAccountType.Ledger]: {},
          },
          activeAccountId: 0,
          activeAccountType: KeyringAccountType.HDAccount,
          networks: existingKeyring.wallet.networks,
          activeNetwork: network as any,
        }
      : {
          ...initialWalletState,
          activeNetwork: network as any,
        };

    // Create new keyring with the wallet state
    const keyring = new KeyringManager({
      wallet: walletStateForNewKeyring,
      activeChain: network.kind,
    });

    // Set up storage access - this gives it access to the global encrypted vault
    keyring.setStorage(chrome.storage.local);

    console.log(
      `[MainController] Created keyring for network: ${network} with access to global vault`
    );
    return keyring;
    // Note: Session transfer is now handled in switchActiveKeyring method
  }

  // Lock all keyrings - used when user explicitly locks wallet
  private lockAllKeyrings(): void {
    console.log('[MainController] Locking all keyrings...');
    this.keyrings.forEach((keyring, slip44) => {
      if (keyring.isUnlocked()) {
        console.log(`[MainController] Locking keyring for network: ${slip44}`);
        keyring.lockWallet();
      }
    });
  }

  // Proxy methods to active keyring - made public for UX access (used by controllerEmitter)
  public get wallet() {
    return this.getActiveKeyring().wallet;
  }

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

  private updateAccountLabel(
    label: string,
    accountId: number,
    accountType: KeyringAccountType
  ) {
    return this.getActiveKeyring().updateAccountLabel(
      label,
      accountId,
      accountType
    );
  }

  private removeNetwork(
    chain: INetworkType,
    chainId: number,
    rpcUrl: string,
    label: string,
    key?: string
  ) {
    return this.getActiveKeyring().removeNetwork(
      chain,
      chainId,
      rpcUrl,
      label,
      key
    );
  }

  private addCustomNetwork(network: any) {
    return this.getActiveKeyring().addCustomNetwork(network);
  }

  private updateNetworkConfig(network: any) {
    return this.getActiveKeyring().updateNetworkConfig(network);
  }

  private async setSignerNetwork(network: INetwork) {
    // switchActiveKeyring handles everything: creating keyring if needed and setting up network
    await this.switchActiveKeyring(network);

    // Return the current wallet state from the keyring
    return {
      success: true,
      wallet: this.getActiveKeyring().wallet,
      activeChain: this.getActiveKeyring().activeChain,
    };
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
        const coinsListState = store.getState().vault.coinsList;
        if (coinsListState?.length > 0) {
          coinsList = coinsListState;
          console.log(
            'Using potentially stale coinsList from Redux store after fetch failure'
          );
        }
      }

      if (!coinsList) {
        coinsList = store.getState().vault.coinsList;
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
    store.dispatch(setEthProperty(exist));
  }

  public async setAdvancedSettings(
    advancedProperty: string,
    isActive: boolean
  ) {
    // Update Redux state
    store.dispatch(setSettings({ advancedProperty, isActive }));

    // Also update global settings
    const currentSettings = await this.getGlobalSettings();
    await this.updateGlobalSettings({
      advancedSettings: {
        ...currentSettings.advancedSettings,
        [advancedProperty]: isActive,
      },
    });
  }

  public async forgetWallet(pwd: string) {
    this.forgetMainWallet(pwd);

    // Clear global settings
    await this.setGlobalSettings({
      hasEncryptedVault: false,
      advancedSettings: {},
      coinsList: [],
    });

    store.dispatch(forgetWalletState());
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
      this.setFiat().catch((error) =>
        console.warn(
          '[MainController] Failed to fetch fiat prices after unlock:',
          error
        )
      );

      // Clear the flags after a short delay to allow initialization to complete
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
      const account = await this.getActiveKeyring().initializeWalletSecurely(
        phrase,
        password
      );
      // Update global settings to mark that we now have an encrypted vault
      await this.updateGlobalSettings({ hasEncryptedVault: true });

      store.dispatch(setIsLoadingBalances(false));
      store.dispatch(
        setActiveAccount({
          id: account.id,
          type: KeyringAccountType.HDAccount,
        })
      );
      store.dispatch(
        addAccountToStore({
          account: account,
          accountType: KeyringAccountType.HDAccount,
        })
      );
      store.dispatch(setLastLogin());
      this.getLatestUpdateForCurrentAccount(false);
      // Fetch fresh fiat prices immediately after wallet creation
      this.setFiat().catch((error) =>
        console.warn(
          '[MainController] Failed to fetch fiat prices after wallet creation:',
          error
        )
      );
    } catch (error) {
      store.dispatch(setIsLoadingBalances(false));
      console.error('[MainController] Failed to create wallet:', error);
      throw error;
    }
  }

  public lock() {
    const controller = getController();
    this.logout();

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

    this.getActiveKeyring().setActiveAccount(
      newAccount.id,
      KeyringAccountType.HDAccount
    );
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
    this.getLatestUpdateForCurrentAccount(false);
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

      // Use the parent's setActiveAccount method to properly handle all setup
      // But first, optimistically update Redux state for immediate UI feedback
      store.dispatch(setActiveAccount({ id, type }));

      // Run keyring update asynchronously without blocking
      this.getActiveKeyring()
        .setActiveAccount(id, type)
        .then(() => {
          // Defer heavy operations to prevent blocking the UI
          setTimeout(() => {
            this.performPostAccountSwitchOperations(
              isBitcoinBased,
              accounts,
              type,
              id
            );
          }, 0);
        })
        .catch((error) => {
          console.error('Keyring synchronization failed:', error);
          // Could revert Redux state here if needed
        });
    } catch (error) {
      console.error('Failed to set active account:', error);
      // Re-throw to let the UI handle the error
      throw error;
    } finally {
      // Always clear switching account loading state and unlock, even if there's an error
      store.dispatch(setIsSwitchingAccount(false));
      this.isAccountSwitching = false;
    }
  }

  private async performPostAccountSwitchOperations(
    isBitcoinBased: boolean,
    accounts: any,
    type: KeyringAccountType,
    id: number
  ) {
    try {
      // Fetch data for the newly active account
      this.getLatestUpdateForCurrentAccount(false);

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
      activeChain: INetworkType;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
      wallet: IWalletState;
    }>((resolve, reject) => {
      completeNetwork.kind;
      this.setActiveNetworkLogic(completeNetwork, false, resolve, reject);
    });

    this.currentPromise = promiseWrapper;

    promiseWrapper.promise
      .then(async ({ wallet, activeChain }) => {
        await this.handleNetworkChangeSuccess(
          wallet,
          activeChain,
          completeNetwork
        );
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

    this.addCustomNetwork(findCorrectNetworkValue);

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
      setIsLastTxConfirmedToState({ chainId, wasConfirmed, isFirstTime })
    );
  }

  public editAccountLabel(
    label: string,
    accountId: number,
    accountType: KeyringAccountType
  ) {
    this.updateAccountLabel(label, accountId, accountType);

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
    store.dispatch(
      removeNetworkFromStore({ chain, chainId, rpcUrl, label, key })
    );

    this.removeNetwork(chain, chainId, rpcUrl, label, key);
  }

  public getRecommendedFee() {
    const { isBitcoinBased, activeNetwork } = store.getState().vault;
    if (isBitcoinBased)
      return this.syscoinTransaction.getRecommendedFee(activeNetwork.url);
    return this.ethereumTransaction.getRecommendedGasPrice(true);
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

    await this.getActiveKeyring().setActiveAccount(
      importedAccount.id,
      KeyringAccountType.Imported
    );

    store.dispatch(
      setActiveAccount({
        id: importedAccount.id,
        type: KeyringAccountType.Imported,
      })
    );
    this.getLatestUpdateForCurrentAccount(false);

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
    this.getActiveKeyring().setActiveAccount(
      importedAccount.id,
      KeyringAccountType.Trezor
    );
    store.dispatch(
      setActiveAccount({
        id: importedAccount.id,
        type: KeyringAccountType.Trezor,
      })
    );
    this.getLatestUpdateForCurrentAccount(false);

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
    this.getActiveKeyring().setActiveAccount(
      importedAccount.id,
      KeyringAccountType.Ledger
    );
    store.dispatch(
      setActiveAccount({
        id: importedAccount.id,
        type: KeyringAccountType.Ledger,
      })
    );
    this.getLatestUpdateForCurrentAccount(false);

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

            const txs =
              await this.transactionsManager.utils.updateTransactionsFromCurrentAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                this.ethereumTransaction.web3Provider,
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

  public openDAppErrorModal() {
    store.dispatch(setOpenDAppErrorModal(true));
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
    const { accounts, accountAssets } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];
    const currentAssets = accountAssets[activeAccount.type][activeAccount.id];

    const { currentPromise: assetsPromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            const updatedAssets =
              await this.assetsManager.utils.updateAssetsFromCurrentAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                activeNetwork.chainId,
                this.ethereumTransaction.web3Provider,
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
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    // No need to create a new provider - let the BalancesManager use its own provider
    // The BalancesManager already handles EVM vs UTXO networks correctly

    const { currentPromise: balancePromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            const updatedBalance =
              await this.balancesManager.utils.getBalanceUpdatedForAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                this.ethereumTransaction.web3Provider
                // No need to pass a provider - let the manager use its own
              );

            const actualUserBalance = isBitcoinBased
              ? currentAccount.balances[INetworkType.Syscoin]
              : currentAccount.balances[INetworkType.Ethereum];
            const validateIfCanDispatch = Boolean(
              Number(actualUserBalance) !== parseFloat(updatedBalance)
            );

            if (validateIfCanDispatch) {
              store.dispatch(setIsLoadingBalances(true));
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

              store.dispatch(setIsLoadingBalances(false));
            }

            resolve();
          } catch (error) {
            reject(error);
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
    const {
      accounts,
      activeAccount,
      isBitcoinBased,
      activeNetwork,
      accountTransactions,
    } = store.getState().vault;

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
    if (!isBitcoinBased && !this.ethereumTransaction?.web3Provider) {
      console.log(
        '[MainController] Skipping EVM update - web3Provider not ready (keyring may be switching)'
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

    store.dispatch(switchNetworkSuccess(activeNetwork));

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
    store.dispatch(setShouldShowFaucetModal({ chainId, isOpen }));
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
      const currentStatus = store.getState().vault.networkStatus;
      if (currentStatus === 'switching' || currentStatus === 'error') {
        console.log('switchNetwork: Forcing network status reset after error');
        store.dispatch(resetNetworkStatus());
      }
    }, 1000);
  };

  private async configureNetwork(network: INetwork): Promise<{
    activeChain: INetworkType;
    error?: any;
    success: boolean;
    wallet: IWalletState;
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
      const { success, wallet, activeChain } = await this.setSignerNetwork(
        network
      );

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

        return { success, wallet, activeChain };
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
          wallet: wallet || this.wallet,
          activeChain: network.kind,
          error: networkCallError || new Error('Failed to configure network'),
        };
      }
    } catch (error) {
      console.error('configureNetwork error:', error);
      // Return with success: false and include the error
      return {
        success: false,
        wallet: this.wallet,
        activeChain: network.kind,
        error,
      };
    }
  }

  private resolveNetworkConfiguration(
    resolve: (value: {
      activeChain: INetworkType;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
      wallet: IWalletState;
    }) => void,
    {
      activeChain,
      chainId,
      isBitcoinBased,
      network,
      networkVersion,
      wallet,
    }: {
      activeChain: INetworkType;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
      wallet: IWalletState;
    }
  ) {
    resolve({
      activeChain,
      chainId,
      isBitcoinBased,
      network,
      networkVersion,
      wallet,
    });
  }
  private bindMethods() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (typeof this[key] === 'function' && key !== 'constructor') {
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
      activeChain: INetworkType;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
      wallet: IWalletState;
    }) => void,
    reject: (reason?: any) => void
  ) => {
    if (store.getState().vault.networkStatus === 'switching' && !cancelled) {
      return;
    }
    store.dispatch(startSwitchNetwork(network));
    store.dispatch(setIsLoadingBalances(true));

    const isBitcoinBased = network.kind === INetworkType.Syscoin;
    try {
      const { success, wallet, activeChain, error } =
        await this.configureNetwork(network);
      const chainId = network.chainId.toString(16);
      const networkVersion = network.chainId;

      if (success) {
        this.resolveNetworkConfiguration(resolve, {
          activeChain,
          chainId,
          isBitcoinBased,
          network,
          networkVersion,
          wallet,
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
    wallet: IWalletState,
    activeChain: INetworkType,
    network: INetwork
  ) {
    const isBitcoinBased = activeChain === INetworkType.Syscoin;
    console.log(
      '[MainController] Network switch success - replacing vault state from keyring:',
      {
        slip44: this.activeSlip44,
        networkChainId: network.chainId,
        activeAccount: {
          id: wallet.activeAccountId,
          type: wallet.activeAccountType,
        },
      }
    );

    // Complete state replacement from keyring - this syncs everything automatically:
    // - activeAccount (id + type)
    // - activeNetwork
    // - all accounts
    // - network configuration
    // - isBitcoinBased (derived from activeChain)
    store.dispatch(setNetworkChange({ activeChain, wallet }));
    store.dispatch(setIsLoadingBalances(false));

    await this.setFiat();

    // Get latest updates for the newly active account
    const activeAccountData =
      wallet.accounts[wallet.activeAccountType][wallet.activeAccountId];
    this.getLatestUpdateForCurrentAccount(false);

    // Skip dapp notifications during startup
    if (this.isStartingUp) {
      console.log(
        '[MainController] Skipping network change dapp notifications during startup'
      );
      store.dispatch(switchNetworkSuccess(network));
      return;
    }

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
    store.dispatch(switchNetworkSuccess(network));
  }
  // Transaction utilities from sysweb3-utils (previously from ControllerUtils)
  private txUtils = txUtils();

  // Expose txUtils methods individually for better type safety
  public getRawTransaction = this.txUtils.getRawTransaction;

  // Add decodeRawTransaction method for PSBT/transaction details display
  public decodeRawTransaction = (psbt: any) => {
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

  // Global settings management
  private async getGlobalSettings() {
    const settings = await chrome.storage.local.get('global-settings');
    return (
      settings['global-settings'] || {
        hasEncryptedVault: false,
        advancedSettings: {},
        coinsList: [],
      }
    );
  }

  private async setGlobalSettings(settings: any) {
    await chrome.storage.local.set({ 'global-settings': settings });
  }

  private async updateGlobalSettings(updates: Partial<any>) {
    const current = await this.getGlobalSettings();
    const updated = { ...current, ...updates };
    await this.setGlobalSettings(updated);
  }
}

export default MainController;
