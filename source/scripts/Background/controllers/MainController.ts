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
} from '@pollum-io/sysweb3-keyring';
import {
  getSysRpc,
  getEthRpc,
  INetwork,
  INetworkType,
} from '@pollum-io/sysweb3-network';
import { getSearch, getTokenStandardMetadata } from '@pollum-io/sysweb3-utils';

import { getController } from '..';
import PaliLogo from 'assets/icons/favicon-32.png';
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
  setIsNetworkChanging,
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
} from 'state/vault';
import {
  IOmmitedAccount,
  IPaliAccount,
  TransactionsType,
} from 'state/vault/types';
import { IControllerUtils } from 'types/controllers';
import { ITokenEthProps, IWatchAssetTokenProps } from 'types/tokens';
import { ICustomRpcParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';
import { getNetworkChain } from 'utils/network';

import EthAccountController, { IEthAccountController } from './account/evm';
import SysAccountController, { ISysAccountController } from './account/syscoin';
import AssetsManager from './assets';
import { IAssetsManager, INftController } from './assets/types';
import BalancesManager from './balances';
import { IBalancesManager } from './balances/types';
import ControllerUtils from './ControllerUtils';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';
import NftsController from './nfts/nfts';
import {
  CancellablePromises,
  PromiseTargets,
} from './promises/cancellablesPromises';
import TransactionsManager from './transactions';
import {
  IEvmTransactionResponse,
  ISysTransaction,
  ITransactionsManager,
} from './transactions/types';
import { validateAndManageUserTransactions } from './transactions/utils';

class MainController extends KeyringManager {
  public account: {
    eth: IEthAccountController;
    sys: ISysAccountController;
  };
  public assets: IAssetsManager;
  public transactions: ITransactionsManager;
  private utilsController: IControllerUtils;
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

  // Track the last update time for each data type to avoid hammering the network
  private lastUpdateTimestamps = {
    balance: 0,
    assets: 0,
    transactions: 0,
    nfts: 0,
  };

  private readonly UPDATE_INTERVALS = {
    balance: 10000, // 10 seconds
    assets: 30000, // 30 seconds
    transactions: 15000, // 15 seconds
    nfts: 120000, // 2 minutes
  };

  constructor(walletState: any) {
    super(walletState);
    this.utilsController = ControllerUtils();
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
    network: INetwork,
    chain: string
  ): Promise<{ chainId: string; networkVersion: number }> {
    let cancelled = false;
    if (this.currentPromise) {
      this.currentPromise.cancel();
      cancelled = true;
    }

    const promiseWrapper = this.createCancellablePromise<{
      activeChain: INetworkType;
      chain: string;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
      wallet: IWalletState;
    }>((resolve, reject) => {
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
    store.dispatch(setStoreError(false));
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

  public setIsPaliNetworkChanging(isChanging: boolean) {
    store.dispatch(setIsNetworkChanging(isChanging));
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
    } as INetwork;

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
    oldRpc: INetwork
  ): Promise<INetwork> {
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
        ...(oldRpc?.key && { key: oldRpc.key }),
      } as INetwork;

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
    this.setActiveAccount(paliImp.id, KeyringAccountType.Ledger);
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
    activeNetwork: INetwork;
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
    activeNetwork: INetwork
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
    isPolling,
    isBitcoinBased,
    activeNetwork,
  }: {
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling: boolean;
  }): Promise<void> {
    const { accounts, activeAccount } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const promiseObj = this.cancellablePromises.createCancellablePromise<void>(
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
      currentPromise: promiseObj.currentPromise,
      cancel: promiseObj.cancel,
    });

    this.cancellablePromises.runPromise(PromiseTargets.TRANSACTION);
    return promiseObj.currentPromise;
  }

  public async validatePendingEvmTransactions({
    pendingTransactions,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
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
    isPolling,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling?: boolean | null;
  }): Promise<void> {
    const { accounts } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const promiseObj = this.cancellablePromises.createCancellablePromise<void>(
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
            (updatedAssets.ethereum
              ? updatedAssets.ethereum.length <
                currentAccount.assets.ethereum.length
              : false) ||
            (updatedAssets.syscoin
              ? updatedAssets.syscoin.length <
                currentAccount.assets.syscoin.length
              : false);

          const validateIfUpdatedAssetsStayEmpty =
            (currentAccount.assets.ethereum.length > 0 &&
              isEmpty(updatedAssets.ethereum)) ||
            (currentAccount.assets.syscoin.length > 0 &&
              isEmpty(updatedAssets.syscoin));

          const validateIfBothUpdatedIsEmpty =
            isEmpty(updatedAssets.ethereum) && isEmpty(updatedAssets.syscoin);

          const validateIfNotNullEthValues = updatedAssets.ethereum
            ? updatedAssets.ethereum.some((value) => isNil(value))
            : false;

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
      currentPromise: promiseObj.currentPromise,
      cancel: promiseObj.cancel,
    });

    this.cancellablePromises.runPromise(PromiseTargets.ASSETS);
    return promiseObj.currentPromise;
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
  }): Promise<void> {
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const promiseObj = this.cancellablePromises.createCancellablePromise<void>(
      async (resolve, reject) => {
        try {
          // Get balance using the correct provider
          const updatedBalance = await (isBitcoinBased
            ? this.balancesManager.sys.getSysBalanceForAccount(
                currentAccount,
                activeNetwork.url
              )
            : this.balancesManager.evm.getEvmBalanceForAccount(currentAccount));

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
      currentPromise: promiseObj.currentPromise,
      cancel: promiseObj.cancel,
    });

    this.cancellablePromises.runPromise(PromiseTargets.BALANCE);
    return promiseObj.currentPromise;
  }

  public async getLatestUpdateForCurrentAccount(isPolling = false) {
    const {
      activeAccount: activeAccountInfo,
      activeNetwork,
      isBitcoinBased,
      accounts,
    } = store.getState().vault;

    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];
    if (!activeAccount || !activeNetwork) return;

    const now = Date.now();
    const updates: Promise<any>[] = [];

    // Check if each data type needs updating based on its interval
    if (
      now - this.lastUpdateTimestamps.balance >=
      this.UPDATE_INTERVALS.balance
    ) {
      updates.push(
        this.updateUserNativeBalance({
          activeAccount: activeAccountInfo,
          activeNetwork,
          isBitcoinBased,
        }).then(() => (this.lastUpdateTimestamps.balance = now))
      );
    }

    if (
      now - this.lastUpdateTimestamps.assets >=
      this.UPDATE_INTERVALS.assets
    ) {
      updates.push(
        this.updateAssetsFromCurrentAccount({
          activeAccount: activeAccountInfo,
          activeNetwork,
          isBitcoinBased,
          isPolling,
        }).then(() => (this.lastUpdateTimestamps.assets = now))
      );
    }

    if (
      now - this.lastUpdateTimestamps.transactions >=
      this.UPDATE_INTERVALS.transactions
    ) {
      updates.push(
        this.callUpdateTxsMethodBasedByIsBitcoinBased(
          isBitcoinBased,
          activeAccountInfo,
          activeNetwork
        ).then(() => (this.lastUpdateTimestamps.transactions = now))
      );
    }

    // NFTs update less frequently and only when not polling
    if (
      !isPolling &&
      now - this.lastUpdateTimestamps.nfts >= this.UPDATE_INTERVALS.nfts
    ) {
      updates.push(
        this.fetchAndUpdateNftsState({
          activeAccount: activeAccountInfo,
          activeNetwork,
        }).then(() => (this.lastUpdateTimestamps.nfts = now))
      );
    }

    try {
      await Promise.allSettled(updates);
    } catch (error) {
      console.error('Failed to update account data:', error);
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

  private handleNetworkChangeError = (reason: any) => {
    const {
      activeNetwork,
      isBitcoinBased,
      accounts,
      activeAccount: { id: activeAccountId, type: activeAccountType },
    } = store.getState().vault;

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

    store.dispatch(setStoreError(true));
    store.dispatch(setIsNetworkChanging(false));
    store.dispatch(setIsLoadingBalances(false));
  };

  private async handleNetworkChangeSuccess(
    wallet: IWalletState,
    activeChain: INetworkType,
    isBitcoinBased: boolean,
    network: INetwork
  ) {
    // Batch state updates to reduce re-renders
    const updates = [
      setNetworkChange({ activeChain, wallet }),
      setIsBitcoinBased(isBitcoinBased),
      setIsLoadingBalances(false),
    ];

    // Dispatch batched updates
    updates.forEach((action) => store.dispatch(action));

    await this.utilsController.setFiat();

    // Batch asset and transaction updates
    const updatePromises = [
      this.updateAssetsFromCurrentAccount({
        isBitcoinBased,
        activeNetwork: network,
        activeAccount: {
          id: wallet.activeAccountId,
          type: wallet.activeAccountType,
        },
      }),
      this.updateUserTransactionsState({
        isPolling: false,
        isBitcoinBased,
        activeNetwork: network,
      }),
    ];

    // Run updates in parallel
    await Promise.all(updatePromises);

    // Notify DApps about network changes
    const controller = getController();

    // Chain changed event
    await controller.dapp.handleStateChange(PaliEvents.chainChanged, {
      method: PaliEvents.chainChanged,
      params: {
        chainId: `0x${network.chainId.toString(16)}`,
        networkVersion: network.chainId,
        isBitcoinBased,
      },
    });

    // Bitcoin based status event
    await controller.dapp.handleStateChange(PaliEvents.isBitcoinBased, {
      method: PaliEvents.isBitcoinBased,
      params: { isBitcoinBased },
    });

    // Block explorer event
    await controller.dapp.handleBlockExplorerChange(
      PaliSyscoinEvents.blockExplorerChanged,
      {
        method: PaliSyscoinEvents.blockExplorerChanged,
        params: isBitcoinBased ? network.url : null,
      }
    );

    // Chain-specific events
    if (isBitcoinBased) {
      // For Syscoin chain, we use xpubChanged
      await controller.dapp.handleBlockExplorerChange(
        PaliSyscoinEvents.xpubChanged,
        {
          method: PaliSyscoinEvents.xpubChanged,
          params:
            wallet.accounts[wallet.activeAccountType][wallet.activeAccountId]
              .xpub,
        }
      );
    } else {
      // For Ethereum chain, we use accountsChanged
      await controller.dapp.handleStateChange(PaliEvents.accountsChanged, {
        method: PaliEvents.accountsChanged,
        params: [
          wallet.accounts[wallet.activeAccountType][wallet.activeAccountId]
            .address,
        ],
      });
    }

    store.dispatch(setIsNetworkChanging(false));
  }

  private async configureNetwork(
    network: INetwork,
    chain: string
  ): Promise<{
    activeChain: INetworkType;
    success: boolean;
    wallet: IWalletState;
  }> {
    // Only create new provider if network actually changed
    const currentNetwork = store.getState().vault.activeNetwork;
    const networkChanged =
      currentNetwork.chainId !== network.chainId ||
      currentNetwork.url !== network.url;

    if (!networkChanged) {
      // Network didn't actually change, return current state
      const currentState = store.getState().vault;
      const walletState = {
        ...currentState,
        activeAccountId: currentState.activeAccount.id,
        activeAccountType: currentState.activeAccount.type,
        networks: currentState.networks,
        accounts: currentState.accounts,
      } as IWalletState;

      return {
        success: true,
        wallet: walletState,
        activeChain: chain as INetworkType,
      };
    }

    // Network changed, configure new signer and providers
    const result = await this.setSignerNetwork(network, chain);

    // Create new provider and managers if needed
    if (result.sucess && (!this.web3Provider || networkChanged)) {
      this.web3Provider = this.ethereumTransaction.web3Provider;
      this.assetsManager = AssetsManager(this.web3Provider);
      this.assets = this.assetsManager;
      this.transactionsManager = TransactionsManager(this.web3Provider);
      this.balancesManager = BalancesManager(this.web3Provider);
    }

    return {
      success: result.sucess,
      wallet:
        result.wallet ||
        ({
          ...store.getState().vault,
          activeAccountId: store.getState().vault.activeAccount.id,
          activeAccountType: store.getState().vault.activeAccount.type,
        } as IWalletState),
      activeChain: result.activeChain || (chain as INetworkType),
    };
  }

  private resolveNetworkConfiguration(
    resolve: (value: {
      activeChain: INetworkType;
      chain: string;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
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
      network: INetwork;
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
    network: INetwork,
    chain: string,
    cancelled: boolean,
    resolve: (value: {
      activeChain: INetworkType;
      chain: string;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
      wallet: IWalletState;
    }) => void,
    reject: (reason?: any) => void
  ) => {
    if (store.getState().vault.isNetworkChanging && !cancelled) {
      return;
    }

    store.dispatch(setIsNetworkChanging(true));
    store.dispatch(setIsLoadingBalances(true));
    store.dispatch(setCurrentBlock(undefined));

    const isBitcoinBased = chain === INetworkType.Syscoin;
    const { success, wallet, activeChain } = await this.configureNetwork(
      network,
      chain
    );
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
      reject(
        'Pali: fail on setActiveNetwork - keyringManager.setSignerNetwork'
      );
    }
  };
}

export default MainController;
