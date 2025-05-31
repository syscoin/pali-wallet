import { ethErrors } from 'helpers/errors';
import floor from 'lodash/floor';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';

import {
  KeyringManager,
  IKeyringAccountState,
  KeyringAccountType,
  IWalletState,
  CustomJsonRpcProvider,
  CustomL2JsonRpcProvider,
} from '@pollum-io/sysweb3-keyring';
import {
  getSysRpc,
  getEthRpc,
  INetworkType,
  validateEthRpc,
} from '@pollum-io/sysweb3-network';
import {
  getSearch,
  getTokenStandardMetadata,
  txUtils,
} from '@pollum-io/sysweb3-utils';

import { getController } from '..';
import PaliLogo from 'assets/icons/favicon-32.png';
import { ASSET_PRICE_API } from 'constants/index';
import { setPrices, setCoins } from 'state/price';
import store from 'state/store';
import {
  forgetWallet as forgetWalletState,
  setActiveAccount,
  setLastLogin,
  createAccount as addAccountToStore,
  setNetwork,
  removeNetwork as removeNetworkFromStore,
  setStoreError,
  setIsBitcoinBased,
  setChangingConnectedAccount,
  setAccounts,
  setNetworkChange,
  setHasEthProperty as setEthProperty,
  setIsLoadingTxs,
  initialState,
  setIsLoadingAssets,
  setIsLastTxConfirmed as setIsLastTxConfirmedToState,
  setIsLoadingBalances,
  setIsLoadingNfts,
  setAccountPropertyByIdAndType,
  setAccountsWithLabelEdited,
  setAdvancedSettings as setSettings,
  setCurrentBlock,
  setMultipleTransactionToState,
  setSingleTransactionToState,
  setTransactionStatusToCanceled,
  setTransactionStatusToAccelerated,
  setUpdatedNftsToState,
  setOpenDAppErrorModal,
  setFaucetModalState as setShouldShowFaucetModal,
  setCoinsList,
  startSwitchNetwork,
  switchNetworkError,
  resetNetworkStatus,
  switchNetworkSuccess,
  setIsSwitchingAccount,
} from 'state/vault';
import {
  IOmmitedAccount,
  IPaliAccount,
  TransactionsType,
  INetworkWithKind,
} from 'state/vault/types';
import { ITokenEthProps, IWatchAssetTokenProps } from 'types/tokens';
import { ICustomRpcParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';
import { logError } from 'utils/index';
import { getNetworkChain } from 'utils/network';

import EthAccountController, { IEthAccountController } from './account/evm';
import SysAccountController, { ISysAccountController } from './account/syscoin';
import AssetsManager from './assets';
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
import TransactionsManager from './transactions';
import {
  IEvmTransactionResponse,
  ISysTransaction,
  ITransactionsManager,
} from './transactions/types';
import { validateAndManageUserTransactions } from './transactions/utils';
import { clearFetchBackendAccountCache } from './utils/fetchBackendAccountWrapper';

// Constants for fiat price functionality
const COINS_LIST_CACHE_KEY = 'pali_coinsListCache';
const COINS_LIST_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Add request deduplication cache
interface RequestCache {
  [key: string]: {
    promise: Promise<any>;
    timestamp: number;
  };
}

const requestCache: RequestCache = {};
const CACHE_TTL = 5000; // 5 seconds TTL for cache entries

// Helper function to create cache key
const createCacheKey = (method: string, ...args: any[]): string =>
  `${method}:${args.join(':')}`;

// Helper function to get or create cached request
const getCachedRequest = async <T>(
  key: string,
  requestFn: () => Promise<T>
): Promise<T> => {
  const now = Date.now();

  // Clean up expired cache entries
  Object.keys(requestCache).forEach((cacheKey) => {
    if (now - requestCache[cacheKey].timestamp > CACHE_TTL) {
      delete requestCache[cacheKey];
    }
  });

  // Check if we have a valid cached request
  if (requestCache[key] && now - requestCache[key].timestamp < CACHE_TTL) {
    console.log(`[MainController] Using cached request for ${key}`);
    return requestCache[key].promise as Promise<T>;
  }

  // Create new request and cache it
  console.log(`[MainController] Creating new request for ${key}`);
  const promise = requestFn();
  requestCache[key] = { promise, timestamp: now };

  // Clean up cache entry after request completes
  promise.finally(() => {
    setTimeout(() => {
      delete requestCache[key];
    }, 100); // Small delay to handle rapid successive calls
  });

  return promise;
};

class MainController extends KeyringManager {
  public account: {
    eth: IEthAccountController;
    sys: ISysAccountController;
  };
  public assets: IAssetsManager;
  public transactions: ITransactionsManager;
  private assetsManager: IAssetsManager;
  private nftsController: INftController;
  private web3Provider: CustomJsonRpcProvider;
  private transactionsManager: ITransactionsManager;
  private balancesManager: IBalancesManager;
  private cancellablePromises: CancellablePromises;
  private currentPromise: {
    cancel: () => void;
    promise: Promise<{ chainId: string; networkVersion: number }>;
  } | null = null;
  private lastUpdatePromise: Promise<void> | null = null;
  private lastUpdateTimestamp = 0;
  private currentUpdateAccountId: string | null = null;

  constructor(walletState: any) {
    super(walletState);

    // Patch fetch to add Pali headers to all RPC requests
    patchFetchWithPaliHeaders();

    this.assetsManager = AssetsManager(this.ethereumTransaction.web3Provider);
    this.nftsController = NftsController();

    this.web3Provider = this.ethereumTransaction.web3Provider;

    this.transactionsManager = TransactionsManager(this.web3Provider);
    this.balancesManager = BalancesManager(this.web3Provider);
    this.cancellablePromises = new CancellablePromises();
    this.account = {
      eth: EthAccountController(),
      sys: SysAccountController(() => this),
    };
    this.assets = this.assetsManager;
    this.transactions = this.transactionsManager;

    this.bindMethods();
  }

  // Fiat price fetching functionality moved from ControllerUtils
  public async setFiat(currency?: string): Promise<void> {
    if (!currency) {
      const storeCurrency = store.getState().price.fiat.asset;
      currency = storeCurrency || 'usd';
    }

    const { isInCooldown }: CustomJsonRpcProvider = this.web3Provider;
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
            [COINS_LIST_CACHE_KEY]: { list: coinsList, timestamp: Date.now() },
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
          if (!activeNetwork.isTestnet) {
            const currencies = await (
              await fetch(`${activeNetworkURL}${ASSET_PRICE_API}`)
            ).json();
            if (currencies && currencies.rates) {
              store.dispatch(setCoins(currencies.rates));
              if (currencies.rates[currency.toLowerCase()]) {
                store.dispatch(
                  setPrices({
                    asset: currency,
                    price: currencies.rates[currency.toLowerCase()],
                  })
                );
                return;
              }
            }
          }

          store.dispatch(setPrices({ asset: currency, price: 0 }));
        } catch (error) {
          logError('Failed to retrieve asset price - SYSCOIN UTXO', '', error);
          store.dispatch(setPrices({ asset: currency, price: 0 }));
        }
        break;

      case INetworkType.Ethereum:
        try {
          const { chain, chainId } = await validateEthRpc(
            activeNetwork.url,
            isInCooldown
          );

          const ethTestnetsChainsIds = [5700, 11155111, 421611, 5, 69];

          if (
            Boolean(
              chain === 'testnet' ||
                ethTestnetsChainsIds.some(
                  (validationChain) => validationChain === chainId
                )
            )
          ) {
            store.dispatch(setPrices({ asset: currency, price: 0 }));
            return;
          }

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
  }

  public setHasEthProperty(exist: boolean) {
    store.dispatch(setEthProperty(exist));
  }

  public setAdvancedSettings(advancedProperty: string, isActive: boolean) {
    store.dispatch(setSettings({ advancedProperty, isActive }));
  }

  public forgetWallet(pwd: string) {
    this.forgetMainWallet(pwd);

    store.dispatch(forgetWalletState());
    store.dispatch(setLastLogin());
  }

  public async unlockFromController(pwd: string): Promise<boolean> {
    // Ensure clean network state during login
    store.dispatch(resetNetworkStatus());
    const controller = getController();
    const { canLogin, wallet } = await this.unlock(pwd);
    if (!canLogin) throw new Error('Invalid password');
    if (!isEmpty(wallet)) {
      store.dispatch(
        setNetworkChange({
          activeChain: INetworkType.Syscoin,
          wallet,
        })
      );
    }

    controller.dapp
      .handleStateChange(PaliEvents.lockStateChanged, {
        method: PaliEvents.lockStateChanged,
        params: {
          accounts: [],
          isUnlocked: this.isUnlocked(),
        },
      })
      .catch((error) => console.error('Unlock', error));

    const accounts = JSON.parse(
      JSON.stringify(store.getState().vault.accounts)
    );

    // update xprv every time the wallet is unlocked
    for (const type in accounts) {
      for (const id in accounts[type]) {
        accounts[type][id] = {
          ...accounts[type][id],
          xprv: this.wallet.accounts[type][id].xprv,
        };
      }
    }

    store.dispatch(setAccounts(accounts));
    store.dispatch(setLastLogin());

    return canLogin;
  }

  public async createWallet(password: string, phrase: string): Promise<void> {
    store.dispatch(setIsLoadingBalances(true));
    const {
      accounts,
      activeAccount: activeAccountInfo,
      activeNetwork,
    } = store.getState().vault;
    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];

    // --- BEGIN VALIDATION ---
    if (!phrase || !this.isSeedValid(phrase)) {
      store.dispatch(setIsLoadingBalances(false)); // Stop loading indicator
      throw new Error('Invalid or empty seed phrase provided.');
    }
    // --- END VALIDATION ---

    const handleWalletInfo = () => {
      this.setSeed(phrase);
      this.setWalletPassword(password);
    };

    handleWalletInfo();

    if (activeAccount.address !== '') {
      this.forgetWallet(password);
      handleWalletInfo();
    }

    const account = (await this.createKeyringVault()) as IKeyringAccountState;

    const initialSysAssetsForAccount = await this.getInitialSysTokenForAccount(
      account.xpub
    );
    const initialTxsForAccount = await this.getInitialSysTransactionsForAccount(
      account.xpub
    );

    const newAccountWithAssets: IPaliAccount = {
      ...account,
      assets: {
        syscoin: initialSysAssetsForAccount,
        ethereum: [],
        nfts: [],
      },
      transactions: {
        ethereum: {},
        syscoin: {
          [activeNetwork.chainId]: initialTxsForAccount,
        },
      },
    };

    store.dispatch(setIsLoadingBalances(false));
    store.dispatch(
      setActiveAccount({
        id: newAccountWithAssets.id,
        type: KeyringAccountType.HDAccount,
      })
    );
    store.dispatch(
      addAccountToStore({
        account: newAccountWithAssets,
        accountType: KeyringAccountType.HDAccount,
      })
    );
    store.dispatch(setLastLogin());
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

  public async createAccount(
    isBitcoinBased: boolean,
    activeNetworkChainId: number,
    label?: string
  ): Promise<IPaliAccount> {
    const newAccount = await this.addNewAccount(label);
    let newAccountWithAssets: IPaliAccount;

    if (isBitcoinBased) {
      const initialSysAssetsForAccount =
        await this.getInitialSysTokenForAccount(newAccount.xpub);

      const initialTxsForAccount =
        await this.getInitialSysTransactionsForAccount(newAccount.xpub);

      newAccountWithAssets = {
        ...newAccount,
        assets: {
          syscoin: initialSysAssetsForAccount,
          ethereum: [],
          nfts: [],
        },
        transactions: {
          syscoin: {
            [activeNetworkChainId]: initialTxsForAccount,
          },
          ethereum: {},
        },
      };
    } else {
      newAccountWithAssets = {
        ...newAccount,
        assets: {
          syscoin: [],
          ethereum: [],
          nfts: [],
        },
        transactions: {
          syscoin: {},
          ethereum: {},
        },
      };
    }
    store.dispatch(
      addAccountToStore({
        account: newAccountWithAssets,
        accountType: KeyringAccountType.HDAccount,
      })
    );
    store.dispatch(
      setActiveAccount({
        id: newAccountWithAssets.id,
        type: KeyringAccountType.HDAccount,
      })
    );
    return newAccountWithAssets;
  }

  public async setAccount(
    id: number,
    type: KeyringAccountType,
    host?: string,
    connectedAccount?: IOmmitedAccount
  ): Promise<void> {
    const { accounts, activeAccount, isBitcoinBased, activeNetwork } =
      store.getState().vault;
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

    // Custom implementation to avoid fetching all accounts
    const setActiveAccountOptimized = async () => {
      if (isBitcoinBased && (this as any).hd) {
        // For Bitcoin-based networks with HD wallet
        const targetAccounts = this.wallet.accounts[type];

        // Validate account exists
        if (!targetAccounts[id] || !targetAccounts[id].xpub) {
          throw new Error('Account not set');
        }

        // Set the HD wallet account index
        if (targetAccounts[id].address) {
          (this as any).hd.setAccountIndex(id);
        }

        // Update wallet state
        this.wallet = {
          ...this.wallet,
          activeAccountId: id,
          activeAccountType: type,
        };

        // Update session mnemonic for the active account
        const isHDAccount = type === KeyringAccountType.HDAccount;
        (this as any).sessionMnemonic = isHDAccount
          ? (this as any).sessionMainMnemonic
          : targetAccounts[id].xprv;
      } else {
        // For non-Bitcoin networks, just update the wallet state
        this.wallet = {
          ...this.wallet,
          activeAccountId: id,
          activeAccountType: type,
        };
      }
    };

    setActiveAccountOptimized()
      .then(() => {
        store.dispatch(setActiveAccount({ id, type }));

        // Clear caches when switching accounts
        this.transactionsManager.utils.clearCache();
        clearProviderCache();
        clearFetchBackendAccountCache();

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
        // Fetch data for the newly active account only
        this.getLatestUpdateForCurrentAccount(false);
      })
      .finally(() => {
        // Always clear switching account loading state, even if there's an error
        store.dispatch(setIsSwitchingAccount(false));
      });
  }

  public async setActiveNetwork(
    network: INetworkWithKind
  ): Promise<{ chainId: string; networkVersion: number }> {
    let cancelled = false;
    if (this.currentPromise) {
      this.currentPromise.cancel();
      cancelled = true;
    }

    const promiseWrapper = this.createCancellablePromise<{
      activeChain: INetworkType;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetworkWithKind;
      networkVersion: number;
      wallet: IWalletState;
    }>((resolve, reject) => {
      const chain =
        network.kind === 'utxo' ? INetworkType.Syscoin : INetworkType.Ethereum;
      this.setActiveNetworkLogic(network, chain, cancelled, resolve, reject);
    });
    this.currentPromise = promiseWrapper;
    promiseWrapper.promise
      .then(async ({ wallet, activeChain, isBitcoinBased }) => {
        await this.handleNetworkChangeSuccess(
          wallet,
          activeChain,
          isBitcoinBased,
          network
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

  public async getRpc(data: ICustomRpcParams): Promise<INetworkWithKind> {
    try {
      const { formattedNetwork } = data.isSyscoinRpc
        ? (await getSysRpc(data)).rpc
        : await getEthRpc(data, false);
      return formattedNetwork;
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
    const { activeAccount: activeAccountInfo, accounts } =
      store.getState().vault;
    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];
    if (type !== 'ERC20') {
      throw new Error(`Asset of type ${type} not supported`);
    }

    const metadata = await getTokenStandardMetadata(
      asset.address,
      activeAccount.address,
      this.web3Provider
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
    } = store.getState().vault;
    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];
    if (type !== 'ERC20') {
      throw new Error(`Asset of type ${type} not supported`);
    }

    const metadata = await getTokenStandardMetadata(
      asset.address,
      activeAccount.address,
      this.web3Provider
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

  public async addCustomRpc(data: ICustomRpcParams): Promise<INetworkWithKind> {
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
      kind: data.isSyscoinRpc ? 'utxo' : 'evm',
    } as INetworkWithKind;

    const chain = data.isSyscoinRpc
      ? INetworkType.Syscoin
      : INetworkType.Ethereum;

    store.dispatch(setNetwork({ chain, network: networkWithCustomParams }));

    const networksAfterDispatch = store.getState().vault.networks[chain];

    const findCorrectNetworkValue = Object.values(networksAfterDispatch).find(
      (netValues) =>
        netValues.chainId === networkWithCustomParams.chainId &&
        netValues.url === networkWithCustomParams.url &&
        netValues.label === networkWithCustomParams.label
    );

    this.addCustomNetwork(chain, findCorrectNetworkValue);

    return findCorrectNetworkValue;
  }

  public async editCustomRpc(
    newRpc: ICustomRpcParams,
    oldRpc: INetworkWithKind
  ): Promise<INetworkWithKind> {
    const changedChainId = oldRpc.chainId !== newRpc.chainId;
    const network = await this.getRpc(newRpc);
    const chain = getNetworkChain(newRpc.isSyscoinRpc);

    if (network.chainId === oldRpc.chainId) {
      const newNetwork = {
        ...network,
        label: newRpc.label,
        currency:
          newRpc.symbol === oldRpc.currency ? oldRpc.currency : newRpc.symbol,
        apiUrl: newRpc.apiUrl === oldRpc.apiUrl ? oldRpc.apiUrl : newRpc.apiUrl,
        url: newRpc.url === oldRpc.url ? oldRpc.url : newRpc.url,
        chainId:
          newRpc.chainId === oldRpc.chainId ? oldRpc.chainId : newRpc.chainId,
        default: oldRpc.default,
        kind: oldRpc.kind,
        ...(oldRpc?.key && { key: oldRpc.key }),
      } as INetworkWithKind;

      if (changedChainId) {
        throw new Error('RPC from a different chainId');
      }

      store.dispatch(setNetwork({ chain, network: newNetwork, isEdit: true }));
      this.updateNetworkConfig(newNetwork, chain as INetworkType);
      this.transactionsManager = TransactionsManager(
        this.ethereumTransaction.web3Provider
      );
      this.balancesManager = BalancesManager(
        this.ethereumTransaction.web3Provider
      );

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
    const { accounts, isBitcoinBased, activeAccount, activeNetwork } =
      store.getState().vault;
    const importedAccount = await this.importAccount(privKey, label);

    const paliImp: IPaliAccount = {
      ...importedAccount,
      assets: {
        ethereum: [],
        syscoin: [],
      },
      transactions: {
        syscoin: {},
        ethereum: {},
      },
    } as IPaliAccount;

    store.dispatch(
      setAccounts({
        ...accounts,
        [KeyringAccountType.Imported]: {
          ...accounts[KeyringAccountType.Imported],
          [paliImp.id]: paliImp,
        },
      })
    );

    await this.setActiveAccount(paliImp.id, KeyringAccountType.Imported);

    store.dispatch(
      setActiveAccount({ id: paliImp.id, type: KeyringAccountType.Imported })
    );

    this.updateUserTransactionsState({
      isPolling: false,
      isBitcoinBased,
      activeNetwork,
    });
    this.updateAssetsFromCurrentAccount({
      activeAccount,
      activeNetwork,
      isBitcoinBased,
    });

    return importedAccount;
  }

  public async importTrezorAccountFromController(
    coin: string,
    slip44: string,
    index: string
  ) {
    const { accounts, isBitcoinBased, activeAccount, activeNetwork } =
      store.getState().vault;
    let importedAccount;
    try {
      importedAccount = await this.importTrezorAccount(coin, slip44, index);
    } catch (error) {
      console.error(error);
      throw new Error(
        'Could not import your account, please try again: ' + error.message
      );
    }
    const paliImp: IPaliAccount = {
      ...importedAccount,
      assets: {
        ethereum: [],
        syscoin: [],
      },
      transactions: {
        syscoin: {},
        ethereum: {},
      },
    } as IPaliAccount;

    store.dispatch(
      setAccounts({
        ...accounts,
        [KeyringAccountType.Trezor]: {
          ...accounts[KeyringAccountType.Trezor],
          [paliImp.id]: paliImp,
        },
      })
    );
    await this.setActiveAccount(paliImp.id, KeyringAccountType.Trezor);
    store.dispatch(
      setActiveAccount({ id: paliImp.id, type: KeyringAccountType.Trezor })
    );
    this.updateUserTransactionsState({
      isPolling: false,
      isBitcoinBased,
      activeNetwork,
    });
    this.updateAssetsFromCurrentAccount({
      activeAccount,
      activeNetwork,
      isBitcoinBased,
    });

    return importedAccount;
  }

  public async importLedgerAccountFromController(
    coin: string,
    slip44: string,
    index: string,
    isAlreadyConnected: boolean
  ) {
    const { accounts, isBitcoinBased, activeNetwork } = store.getState().vault;
    let importedAccount;
    try {
      importedAccount = await this.importLedgerAccount(
        coin,
        slip44,
        index,
        isAlreadyConnected
      );
    } catch (error) {
      console.error(error);
      throw new Error(
        'Could not import your account, please try again: ' + error.message
      );
    }
    const paliImp: IPaliAccount = {
      ...importedAccount,
      assets: {
        ethereum: [],
        syscoin: [],
      },
      transactions: {
        syscoin: {},
        ethereum: {},
      },
    } as IPaliAccount;
    store.dispatch(
      setAccounts({
        ...accounts,
        [KeyringAccountType.Ledger]: {
          ...accounts[KeyringAccountType.Ledger],
          [paliImp.id]: paliImp,
        },
      })
    );
    await this.setActiveAccount(paliImp.id, KeyringAccountType.Ledger);
    store.dispatch(
      setActiveAccount({ id: paliImp.id, type: KeyringAccountType.Ledger })
    );
    this.updateUserTransactionsState({
      isPolling: false,
      isBitcoinBased,
      activeNetwork,
    });
    this.updateAssetsFromCurrentAccount({
      activeAccount: { id: paliImp.id, type: KeyringAccountType.Ledger },
      activeNetwork,
      isBitcoinBased,
    });

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
    activeNetwork: INetworkWithKind;
  }) {
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

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
              updatedNfts.length < currentAccount.assets.nfts.length;

            const validateIfUpdatedNftsStayEmpty =
              currentAccount.assets.nfts.length > 0 && isEmpty(updatedNfts);

            const validateIfNftsUpdatedIsEmpty = isEmpty(updatedNfts);

            const validateIfNotNullNftsValues = updatedNfts.some((value) =>
              isNil(value)
            );
            const validateIfIsSameLength =
              updatedNfts.length === currentAccount.assets.nfts.length;

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
              setUpdatedNftsToState({
                id: activeAccount.id,
                type: activeAccount.type,
                updatedNfts,
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

  public async getInitialSysTransactionsForAccount(xpub: string) {
    const cacheKey = createCacheKey(
      'sysTransactions',
      xpub,
      initialState.activeNetwork.url
    );

    return getCachedRequest(cacheKey, async () => {
      store.dispatch(setIsLoadingTxs(true));

      const initialTxsForAccount =
        await this.transactionsManager.sys.getInitialUserTransactionsByXpub(
          xpub,
          initialState.activeNetwork.url
        );

      store.dispatch(setIsLoadingTxs(false));

      return initialTxsForAccount;
    });
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

  public callUpdateTxsMethodBasedByIsBitcoinBased(
    isBitcoinBased: boolean,
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    },
    activeNetwork: INetworkWithKind
  ) {
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    if (isBitcoinBased) {
      // UTXO: Use centralized caching and handle Redux dispatch
      this.transactions.sys
        .getInitialUserTransactionsByXpub(
          currentAccount.xpub,
          activeNetwork.url
        )
        .then((txs) => {
          if (isNil(txs) || isEmpty(txs)) {
            return;
          }
          store.dispatch(
            setMultipleTransactionToState({
              chainId: activeNetwork.chainId,
              networkType: TransactionsType.Syscoin,
              transactions: txs,
            })
          );
        })
        .catch((error) => {
          console.error('Error fetching Syscoin transactions:', error);
        });
    } else {
      // EVM: Use centralized caching (handles its own Redux dispatch via validateAndManageUserTransactions)
      this.transactionsManager.utils.updateTransactionsFromCurrentAccount(
        currentAccount,
        isBitcoinBased,
        activeNetwork.url
      );
    }
  }

  public updateUserTransactionsState({
    isPolling,
    isBitcoinBased,
    activeNetwork,
  }: {
    activeNetwork: INetworkWithKind;
    isBitcoinBased: boolean;
    isPolling: boolean;
  }) {
    const { accounts, activeAccount } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const { currentPromise: transactionPromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            if (isPolling) {
              await this.transactionsManager.utils
                .updateTransactionsFromCurrentAccount(
                  currentAccount,
                  isBitcoinBased,
                  activeNetwork.url
                )
                .then((txs) => {
                  const canDispatch =
                    isBitcoinBased && !(isNil(txs) && isEmpty(txs));

                  if (canDispatch) {
                    store.dispatch(
                      setMultipleTransactionToState({
                        chainId: activeNetwork.chainId,
                        networkType: TransactionsType.Syscoin,
                        transactions: txs,
                      })
                    );
                  }
                });
            } else {
              this.callUpdateTxsMethodBasedByIsBitcoinBased(
                isBitcoinBased,
                activeAccount,
                activeNetwork
              );
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      );

    this.cancellablePromises.setPromise(PromiseTargets.TRANSACTION, {
      transactionPromise,
      cancel,
    });

    this.cancellablePromises.runPromise(PromiseTargets.TRANSACTION);
  }

  public async validatePendingEvmTransactions({
    pendingTransactions,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetworkWithKind;
    pendingTransactions: IEvmTransactionResponse[];
  }) {
    const confirmedTx =
      await this.transactionsManager.utils.checkPendingTransactions(
        pendingTransactions
      );

    if (!!confirmedTx.length) {
      validateAndManageUserTransactions(confirmedTx);
    }
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

  public async getInitialSysTokenForAccount(xpub: string) {
    const cacheKey = createCacheKey(
      'sysAssets',
      xpub,
      initialState.activeNetwork.url,
      initialState.activeNetwork.chainId
    );

    return getCachedRequest(cacheKey, async () => {
      store.dispatch(setIsLoadingAssets(true));

      const initialSysAssetsForAccount =
        await this.assetsManager.sys.getSysAssetsByXpub(
          xpub,
          initialState.activeNetwork.url,
          initialState.activeNetwork.chainId
        );

      store.dispatch(setIsLoadingAssets(false));

      return initialSysAssetsForAccount;
    });
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
    activeNetwork: INetworkWithKind;
    isBitcoinBased: boolean;
    isPolling?: boolean | null;
  }) {
    const { accounts } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];

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
                this.ethereumTransaction.web3Provider
              );
            const validateUpdatedAndPreviousAssetsLength =
              updatedAssets.ethereum.length <
                currentAccount.assets.ethereum.length ||
              updatedAssets.syscoin.length <
                currentAccount.assets.syscoin.length;

            const validateIfUpdatedAssetsStayEmpty =
              (currentAccount.assets.ethereum.length > 0 &&
                isEmpty(updatedAssets.ethereum)) ||
              (currentAccount.assets.syscoin.length > 0 &&
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
              setAccountPropertyByIdAndType({
                id: activeAccount.id,
                type: activeAccount.type,
                property: 'assets',
                value: updatedAssets,
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
  }

  public updateUserNativeBalance({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
    isPolling,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetworkWithKind;
    isBitcoinBased: boolean;
    isPolling?: boolean;
  }) {
    const { accounts } = store.getState().vault;
    const L2Networks = [324, 300];
    const isL2Network = L2Networks.includes(activeNetwork.chainId);

    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    let internalProvider:
      | CustomJsonRpcProvider
      | CustomL2JsonRpcProvider
      | undefined;

    if (isPolling) {
      const CurrentProvider = isL2Network
        ? CustomL2JsonRpcProvider
        : CustomJsonRpcProvider;

      const abortController = new AbortController();
      internalProvider = new CurrentProvider(
        abortController.signal,
        activeNetwork.url
      );
    }

    const { currentPromise: balancePromise, cancel } =
      this.cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            const updatedBalance =
              await this.balancesManager.utils.getBalanceUpdatedForAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                internalProvider
              );

            const actualUserBalance = isBitcoinBased
              ? currentAccount.balances.syscoin
              : currentAccount.balances.ethereum;
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
  }

  public getLatestUpdateForCurrentAccount(isPolling = false) {
    const now = Date.now();
    const UPDATE_DEBOUNCE_TIME = 500; // 500ms debounce

    const {
      accounts,
      activeAccount,
      isBitcoinBased,
      activeNetwork,
      networkStatus,
    } = store.getState().vault;

    const activeAccountValues = accounts[activeAccount.type][activeAccount.id];
    const isNetworkChanging = networkStatus === 'switching';

    // Create a unique ID for the current account
    const accountId = `${activeAccount.type}:${activeAccount.id}`;

    // If this is a different account than the one we're currently updating, cancel the old update
    if (
      this.currentUpdateAccountId &&
      this.currentUpdateAccountId !== accountId
    ) {
      console.log(
        '[MainController] Cancelling update for previous account:',
        this.currentUpdateAccountId
      );
      this.currentUpdateAccountId = accountId;
      this.lastUpdatePromise = null;
      this.lastUpdateTimestamp = 0;
    } else {
      this.currentUpdateAccountId = accountId;
    }

    // If we have a recent update in progress for the same account, return the existing promise
    if (
      this.lastUpdatePromise &&
      now - this.lastUpdateTimestamp < UPDATE_DEBOUNCE_TIME
    ) {
      console.log(
        '[MainController] Debouncing getLatestUpdateForCurrentAccount call for account:',
        accountId
      );
      return this.lastUpdatePromise;
    }

    if (isNetworkChanging || isNil(activeAccountValues.address)) {
      throw new Error('Could not update account while changing network');
    }

    this.lastUpdateTimestamp = now;
    this.lastUpdatePromise = Promise.all([
      this.updateUserNativeBalance({
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
      this.updateAssetsFromCurrentAccount({
        isBitcoinBased,
        activeNetwork,
        activeAccount,
        isPolling,
      }),
    ]).then(() => {
      // Clear the promise after completion
      this.lastUpdatePromise = null;
    });

    return this.lastUpdatePromise;
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
    const {
      activeNetwork,
      isBitcoinBased,
      accounts,
      activeAccount: { id: activeAccountId, type: activeAccountType },
    } = store.getState().vault;

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

    if (reason === 'Network change cancelled') {
      console.error('User asked to switch network - slow connection');
    } else {
      this.handleStateChange([
        {
          method: PaliEvents.chainChanged,
          params: {
            chainId: `0x${activeNetwork.chainId.toString(16)}`,
            networkVersion: activeNetwork.chainId,
          },
        },
        {
          method: PaliSyscoinEvents.blockExplorerChanged,
          params: isBitcoinBased ? activeNetwork.url : null,
        },
        {
          method: PaliEvents.isTestnet,
          params: {
            isTestnet: isBitcoinBased ? this.verifyIfIsTestnet() : undefined,
          },
        },
        {
          method: PaliEvents.xpubChanged,
          params: isBitcoinBased
            ? accounts[activeAccountType][activeAccountId].xpub
            : null,
        },
        {
          method: PaliEvents.accountsChanged,
          params: isBitcoinBased
            ? null
            : [accounts[activeAccountType][activeAccountId].address],
        },
      ]);
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

  private async configureNetwork(
    network: INetworkWithKind,
    chain: string
  ): Promise<{
    activeChain: INetworkType;
    error?: any;
    success: boolean;
    wallet: IWalletState;
  }> {
    let networkCallError: any = null;

    try {
      const {
        sucess: success,
        wallet,
        activeChain,
      } = await this.setSignerNetwork(network, chain);

      if (success) {
        this.web3Provider = this.ethereumTransaction.web3Provider;
        this.assetsManager = AssetsManager(
          this.ethereumTransaction.web3Provider
        );
        this.assets = this.assetsManager;
        this.transactionsManager = TransactionsManager(
          this.ethereumTransaction.web3Provider
        );
        this.balancesManager = BalancesManager(
          this.ethereumTransaction.web3Provider
        );
        return { success, wallet, activeChain };
      } else {
        // setSignerNetwork failed but didn't throw an error
        // Try to get the actual error by making a test call

        if (chain === INetworkType.Ethereum) {
          try {
            // Create a simple fetch request to test the network
            const response = await fetch(network.url, {
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
            });

            if (!response.ok) {
              const responseText = await response.text();
              console.error(
                'Network test response:',
                response.status,
                responseText
              );

              // Try to parse the error message
              if (responseText) {
                networkCallError = new Error(responseText);
              } else {
                networkCallError = new Error(
                  `Network returned ${response.status} ${response.statusText}`
                );
              }
            }
          } catch (testError) {
            console.error('Network test error:', testError);
            networkCallError = testError;
          }
        }

        return {
          success: false,
          wallet: wallet || this.wallet,
          activeChain:
            activeChain ||
            (chain === INetworkType.Syscoin
              ? INetworkType.Syscoin
              : INetworkType.Ethereum),
          error: networkCallError || new Error('Failed to configure network'),
        };
      }
    } catch (error) {
      console.error('configureNetwork error:', error);
      // Return with success: false and include the error
      return {
        success: false,
        wallet: this.wallet,
        activeChain:
          chain === INetworkType.Syscoin
            ? INetworkType.Syscoin
            : INetworkType.Ethereum,
        error,
      };
    }
  }

  private resolveNetworkConfiguration(
    resolve: (value: {
      activeChain: INetworkType;
      chain: string;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetworkWithKind;
      networkVersion: number;
      wallet: IWalletState;
    }) => void,
    {
      activeChain,
      chain,
      chainId,
      isBitcoinBased,
      network,
      networkVersion,
      wallet,
    }: {
      activeChain: INetworkType;
      chain: string;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetworkWithKind;
      networkVersion: number;
      wallet: IWalletState;
    }
  ) {
    resolve({
      activeChain,
      chain,
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
    network: INetworkWithKind,
    chain: string,
    cancelled: boolean,
    resolve: (value: {
      activeChain: INetworkType;
      chain: string;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetworkWithKind;
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
    store.dispatch(setCurrentBlock(undefined));

    const isBitcoinBased = chain === INetworkType.Syscoin;
    try {
      const { success, wallet, activeChain, error } =
        await this.configureNetwork(network, chain);
      const chainId = network.chainId.toString(16);
      const networkVersion = network.chainId;

      if (success) {
        this.resolveNetworkConfiguration(resolve, {
          activeChain,
          chain,
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
    isBitcoinBased: boolean,
    network: INetworkWithKind
  ) {
    store.dispatch(
      setNetworkChange({
        activeChain,
        wallet,
      })
    );
    store.dispatch(setIsBitcoinBased(isBitcoinBased));
    store.dispatch(setIsLoadingBalances(false));
    await this.setFiat();
    this.updateAssetsFromCurrentAccount({
      isBitcoinBased,
      activeNetwork: network,
      activeAccount: {
        id: wallet.activeAccountId,
        type: wallet.activeAccountType,
      },
    });
    this.updateUserTransactionsState({
      isPolling: false,
      isBitcoinBased,
      activeNetwork: network,
    });
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
      const isTestnet = this.verifyIfIsTestnet();
      this.handleStateChange([
        {
          method: PaliEvents.isTestnet,
          params: { isTestnet },
        },
        {
          method: PaliEvents.xpubChanged,
          params:
            wallet.accounts[wallet.activeAccountType][wallet.activeAccountId]
              .xpub,
        },
        {
          method: PaliEvents.accountsChanged,
          params: null,
        },
      ]);
    } else {
      this.handleStateChange([
        {
          method: PaliEvents.isTestnet,
          params: { isTestnet: undefined },
        },
        {
          method: PaliEvents.xpubChanged,
          params: null,
        },
        {
          method: PaliEvents.accountsChanged,
          params: [
            wallet.accounts[wallet.activeAccountType][wallet.activeAccountId]
              .address,
          ],
        },
      ]);
    }
    store.dispatch(switchNetworkSuccess(network));
  }
  // Transaction utilities from sysweb3-utils (previously from ControllerUtils)
  private txUtils = txUtils();

  // Expose txUtils methods individually for better type safety
  public getRawTransaction = this.txUtils.getRawTransaction;
  // Add other txUtils methods as needed

  // Network status management
  public resetNetworkStatus(): void {
    store.dispatch(resetNetworkStatus());
  }
}

export default MainController;
