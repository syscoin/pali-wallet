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

import PaliLogo from 'assets/icons/favicon-32.png';
import store from 'state/store';
import {
  forgetWallet as forgetWalletState,
  setActiveAccount,
  setLastLogin,
  setTimer,
  createAccount as addAccountToStore,
  setNetwork,
  removeNetwork as removeNetworkFromStore,
  setStoreError,
  setIsBitcoinBased,
  setChangingConnectedAccount,
  setIsNetworkChanging,
  setIsTimerEnabled as setIsTimerActive,
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
} from 'state/vault';
import {
  IOmmitedAccount,
  IPaliAccount,
  TransactionsType,
} from 'state/vault/types';
import { IMainController } from 'types/controllers';
import { ITokenEthProps, IWatchAssetTokenProps } from 'types/tokens';
import { ICustomRpcParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';
import { getNetworkChain } from 'utils/network';

import EthAccountController from './account/evm';
import SysAccountController from './account/syscoin';
import AssetsManager from './assets';
import BalancesManager from './balances';
import ControllerUtils from './ControllerUtils';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';
import NftsController from './nfts/nfts';
import {
  CancellablePromises,
  PromiseTargets,
} from './promises/cancellablesPromises';
import TransactionsManager from './transactions';
import { IEvmTransactionResponse, ISysTransaction } from './transactions/types';
import { validateAndManageUserTransactions } from './transactions/utils';

const MainController = (walletState): IMainController => {
  const keyringManager = new KeyringManager(walletState);
  const utilsController = Object.freeze(ControllerUtils());
  const assetsManager = AssetsManager();
  const nftsController = NftsController();
  let web3Provider: CustomJsonRpcProvider =
    keyringManager.ethereumTransaction.web3Provider;
  let transactionsManager = TransactionsManager(web3Provider);
  let balancesManager = BalancesManager(web3Provider);
  const cancellablePromises = new CancellablePromises();

  let currentPromise: {
    cancel: () => void;
    promise: Promise<{ chainId: string; networkVersion: number }>;
  } | null = null;

  const { verifyIfIsTestnet } = keyringManager;
  const createCancellablePromise = <T>(
    executor: (
      resolve: (value: T) => void,
      reject: (reason?: any) => void
    ) => void
  ): { cancel: () => void; promise: Promise<T> } => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    let cancel = () => {};
    const promise: Promise<T> = new Promise((resolve, reject) => {
      cancel = () => {
        reject('Network change cancelled');
      };
      executor(resolve, reject);
    });

    return { promise, cancel };
  };

  const setAutolockTimer = (minutes: number) => {
    store.dispatch(setTimer(minutes));
  };
  const setHasEthProperty = (exist: boolean) => {
    store.dispatch(setEthProperty(exist));
  };

  const setAdvancedSettings = (advancedProperty: string, isActive: boolean) => {
    store.dispatch(setSettings({ advancedProperty, isActive }));
  };

  const getKeyringManager = (): KeyringManager => keyringManager;
  const walletController = {
    account: {
      sys: SysAccountController(getKeyringManager),
      eth: EthAccountController(),
    },
  };

  /** forget your wallet created with pali and associated with your seed phrase,
   *  but don't delete seed phrase so it is possible to create a new
   *  account using the same seed
   */
  const forgetWallet = (pwd: string) => {
    keyringManager.forgetMainWallet(pwd);

    store.dispatch(forgetWalletState());
    store.dispatch(setLastLogin());
  };

  const unlockFromController = async (pwd: string): Promise<boolean> => {
    const { canLogin, wallet } = await keyringManager.unlock(pwd);
    if (!canLogin) throw new Error('Invalid password');

    if (!isEmpty(wallet)) {
      store.dispatch(
        setNetworkChange({
          activeChain: INetworkType.Syscoin,
          wallet,
        })
      );
    }

    store.dispatch(setLastLogin());
    //TODO: validate contentScripts flow
    window.controller.dapp
      .handleStateChange(PaliEvents.lockStateChanged, {
        method: PaliEvents.lockStateChanged,
        params: {
          accounts: [],
          isUnlocked: keyringManager.isUnlocked(),
        },
      })
      .catch((error) => console.error('Unlock', error));
    return canLogin;
  };

  const createWallet = async (
    password: string,
    phrase: string
  ): Promise<void> => {
    store.dispatch(setIsLoadingBalances(true));
    const {
      accounts,
      activeAccount: activeAccountInfo,
      activeNetwork,
    } = store.getState().vault;
    const activeAccount =
      accounts[activeAccountInfo.type][activeAccountInfo.id];

    const handleWalletInfo = () => {
      keyringManager.setSeed(phrase);
      keyringManager.setWalletPassword(password);
    };

    // set seed and wallet password for the new created wallet.
    handleWalletInfo();

    if (activeAccount.address !== '') {
      // if pali already have a wallet, we will forget the previous wallet
      forgetWallet(password);
      // and set the new wallet info for KeyringManager class.
      handleWalletInfo();
    }

    const account =
      (await keyringManager.createKeyringVault()) as IKeyringAccountState;

    const initialSysAssetsForAccount = await getInitialSysTokenForAccount(
      account.xpub
    );
    //todo: test promise.all to enhance performance
    const initialTxsForAccount = await getInitialSysTransactionsForAccount(
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
  };

  const lock = () => {
    keyringManager.logout();

    store.dispatch(setLastLogin());
    window.controller.dapp
      .handleStateChange(PaliEvents.lockStateChanged, {
        method: PaliEvents.lockStateChanged,
        params: {
          accounts: [],
          isUnlocked: keyringManager.isUnlocked(),
        },
      })
      .catch((error) => console.error(error));
    return;
  };

  const setIsAutolockEnabled = (isEnabled: boolean) => {
    store.dispatch(setIsTimerActive(isEnabled));
  };

  const createAccount = async (
    isBitcoinBased: boolean,
    activeNetworkChainId: number,
    label?: string
  ): Promise<IPaliAccount> => {
    const newAccount = await keyringManager.addNewAccount(label);
    let newAccountWithAssets: IPaliAccount;

    switch (isBitcoinBased) {
      case true:
        const initialSysAssetsForAccount = await getInitialSysTokenForAccount(
          newAccount.xpub
        );

        const initialTxsForAccount = await getInitialSysTransactionsForAccount(
          newAccount.xpub
        );

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
        break;
      case false:
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
  };

  const setAccount = (
    id: number,
    type: KeyringAccountType,
    host?: string,
    connectedAccount?: IOmmitedAccount
  ): void => {
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

    //TODO: investigate if here would be a ideal place to add balance update
    keyringManager.setActiveAccount(id, type);
    store.dispatch(setActiveAccount({ id, type }));
  };

  const setActiveNetwork = async (
    network: INetwork,
    chain: string
  ): Promise<{ chainId: string; networkVersion: number }> => {
    let cancelled = false;
    if (currentPromise) {
      currentPromise.cancel();
      cancelled = true;
    }

    const promiseWrapper = createCancellablePromise<{
      activeChain: INetworkType;
      chain: string;
      chainId: string;
      isBitcoinBased: boolean;
      network: INetwork;
      networkVersion: number;
      wallet: IWalletState;
    }>((resolve, reject) => {
      setActiveNetworkLogic(network, chain, cancelled, resolve, reject);
    });
    currentPromise = promiseWrapper;
    promiseWrapper.promise
      .then(async ({ wallet, activeChain, isBitcoinBased }) => {
        store.dispatch(
          setNetworkChange({
            activeChain,
            wallet,
          })
        );
        store.dispatch(setIsBitcoinBased(isBitcoinBased));
        store.dispatch(setIsLoadingBalances(false));
        await utilsController.setFiat(); // TODO: We should just call the asset on network edition and get added networks coins price with one call from the background;

        updateAssetsFromCurrentAccount({
          isBitcoinBased,
          activeNetwork: network,
          activeAccount: {
            id: wallet.activeAccountId,
            type: wallet.activeAccountType,
          },
        });

        updateUserTransactionsState({
          isPolling: false,
          isBitcoinBased,
          activeNetwork: network,
          activeAccount: {
            id: wallet.activeAccountId,
            type: wallet.activeAccountType,
          },
        });
        window.controller.dapp.handleStateChange(PaliEvents.chainChanged, {
          method: PaliEvents.chainChanged,
          params: {
            chainId: `0x${network.chainId.toString(16)}`,
            networkVersion: network.chainId,
          },
        });

        window.controller.dapp.handleStateChange(PaliEvents.isBitcoinBased, {
          method: PaliEvents.isBitcoinBased,
          params: { isBitcoinBased },
        });

        window.controller.dapp.handleBlockExplorerChange(
          PaliSyscoinEvents.blockExplorerChanged,
          {
            method: PaliSyscoinEvents.blockExplorerChanged,
            params: isBitcoinBased ? network.url : null,
          }
        );

        switch (isBitcoinBased) {
          case true:
            const isTestnet = verifyIfIsTestnet();

            window.controller.dapp.handleStateChange(PaliEvents.isTestnet, {
              method: PaliEvents.isTestnet,
              params: { isTestnet },
            });

            window.controller.dapp.handleStateChange(PaliEvents.xpubChanged, {
              method: PaliEvents.xpubChanged,
              params:
                wallet.accounts[wallet.activeAccountType][
                  wallet.activeAccountId
                ].xpub,
            });

            window.controller.dapp.handleStateChange(
              PaliEvents.accountsChanged,
              {
                method: PaliEvents.accountsChanged,
                params: null,
              }
            );
            break;
          case false:
            window.controller.dapp.handleStateChange(PaliEvents.isTestnet, {
              method: PaliEvents.isTestnet,
              params: { isTestnet: undefined },
            });

            window.controller.dapp.handleStateChange(PaliEvents.xpubChanged, {
              method: PaliEvents.xpubChanged,
              params: null,
            });

            window.controller.dapp.handleStateChange(
              PaliEvents.accountsChanged,
              {
                method: PaliEvents.accountsChanged,
                params: [
                  wallet.accounts[wallet.activeAccountType][
                    wallet.activeAccountId
                  ].address,
                ],
              }
            );
            break;
          default:
            break;
        }

        store.dispatch(setIsNetworkChanging(false)); // TODO: remove this , just provisory
        return;
      })
      .catch((reason) => {
        if (reason === 'Network change cancelled') {
          console.error('User asked to switch network - slow connection');
        } else {
          const {
            activeNetwork,
            isBitcoinBased,
            accounts,
            activeAccount: { id: activeAccountId, type: activeAccountType },
          } = store.getState().vault;
          window.controller.dapp.handleStateChange(PaliEvents.chainChanged, {
            method: PaliEvents.chainChanged,
            params: {
              chainId: `0x${activeNetwork.chainId.toString(16)}`,
              networkVersion: activeNetwork.chainId,
            },
          });
          window.controller.dapp.handleBlockExplorerChange(
            PaliSyscoinEvents.blockExplorerChanged,
            {
              method: PaliSyscoinEvents.blockExplorerChanged,
              params: isBitcoinBased ? network.url : null,
            }
          );

          switch (isBitcoinBased) {
            case true:
              const isTestnet = verifyIfIsTestnet();

              window.controller.dapp.handleStateChange(PaliEvents.isTestnet, {
                method: PaliEvents.isTestnet,
                params: { isTestnet },
              });

              window.controller.dapp.handleStateChange(PaliEvents.xpubChanged, {
                method: PaliEvents.xpubChanged,
                params: accounts[activeAccountType][activeAccountId].xpub,
              });

              window.controller.dapp.handleStateChange(
                PaliEvents.accountsChanged,
                {
                  method: PaliEvents.accountsChanged,
                  params: null,
                }
              );

              break;
            case false:
              window.controller.dapp.handleStateChange(PaliEvents.isTestnet, {
                method: PaliEvents.isTestnet,
                params: { isTestnet: undefined },
              });

              window.controller.dapp.handleStateChange(PaliEvents.xpubChanged, {
                method: PaliEvents.xpubChanged,
                params: null,
              });

              window.controller.dapp.handleStateChange(
                PaliEvents.accountsChanged,
                {
                  method: PaliEvents.accountsChanged,
                  params: [
                    accounts[activeAccountType][activeAccountId].address,
                  ],
                }
              );
            default:
              break;
          }
        }
        store.dispatch(setStoreError(true));
        store.dispatch(setIsNetworkChanging(false));
        store.dispatch(setIsLoadingBalances(false));
      });
    return promiseWrapper.promise;
  };
  const setActiveNetworkLogic = async (
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

    const { sucess, wallet, activeChain } =
      await keyringManager.setSignerNetwork(network, chain);
    const chainId = network.chainId.toString(16);
    const networkVersion = network.chainId;
    if (sucess) {
      web3Provider = keyringManager.ethereumTransaction.web3Provider;
      transactionsManager = TransactionsManager(
        keyringManager.ethereumTransaction.web3Provider
      );
      balancesManager = BalancesManager(
        keyringManager.ethereumTransaction.web3Provider
      );
      resolve({
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

  const removeWindowEthProperty = () => {
    window.controller.dapp.handleStateChange(PaliEvents.removeProperty, {
      method: PaliEvents.removeProperty,
      params: {
        type: PaliEvents.removeProperty,
      },
    });
  };

  const addWindowEthProperty = () => {
    window.controller.dapp.handleStateChange(PaliEvents.addProperty, {
      method: PaliEvents.addProperty,
      params: {
        type: PaliEvents.addProperty,
      },
    });
  };

  const resolveError = () => store.dispatch(setStoreError(false));
  const resolveAccountConflict = () => {
    store.dispatch(
      setChangingConnectedAccount({
        newConnectedAccount: undefined,
        host: undefined,
        isChangingConnectedAccount: false,
        connectedAccountType: undefined,
      })
    );
  };

  const getSeed = (pwd: string) => keyringManager.getSeed(pwd);

  const getRpc = async (data: ICustomRpcParams): Promise<INetwork> => {
    try {
      //todo: need to adjust to get this from keyringmanager syscoin
      const { formattedNetwork } = data.isSyscoinRpc
        ? (await getSysRpc(data)).rpc
        : await getEthRpc(data, false); //Here we are always either edditing the network to add a new RPC or adding a new Network

      return formattedNetwork;
    } catch (error) {
      if (!data.isSyscoinRpc) {
        throw cleanErrorStack(ethErrors.rpc.internal());
      }
      throw new Error(
        'Could not add your network, please try a different RPC endpoint'
      );
    }
  };

  const handleWatchAsset = async (
    type: string,
    asset: IWatchAssetTokenProps
  ) => {
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
      web3Provider
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

      await walletController.account.eth.saveTokenInfo(assetToAdd);

      return true;
    } catch (error) {
      throw new Error(error);
    }
  };

  const getAssetInfo = async (type: string, asset: IWatchAssetTokenProps) => {
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
      web3Provider
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
  };

  const addCustomRpc = async (data: ICustomRpcParams): Promise<INetwork> => {
    const network = await getRpc(data);

    const networkWithCustomParams = {
      ...network,
      default: false, // We only have RPCs with default as true in our initialNetworksState value
      apiUrl: data.apiUrl ? data.apiUrl : network.apiUrl,
      explorer: data?.explorer ? data.explorer : network?.explorer || '',
      currency: data.symbol ? data.symbol : network.currency,
    } as INetwork;

    const chain = data.isSyscoinRpc
      ? INetworkType.Syscoin
      : INetworkType.Ethereum;

    store.dispatch(setNetwork({ chain, network: networkWithCustomParams }));

    //We need to do that to get the correct network value, we only can know if will have a Key value
    //inside the state after the dispatch for some network with a chainID that already exists
    const networksAfterDispatch = store.getState().vault.networks[chain];

    const findCorrectNetworkValue = Object.values(networksAfterDispatch).find(
      (netValues) =>
        netValues.chainId === networkWithCustomParams.chainId &&
        netValues.url === networkWithCustomParams.url &&
        netValues.label === networkWithCustomParams.label
    );

    keyringManager.addCustomNetwork(chain, findCorrectNetworkValue);

    return findCorrectNetworkValue;
  };
  const editCustomRpc = async (
    newRpc: ICustomRpcParams,
    oldRpc: INetwork
  ): Promise<INetwork> => {
    const changedChainId = oldRpc.chainId !== newRpc.chainId;
    const network = await getRpc(newRpc);
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
      keyringManager.updateNetworkConfig(newNetwork, chain as INetworkType);
      transactionsManager = TransactionsManager(
        keyringManager.ethereumTransaction.web3Provider
      );
      balancesManager = BalancesManager(
        keyringManager.ethereumTransaction.web3Provider
      );

      return newNetwork;
    }
    throw new Error(
      'You are trying to set a different network RPC in current network. Please, verify it and try again'
    );
  };

  const setIsLastTxConfirmed = (
    chainId: number,
    wasConfirmed: boolean,
    isFirstTime?: boolean
  ) => {
    store.dispatch(
      setIsLastTxConfirmedToState({ chainId, wasConfirmed, isFirstTime })
    );
  };

  const editAccountLabel = (
    label: string,
    accountId: number,
    accountType: KeyringAccountType
  ) => {
    keyringManager.updateAccountLabel(label, accountId, accountType);

    store.dispatch(
      setAccountsWithLabelEdited({
        label,
        accountId,
        accountType,
      })
    );
  };

  const removeKeyringNetwork = (
    chain: INetworkType,
    chainId: number,
    rpcUrl: string,
    label: string,
    key?: string
  ) => {
    store.dispatch(
      removeNetworkFromStore({ chain, chainId, rpcUrl, label, key })
    );

    keyringManager.removeNetwork(chain, chainId, rpcUrl, label, key);
  };

  //todo: we need to adjust that to use the right fn since keyring manager does not have this function anymore
  const getChangeAddress = async (accountId: number) =>
    await keyringManager.getChangeAddress(accountId);

  const getRecommendedFee = () => {
    const { isBitcoinBased, activeNetwork } = store.getState().vault;
    if (isBitcoinBased)
      return keyringManager.syscoinTransaction.getRecommendedFee(
        activeNetwork.url
      );
    //TODO: Validate this method call through contentScript
    return keyringManager.ethereumTransaction.getRecommendedGasPrice(true);
  };

  const importAccountFromPrivateKey = async (
    privKey: string,
    label?: string
  ) => {
    const { accounts } = store.getState().vault;
    //todo: this function was renamed we should update it
    const importedAccount = await keyringManager.importAccount(privKey, label);
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
    store.dispatch(
      setActiveAccount({ id: paliImp.id, type: KeyringAccountType.Imported })
    );

    return importedAccount;
  };

  const importTrezorAccount = async (
    coin: string,
    slip44: string,
    index: string
  ) => {
    const { accounts, isBitcoinBased, activeAccount, activeNetwork } =
      store.getState().vault;
    let importedAccount;
    try {
      importedAccount = await keyringManager.importTrezorAccount(
        coin,
        slip44,
        index
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
        [KeyringAccountType.Trezor]: {
          ...accounts[KeyringAccountType.Trezor],
          [paliImp.id]: paliImp,
        },
      })
    );
    keyringManager.setActiveAccount(paliImp.id, KeyringAccountType.Trezor);
    store.dispatch(
      setActiveAccount({ id: paliImp.id, type: KeyringAccountType.Trezor })
    );
    updateUserTransactionsState({
      isPolling: false,
      isBitcoinBased,
      activeAccount,
      activeNetwork,
    });
    updateAssetsFromCurrentAccount({
      activeAccount,
      activeNetwork,
      isBitcoinBased,
    });

    return importedAccount;
  };

  const importLedgerAccount = async (
    coin: string,
    slip44: string,
    index: string,
    isAlreadyConnected: boolean
  ) => {
    const { accounts, isBitcoinBased, activeNetwork } = store.getState().vault;
    let importedAccount;
    try {
      importedAccount = await keyringManager.importLedgerAccount(
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
    keyringManager.setActiveAccount(paliImp.id, KeyringAccountType.Ledger);
    store.dispatch(
      setActiveAccount({ id: paliImp.id, type: KeyringAccountType.Ledger })
    );
    updateUserTransactionsState({
      isPolling: false,
      isBitcoinBased,
      activeAccount: { id: paliImp.id, type: KeyringAccountType.Ledger },
      activeNetwork,
    });
    updateAssetsFromCurrentAccount({
      activeAccount: { id: paliImp.id, type: KeyringAccountType.Ledger },
      activeNetwork,
      isBitcoinBased,
    });

    return importedAccount;
  };

  //---- NFTS METHODS ----//

  const getUserNftsByNetwork = async (
    userAddress: string,
    chainId: number,
    rpcUrl: string
  ) => {
    if (chainId !== 57 && chainId !== 570) return [];

    const fetchedNfts = await nftsController.getUserNfts(
      userAddress,
      chainId,
      rpcUrl
    );

    return fetchedNfts;
  };

  const fetchAndUpdateNftsState = async ({
    activeNetwork,
    activeAccount,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
  }) => {
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const { currentPromise: nftsPromises, cancel } =
      cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            store.dispatch(setIsLoadingNfts(true));

            const updatedNfts = await getUserNftsByNetwork(
              currentAccount.address,
              activeNetwork.chainId,
              activeNetwork.url
            );

            console.log('updatedNfts', updatedNfts);

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

    cancellablePromises.setPromise(PromiseTargets.NFTS, {
      nftsPromises,
      cancel,
    });

    cancellablePromises.runPromise(PromiseTargets.NFTS);
  };

  //---- END NFTS METHODS ----//

  //---- SYS METHODS ----//
  const getInitialSysTransactionsForAccount = async (xpub: string) => {
    store.dispatch(setIsLoadingTxs(true));

    const initialTxsForAccount =
      await transactionsManager.sys.getInitialUserTransactionsByXpub(
        xpub,
        initialState.activeNetwork.url
      );

    store.dispatch(setIsLoadingTxs(false));

    return initialTxsForAccount;
  };
  //---- END SYS METHODS ----//

  //---- EVM METHODS ----//
  const setEvmTransactionAsCanceled = (txHash: string, chainID: number) => {
    store.dispatch(
      setTransactionStatusToCanceled({
        txHash,
        chainID,
      })
    );
  };

  const setEvmTransactionAsAccelerated = (
    oldTxHash: string,
    chainID: number,
    newTxValue: IEvmTransactionResponse
  ) => {
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
  };

  //---- END EVM METHODS ----//

  //---- METHODS FOR UPDATE BOTH TRANSACTIONS ----//
  const callUpdateTxsMethodBasedByIsBitcoinBased = (
    isBitcoinBased: boolean,
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    },
    activeNetwork: INetwork
  ) => {
    const { accounts } = store.getState().vault;
    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    switch (isBitcoinBased) {
      case true:
        //IF SYS UTX0 ONLY RETURN DEFAULT TXS FROM XPUB REQUEST

        window.controller.wallet.transactions.sys
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
          });
        break;
      case false:
        //DO SAME AS POLLING TO DEAL WITH EVM NETWORKS
        transactionsManager.utils.updateTransactionsFromCurrentAccount(
          currentAccount,
          isBitcoinBased,
          activeNetwork.url
        );

        break;

      default:
        break;
    }
  };

  const updateUserTransactionsState = ({
    isPolling,
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
    isPolling: boolean;
  }) => {
    const { accounts } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const { currentPromise: transactionPromise, cancel } =
      cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            switch (isPolling) {
              //CASE FOR POLLING AT ALL -> EVM AND SYS UTX0
              case true:
                await transactionsManager.utils
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

                break;
              //DEAL WITH NETWORK CHANGING, CHANGING ACCOUNTS ETC
              case false:
                callUpdateTxsMethodBasedByIsBitcoinBased(
                  isBitcoinBased,
                  activeAccount,
                  activeNetwork
                );
                break;
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      );

    cancellablePromises.setPromise(PromiseTargets.TRANSACTION, {
      transactionPromise,
      cancel,
    });

    cancellablePromises.runPromise(PromiseTargets.TRANSACTION);
  };

  const validatePendingEvmTransactions = async ({
    pendingTransactions,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    pendingTransactions: IEvmTransactionResponse[];
  }) => {
    //todo: we need to ajust validateAndManageUserTransactions to guarantee it will work with no bugs
    // const { accounts } = store.getState().vault;
    // const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const confirmedTx =
      await transactionsManager.utils.checkPendingTransactions(
        pendingTransactions
      );

    if (!!confirmedTx.length) {
      validateAndManageUserTransactions(confirmedTx);
    }
  };

  const sendAndSaveTransaction = (
    tx: IEvmTransactionResponse | ISysTransaction
  ) => {
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
  };

  const openDAppErrorModal = () => {
    store.dispatch(setOpenDAppErrorModal(true));
  };
  //---- END METHODS FOR UPDATE BOTH TRANSACTIONS ----//

  //------------------------- END TRANSACTIONS METHODS -------------------------//

  //------------------------- NEW ASSETS METHODS -------------------------//

  //---- SYS METHODS ----//
  const getInitialSysTokenForAccount = async (xpub: string) => {
    store.dispatch(setIsLoadingAssets(true));

    const initialSysAssetsForAccount =
      await assetsManager.sys.getSysAssetsByXpub(
        xpub,
        initialState.activeNetwork.url,
        initialState.activeNetwork.chainId
      );

    store.dispatch(setIsLoadingAssets(false));

    return initialSysAssetsForAccount;
  };
  //---- END SYS METHODS ----//

  //---- METHODS FOR UPDATE BOTH ASSETS ----//
  const updateAssetsFromCurrentAccount = ({
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
  }) => {
    const { accounts } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const { currentPromise: assetsPromise, cancel } =
      cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            const updatedAssets =
              await assetsManager.utils.updateAssetsFromCurrentAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url,
                activeNetwork.chainId,
                keyringManager.ethereumTransaction.web3Provider
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

    cancellablePromises.setPromise(PromiseTargets.ASSETS, {
      assetsPromise,
      cancel,
    });

    cancellablePromises.runPromise(PromiseTargets.ASSETS);
  };
  //---- END METHODS FOR UPDATE BOTH ASSETS ----//

  //------------------------- END ASSETS METHODS -------------------------//

  //------------------------- NEW BALANCES METHODS -------------------------//

  const updateUserNativeBalance = ({
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
  }) => {
    const { accounts } = store.getState().vault;

    const currentAccount = accounts[activeAccount.type][activeAccount.id];

    const { currentPromise: balancePromise, cancel } =
      cancellablePromises.createCancellablePromise<void>(
        async (resolve, reject) => {
          try {
            const updatedBalance =
              await balancesManager.utils.getBalanceUpdatedForAccount(
                currentAccount,
                isBitcoinBased,
                activeNetwork.url
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

    cancellablePromises.setPromise(PromiseTargets.BALANCE, {
      balancePromise,
      cancel,
    });

    cancellablePromises.runPromise(PromiseTargets.BALANCE);
  };

  //---- New method to update some infos from account like Assets, Txs etc ----//
  const getLatestUpdateForCurrentAccount = () => {
    const {
      isNetworkChanging,
      accounts,
      activeAccount,
      isBitcoinBased,
      activeNetwork,
    } = store.getState().vault;

    const activeAccountValues = accounts[activeAccount.type][activeAccount.id];

    if (isNetworkChanging || isNil(activeAccountValues.address)) {
      throw new Error('Could not update account while changing network');
    }

    Promise.all([
      //First update native balance
      updateUserNativeBalance({
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      }),
      //Later update Txs
      updateUserTransactionsState({
        isPolling: false,
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      }),
      //Later update Assets
      updateAssetsFromCurrentAccount({
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      }),
    ]);
  };

  return {
    importLedgerAccount,
    createWallet,
    forgetWallet,
    unlockFromController,
    setIsLastTxConfirmed,
    lock,
    createAccount,
    editAccountLabel,
    setAdvancedSettings,
    handleWatchAsset,
    account: walletController.account,
    setAccount,
    setAutolockTimer,
    setActiveNetwork,
    addCustomRpc,
    setIsAutolockEnabled,
    getRpc,
    getSeed,
    editCustomRpc,
    removeKeyringNetwork,
    resolveAccountConflict,
    resolveError,
    getChangeAddress,
    getRecommendedFee,
    assets: assetsManager,
    transactions: transactionsManager,
    sendAndSaveTransaction,
    setEvmTransactionAsCanceled,
    setEvmTransactionAsAccelerated,
    getAssetInfo,
    updateAssetsFromCurrentAccount,
    fetchAndUpdateNftsState,
    updateUserNativeBalance,
    updateUserTransactionsState,
    getLatestUpdateForCurrentAccount,
    importAccountFromPrivateKey,
    removeWindowEthProperty,
    addWindowEthProperty,
    setHasEthProperty,
    importTrezorAccount,
    validatePendingEvmTransactions,
    ...keyringManager,
    openDAppErrorModal,
  };
};

export default MainController;
