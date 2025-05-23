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
  INetworkType,
  validateSysRpc,
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
  setChangingConnectedAccount,
  setAccounts,
  setNetworkChange,
  setHasEthProperty as setEthProperty,
  setIsLoadingTxs,
  initialState,
  setIsLoadingAssets,
  setIsLastTxConfirmed as setIsLastTxConfirmedToState,
  setIsLoadingBalances,
  setAccountPropertyByIdAndType,
  setAccountsWithLabelEdited,
  setAdvancedSettings as setSettings,
  setMultipleTransactionToState,
  setSingleTransactionToState,
  setTransactionStatusToCanceled,
  setTransactionStatusToAccelerated,
  setOpenDAppErrorModal,
  setFaucetModalState as setShouldShowFaucetModal,
  startSwitchNetwork,
  switchNetworkSuccess,
  switchNetworkError,
  resetNetworkStatus,
  setCoinsList,
  setNetworkType,
  setIsBitcoinBased,
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
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';
import NftsController from './nfts/nfts';
import TransactionsManager from './transactions';
import {
  IEvmTransactionResponse,
  ISysTransaction,
  ITransactionsManager,
} from './transactions/types';
import { validateAndManageUserTransactions } from './transactions/utils';

// Constants for fiat price functionality
const COINS_LIST_CACHE_KEY = 'pali_coinsListCache';
const COINS_LIST_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

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

  constructor(walletState: any) {
    super(walletState);

    // Initialize web3Provider from the inherited ethereumTransaction
    // This will be updated when switching networks
    this.web3Provider = this.ethereumTransaction.web3Provider;

    this.assetsManager = AssetsManager(this.web3Provider);
    this.nftsController = NftsController();
    this.transactionsManager = TransactionsManager(this.web3Provider);
    this.balancesManager = BalancesManager(this.web3Provider);
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
          const { chain } = await validateSysRpc(activeNetworkURL);
          if (chain !== 'test') {
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

  public setAccount(
    id: number,
    type: KeyringAccountType,
    host?: string,
    connectedAccount?: IOmmitedAccount
  ) {
    const { accounts, activeAccount } = store.getState().vault;
    if (
      connectedAccount &&
      connectedAccount.address ===
        accounts[activeAccount.type][activeAccount.id].address
    ) {
      if (connectedAccount.address !== accounts[type][id].address) {
        store.dispatch(
          setChangingConnectedAccount({
            host,
            isChangingConnectedAccount: true,
            newConnectedAccount: accounts[type][id],
            connectedAccountType: type,
          })
        );
        return;
      }
    }

    this.setActiveAccount(id, type).then(() => {
      store.dispatch(setActiveAccount({ id, type }));
    });
  }

  public async setActiveNetwork(
    network: INetworkWithKind
  ): Promise<{ chainId: string; networkVersion: number }> {
    // Legacy method - delegate to switchNetwork
    await this.switchNetwork(network);
    return {
      chainId: network.chainId.toString(16),
      networkVersion: network.chainId,
    };
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
        host: undefined,
        isChangingConnectedAccount: false,
        newConnectedAccount: undefined,
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
      this.transactionsManager = TransactionsManager(this.web3Provider);
      this.balancesManager = BalancesManager(this.web3Provider);

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
    this.setActiveAccount(paliImp.id, KeyringAccountType.Ledger);
    store.dispatch(
      setActiveAccount({ id: paliImp.id, type: KeyringAccountType.Ledger })
    );
    this.updateUserTransactionsState({
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
    const vaultState = store.getState().vault;
    const { accounts, isBitcoinBased } = vaultState;

    const userAccount = accounts[activeAccount.type][activeAccount.id];

    if (isBitcoinBased) return;

    try {
      await this.getUserNftsByNetwork(
        userAccount.address,
        activeNetwork.chainId,
        activeNetwork.url
      );
    } catch (error) {
      console.error('Error fetching NFTs:', error);
    }
  }

  public async getInitialSysTransactionsForAccount(xpub: string) {
    store.dispatch(setIsLoadingTxs(true));

    const initialTxsForAccount =
      await this.transactionsManager.sys.getInitialUserTransactionsByXpub(
        xpub,
        initialState.activeNetwork.url
      );

    store.dispatch(setIsLoadingTxs(false));

    return initialTxsForAccount;
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
  ): Promise<any> {
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    if (isBitcoinBased) {
      return this.transactions.sys
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
      return this.transactionsManager.utils.updateTransactionsFromCurrentAccount(
        currentAccount,
        isBitcoinBased,
        activeNetwork.url
      );
    }
  }

  public updateUserTransactionsState({
    isBitcoinBased,
    activeNetwork,
  }: {
    activeNetwork: INetworkWithKind;
    isBitcoinBased: boolean;
  }): Promise<void> {
    return this.callUpdateTxsMethodBasedByIsBitcoinBased(
      isBitcoinBased,
      store.getState().vault.activeAccount,
      activeNetwork
    );
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
    store.dispatch(setIsLoadingAssets(true));

    const initialSysAssetsForAccount =
      await this.assetsManager.sys.getSysAssetsByXpub(
        xpub,
        initialState.activeNetwork.url,
        initialState.activeNetwork.chainId
      );

    store.dispatch(setIsLoadingAssets(false));

    return initialSysAssetsForAccount;
  }

  public updateAssetsFromCurrentAccount({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetworkWithKind;
    isBitcoinBased: boolean;
  }): Promise<void> {
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    return this.assetsManager.utils
      .updateAssetsFromCurrentAccount(
        currentAccount,
        isBitcoinBased,
        activeNetwork.url,
        activeNetwork.chainId,
        this.web3Provider
      )
      .then((updatedAssets) => {
        store.dispatch(setIsLoadingAssets(true));

        store.dispatch(
          setAccountPropertyByIdAndType({
            id: activeAccount.id,
            type: activeAccount.type,
            property: 'assets',
            value: updatedAssets,
          })
        );

        store.dispatch(setIsLoadingAssets(false));
      });
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
    activeNetwork: INetworkWithKind;
    isBitcoinBased: boolean;
  }): Promise<void> {
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const balancePromise = isBitcoinBased
      ? this.balancesManager.sys.getSysBalanceForAccount(
          currentAccount,
          activeNetwork.url
        )
      : this.balancesManager.evm.getEvmBalanceForAccount(currentAccount);

    return balancePromise.then((updatedBalance) => {
      const actualUserBalance = isBitcoinBased
        ? currentAccount.balances.syscoin
        : currentAccount.balances.ethereum;

      const shouldUpdate =
        Number(actualUserBalance) !== parseFloat(updatedBalance);

      if (shouldUpdate) {
        store.dispatch(setIsLoadingBalances(true));
        store.dispatch(
          setAccountPropertyByIdAndType({
            id: activeAccount.id,
            type: activeAccount.type,
            property: 'balances',
            value: {
              ...currentAccount.balances,
              [isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum]:
                updatedBalance,
            },
          })
        );
        store.dispatch(setIsLoadingBalances(false));
      }
    });
  }

  public async getLatestUpdateForCurrentAccount(isPolling = false) {
    const {
      activeAccount: activeAccountInfo,
      activeNetwork,
      isBitcoinBased,
      accounts,
      networkStatus,
    } = store.getState().vault;

    // Don't run updates during network changes to prevent calls to wrong network
    if (networkStatus !== 'idle') {
      console.log(
        'getLatestUpdateForCurrentAccount: Skipping updates during network change'
      );
      return;
    }

    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];
    if (!activeAccount || !activeNetwork) {
      console.log(
        'getLatestUpdateForCurrentAccount: No active account or network'
      );
      return;
    }

    console.log(
      `getLatestUpdateForCurrentAccount: Running updates for ${activeNetwork.label}`
    );

    try {
      await Promise.allSettled([
        this.updateUserNativeBalance({
          activeAccount: activeAccountInfo,
          activeNetwork,
          isBitcoinBased,
        }),
        this.updateAssetsFromCurrentAccount({
          activeAccount: activeAccountInfo,
          activeNetwork,
          isBitcoinBased,
        }),
        this.callUpdateTxsMethodBasedByIsBitcoinBased(
          isBitcoinBased,
          activeAccountInfo,
          activeNetwork
        ),
        !isPolling
          ? this.fetchAndUpdateNftsState({
              activeAccount: activeAccountInfo,
              activeNetwork,
            })
          : Promise.resolve(),
      ]);
    } catch (error) {
      console.error(
        'getLatestUpdateForCurrentAccount: Failed to update account data:',
        error
      );
    }
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

  private bindMethods() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (typeof this[key] === 'function' && key !== 'constructor') {
        this[key] = this[key].bind(this);
      }
    }
  }

  public async switchNetwork(target: INetworkWithKind): Promise<void> {
    const chain =
      target.kind === 'utxo' ? INetworkType.Syscoin : INetworkType.Ethereum;

    // Already on this network?
    const currentState = store.getState().vault;
    if (target.url === currentState.activeNetwork.url) {
      console.log(
        `switchNetwork: Already on ${target.label}, no switch needed`
      );
      return;
    }

    console.log(
      `switchNetwork: Starting switch to ${target.label} (${chain}) kind: ${target.kind}`
    );
    store.dispatch(startSwitchNetwork(target));

    try {
      // Validate RPC connection first to catch 401 errors early
      console.log(
        `switchNetwork: Validating RPC connection for ${target.label}`
      );
      if (chain === INetworkType.Ethereum) {
        const { valid } = await validateEthRpc(target.url, false);
        if (!valid) {
          throw new Error(`Invalid EVM RPC endpoint: ${target.url}`);
        }
      } else {
        const { valid } = await validateSysRpc(target.url);
        if (!valid) {
          throw new Error(`Invalid UTXO RPC endpoint: ${target.url}`);
        }
      }
      console.log(
        `switchNetwork: RPC validation successful for ${target.label}`
      );

      // Update network configuration in KeyringManager - this handles internal provider updates
      this.updateNetworkConfig(target, chain as INetworkType);

      // For EVM networks, update the web3Provider reference and recreate managers
      if (chain === INetworkType.Ethereum) {
        console.log(
          `switchNetwork: Updating web3Provider reference and recreating managers`
        );
        this.web3Provider = this.ethereumTransaction.web3Provider; // Get the updated provider
        this.assetsManager = AssetsManager(this.web3Provider);
        this.transactionsManager = TransactionsManager(this.web3Provider);
        this.balancesManager = BalancesManager(this.web3Provider);
        this.assets = this.assetsManager;
      }

      // Update Redux state - useController will handle UI provider creation when status becomes 'idle'
      store.dispatch(switchNetworkSuccess(target));
      store.dispatch(setNetworkType(chain as INetworkType));
      store.dispatch(setIsBitcoinBased(chain === INetworkType.Syscoin));

      console.log(`switchNetwork: Successfully switched to ${target.label}`);
    } catch (error) {
      console.error(
        `switchNetwork: Failed to switch to ${target.label}:`,
        error
      );
      const errorMessage =
        error?.message || `Failed to switch to ${target.label}`;
      store.dispatch(switchNetworkError());
      store.dispatch(setStoreError(errorMessage));

      // Ensure we don't leave the network in switching state
      setTimeout(() => {
        const currentStatus = store.getState().vault.networkStatus;
        if (currentStatus === 'switching' || currentStatus === 'error') {
          console.log(
            'switchNetwork: Forcing network status reset after error'
          );
          store.dispatch(resetNetworkStatus());
        }
      }, 1000);

      throw error;
    }
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
