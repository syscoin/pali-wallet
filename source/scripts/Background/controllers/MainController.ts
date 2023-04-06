import { ethers } from 'ethers';
import { ethErrors } from 'helpers/errors';
import floor from 'lodash/floor';

import {
  KeyringManager,
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import {
  getSysRpc,
  getEthRpc,
  INetwork,
  INetworkType,
} from '@pollum-io/sysweb3-network';
import { getErc20Abi, getErc21Abi } from '@pollum-io/sysweb3-utils';

import store from 'state/store';
import {
  forgetWallet as forgetWalletState,
  setActiveAccount,
  setLastLogin,
  setTimer,
  createAccount as addAccountToStore,
  setIsPendingBalances,
  setNetworks,
  removeNetwork as removeNetworkFromStore,
  removeNetwork,
  setStoreError,
  setIsBitcoinBased,
  setChangingConnectedAccount,
  setIsNetworkChanging,
  setUpdatedTokenBalace,
  setIsTimerEnabled as setIsTimerActive,
  setAccounts,
  setNetworkChange,
} from 'state/vault';
import { IOmmitedAccount, IPaliAccount } from 'state/vault/types';
import { IMainController } from 'types/controllers';
import { ITokenEthProps } from 'types/tokens';
import { ICustomRpcParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';

import EthAccountController from './account/evm';
import SysAccountController from './account/syscoin';
import ControllerUtils from './ControllerUtils';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';
const MainController = (walletState): IMainController => {
  const keyringManager = new KeyringManager(walletState);
  const utilsController = Object.freeze(ControllerUtils());
  let currentPromise: {
    cancel: () => void;
    promise: Promise<{ chainId: string; networkVersion: number }>;
  } | null = null;

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

  const unlock = async (pwd: string): Promise<boolean> => {
    const unlocked = await keyringManager.unlock(pwd);
    if (!unlocked) throw new Error('Invalid password');
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
    // await new Promise<void>(async (resolve) => {
    //   const { activeAccount, accounts, activeAccountType } =
    //     store.getState().vault;
    //   const account = (await keyringManager.unlock(
    //     pwd
    //   )) as IKeyringAccountState;

    //   const { assets: currentAssets } =
    //     accounts[KeyringAccountType[activeAccountType]][activeAccount];

    //   const keyringAccount = omit(account, ['assets']);

    //   const mainAccount = { ...keyringAccount, assets: currentAssets };

    //   store.dispatch(setActiveAccount(mainAccount.id));
    //   resolve();

    //   store.dispatch(setLastLogin());
    //   window.controller.dapp
    //     .handleStateChange(PaliEvents.lockStateChanged, {
    //       method: PaliEvents.lockStateChanged,
    //       params: {
    //         accounts: [],
    //         isUnlocked: keyringManager.isUnlocked(),
    //       },
    //     })
    //     .catch((error) => console.error('Unlock', error));
    // });
    return unlocked;
  };

  const createWallet = async (password: string): Promise<void> => {
    store.dispatch(setIsPendingBalances(true));

    keyringManager.setWalletPassword(password);

    const account =
      (await keyringManager.createKeyringVault()) as IKeyringAccountState;

    const newAccountWithAssets: IPaliAccount = {
      ...account,
      assets: {
        syscoin: [],
        ethereum: [],
      },
      transactions: [],
    };

    store.dispatch(setIsPendingBalances(false));
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

  const createAccount = async (label?: string): Promise<IPaliAccount> => {
    const newAccount = await keyringManager.addNewAccount(label);

    const newAccountWithAssets: IPaliAccount = {
      ...newAccount,
      assets: {
        syscoin: [],
        ethereum: [],
      },
      transactions: [],
    };

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
    if (currentPromise) {
      currentPromise.cancel();
    }

    const promiseWrapper = createCancellablePromise<{
      chainId: string;
      networkVersion: number;
    }>((resolve, reject) => {
      setActiveNetworkLogic(network, chain, resolve, reject);
    });

    currentPromise = promiseWrapper;
    return promiseWrapper.promise;
  };

  const setActiveNetworkLogic = async (
    network: INetwork,
    chain: string,
    resolve: (value: { chainId: string; networkVersion: number }) => void,
    reject: (reason?: any) => void
  ) => {
    store.dispatch(setIsNetworkChanging(true));
    store.dispatch(setIsPendingBalances(true));

    const { activeNetwork } = store.getState().vault;

    const isBitcoinBased = chain === INetworkType.Syscoin;

    store.dispatch(setIsBitcoinBased(isBitcoinBased));

    const { sucess, wallet, activeChain } =
      await keyringManager.setSignerNetwork(network, chain);
    if (sucess) {
      store.dispatch(
        setNetworkChange({
          activeChain,
          wallet,
        })
      );
      const chainId = network.chainId.toString(16);
      const networkVersion = network.chainId;
      store.dispatch(setIsPendingBalances(false));
      await utilsController.setFiat();

      resolve({ chainId: chainId, networkVersion: networkVersion });
      window.controller.dapp.handleStateChange(PaliEvents.chainChanged, {
        method: PaliEvents.chainChanged,
        params: {
          chainId: `0x${network.chainId.toString(16)}`,
          networkVersion: network.chainId,
        },
      });
      store.dispatch(setIsNetworkChanging(false)); // TODO: remove this , just provisory
      return;
    } else {
      console.error(
        'Pali: fail on setActiveNetwork - keyringManager.setSignerNetwork'
      );
      reject(
        'Pali: fail on setActiveNetwork - keyringManager.setSignerNetwork'
      );
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

      store.dispatch(setStoreError(true));
      store.dispatch(setIsNetworkChanging(false));
      store.dispatch(setIsPendingBalances(false));
    }
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
        : await getEthRpc(data);

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

  const addCustomRpc = async (data: ICustomRpcParams): Promise<INetwork> => {
    const network = await getRpc(data);

    const chain = data.isSyscoinRpc ? 'syscoin' : 'ethereum';

    store.dispatch(setNetworks({ chain, network, isEdit: false }));

    return network;
  };

  const editCustomRpc = async (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ): Promise<INetwork> => {
    const changedChainId = oldRpc.chainId !== newRpc.chainId;
    const network = await getRpc(newRpc);
    const newNetwork = { ...network, label: newRpc.label };

    const chain = newRpc.isSyscoinRpc ? 'syscoin' : 'ethereum';

    if (changedChainId) {
      store.dispatch(
        removeNetwork({
          chainId: oldRpc.chainId,
          prefix: chain,
        })
      );
    }
    store.dispatch(setNetworks({ chain, network: newNetwork, isEdit: true }));

    return newNetwork;
  };

  const removeKeyringNetwork = (
    chain: INetworkType,
    chainId: number,
    key?: string
  ) => {
    //todo: we need to adjust that to use the right fn since keyring manager does not have this function anymore
    keyringManager.removeNetwork(chain, chainId);

    store.dispatch(removeNetworkFromStore({ prefix: chain, chainId, key }));
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

  //TODO: Review this function it seems the accountId and accountType being passed are always activeAccount values from vault
  //It seems a bit unnecessary to pass them as params
  const updateErcTokenBalances = async (
    accountId: number,
    accountType: KeyringAccountType,
    tokenAddress: string,
    tokenChain: number,
    isNft: boolean,
    decimals?: number
  ) => {
    const { activeNetwork, accounts, activeAccount, isNetworkChanging } =
      store.getState().vault;
    const findAccount = accounts[activeAccount.type][activeAccount.id];

    if (
      !Boolean(
        findAccount.address ===
          accounts[activeAccount.type][activeAccount.id].address
      )
    )
      return;

    const provider = new ethers.providers.JsonRpcProvider(activeNetwork.url);

    const _contract = new ethers.Contract(
      tokenAddress,
      isNft ? getErc21Abi() : getErc20Abi(),
      provider
    );

    const balanceMethodCall = await _contract.balanceOf(findAccount.address);

    const balance = !isNft
      ? `${balanceMethodCall / 10 ** Number(decimals)}`
      : Number(balanceMethodCall);

    const formattedBalance = !isNft
      ? floor(parseFloat(balance as string), 4)
      : balance;

    const newAccountsAssets = accounts[accountType][
      accountId
    ].assets.ethereum.map((vaultAssets: ITokenEthProps) => {
      if (
        Number(vaultAssets.chainId) === tokenChain &&
        vaultAssets.contractAddress === tokenAddress
      ) {
        return { ...vaultAssets, balance: formattedBalance };
      }

      return vaultAssets;
    });

    if (!isNetworkChanging) {
      store.dispatch(
        setUpdatedTokenBalace({
          accountId: findAccount.id,
          accountType: activeAccount.type,
          newAccountsAssets,
        })
      );
    }
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
      transactions: [],
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

  return {
    createWallet,
    forgetWallet,
    unlock, //todo we need to adjust unlock type
    lock,
    createAccount,
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
    updateErcTokenBalances,
    importAccountFromPrivateKey,
    ...keyringManager,
  };
};

export default MainController;
