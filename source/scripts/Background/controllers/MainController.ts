if (process.env.NODE_ENV === 'test') {
  chrome.runtime.id = 'testid';
}

import {
  KeyringManager,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import {
  web3Provider,
  validateSysRpc,
  validateEthRpc,
} from '@pollum-io/sysweb3-network';
import { INetwork } from '@pollum-io/sysweb3-utils';

import store from 'state/store';
import {
  forgetWallet as forgetWalletState,
  setActiveAccount,
  setEncryptedMnemonic,
  setLastLogin,
  setTimer,
  createAccount as addAccountToStore,
  setActiveNetwork as setNetwork,
  setIsPendingBalances,
  setNetworks,
  removeNetwork as removeNetworkFromStore,
  removeNetwork,
  setStoreError,
  setIsBitcoinBased,
} from 'state/vault';
import { IMainController } from 'types/controllers';
import { ICustomRpcParams } from 'types/transactions';
import { removeXprv } from 'utils/account';
import { isBitcoinBasedNetwork, networkChain } from 'utils/network';

import WalletController from './account';
import DAppController from './DAppController';
import { DAppEvents } from './message-handler/types';

const MainController = (): IMainController => {
  const keyringManager = KeyringManager();
  const walletController = WalletController(keyringManager);

  const setAutolockTimer = (minutes: number) => {
    store.dispatch(setTimer(minutes));
  };

  const getNetworkData = async () => {
    const networkVersion = await web3Provider.send('net_version', []);
    const chainId = await web3Provider.send('eth_chainId', []);

    return { chainId: String(chainId), networkVersion: String(networkVersion) };
  };

  /** forget your wallet created with pali and associated with your seed phrase,
   *  but don't delete seed phrase so it is possible to create a new
   *  account using the same seed
   */
  const forgetWallet = (pwd: string) => {
    keyringManager.forgetMainWallet(pwd);

    store.dispatch(forgetWalletState());
  };

  const unlock = async (pwd: string): Promise<void> => {
    if (!keyringManager.checkPassword(pwd)) throw new Error('Invalid password');
    const { activeAccount } = store.getState().vault;
    const account = (await keyringManager.login(pwd)) as IKeyringAccountState;
    const { assets: currentAssets } = activeAccount;

    const keyringAccount = account;

    const mainAccount = { ...keyringAccount, assets: currentAssets };

    store.dispatch(setLastLogin());
    store.dispatch(setActiveAccount(mainAccount));
  };

  // todo: add import wallet test
  const createWallet = async (password: string): Promise<any> => {
    store.dispatch(setIsPendingBalances(true));

    keyringManager.setWalletPassword(password);

    const account = await keyringManager.createKeyringVault();

    if (!account || !account.address)
      throw new Error('Could not create wallet.');

    const newAccountWithAssets = {
      ...account,
      assets: {
        syscoin: account.assets,
        ethereum: [],
      },
    };

    store.dispatch(addAccountToStore(newAccountWithAssets));
    store.dispatch(setEncryptedMnemonic(keyringManager.getEncryptedMnemonic()));
    store.dispatch(setIsPendingBalances(false));
    store.dispatch(setActiveAccount(newAccountWithAssets));
    store.dispatch(setLastLogin());

    return newAccountWithAssets;
  };

  const lock = () => {
    keyringManager.logout();

    store.dispatch(setLastLogin());
  };

  const createAccount = async (
    label?: string
  ): Promise<IKeyringAccountState> => {
    const newAccount = await walletController.addAccount(label);

    const newAccountWithAssets = {
      ...newAccount,
      assets: {
        syscoin: newAccount.assets,
        ethereum: [],
      },
    };

    store.dispatch(addAccountToStore(newAccountWithAssets));
    store.dispatch(setActiveAccount(newAccountWithAssets));

    DAppController().dispatchEvent(
      DAppEvents.accountsChanged,
      removeXprv(newAccount)
    );

    return newAccountWithAssets;
  };

  const setAccount = (id: number): void => {
    const { accounts } = store.getState().vault;

    keyringManager.setActiveAccount(id);
    store.dispatch(setActiveAccount(accounts[id]));

    DAppController().dispatchEvent(
      DAppEvents.accountsChanged,
      removeXprv(accounts[id])
    );
  };

  const setActiveNetwork = async (network: INetwork, chain: string) => {
    try {
      if (!network) throw new Error('Missing required network info.');

      if (chain === 'ethereum') {
        await validateEthRpc(network.url);
      }

      store.dispatch(setIsPendingBalances(true));

      const { activeAccount } = store.getState().vault;

      const isBitcoinBased =
        chain === 'syscoin' && (await isBitcoinBasedNetwork(network));

      store.dispatch(setIsBitcoinBased(isBitcoinBased));

      const networkAccount = await keyringManager.setSignerNetwork(
        network,
        chain
      );

      const { assets } = activeAccount;

      const generalAssets = isBitcoinBased
        ? {
            ethereum: activeAccount.assets?.ethereum,
            syscoin: networkAccount.assets,
          }
        : assets;

      const account = { ...networkAccount, assets: generalAssets };

      store.dispatch(setNetwork(network));

      store.dispatch(setIsPendingBalances(false));
      store.dispatch(setActiveAccount(account));

      walletController.account.sys.getLatestUpdate(true);

      const chainId = await web3Provider.send('eth_chainId', []);
      const networkVersion = await web3Provider.send('net_version', []);

      // todo: test dispatch event
      DAppController().dispatchEvent(DAppEvents.chainChanged, {
        chainId,
        networkVersion,
      });

      return { chainId, networkVersion };
    } catch (error) {
      store.dispatch(setStoreError(true));
      const statusCodeInError = ['401', '429', '500'];

      const errorMessageValidate = statusCodeInError.some((message) =>
        error.message.includes(message)
      );

      const { activeAccount, activeNetwork, isBitcoinBased } =
        store.getState().vault;

      if (errorMessageValidate) {
        const networkAccount = await keyringManager.setSignerNetwork(
          activeNetwork,
          networkChain()
        );

        const { assets } = activeAccount;

        const generalAssets = isBitcoinBased
          ? {
              ethereum: activeAccount.assets?.ethereum,
              syscoin: networkAccount.assets,
            }
          : assets;

        const account = { ...networkAccount, assets: generalAssets };

        store.dispatch(setNetwork(activeNetwork));
        store.dispatch(setIsPendingBalances(false));
        store.dispatch(setActiveAccount(account));
      }

      throw new Error(error);
    }
  };

  const resolveError = () => store.dispatch(setStoreError(false));

  const addCustomRpc = async ({
    isSyscoinRpc,
    ...data
  }: ICustomRpcParams): Promise<INetwork> => {
    const chain = isSyscoinRpc ? 'syscoin' : 'ethereum';

    const newNetwork = {
      ...data,
      default: false,
      currency: isSyscoinRpc ? 'SYS' : 'ETH',
      explorer: data.url,
    };

    const validate = isSyscoinRpc ? validateSysRpc : validateEthRpc;

    await validate(data.url);

    store.dispatch(setNetworks({ chain, network: newNetwork }));

    return newNetwork;
  };

  const editCustomRpc = async (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ): Promise<INetwork> => {
    const chain = newRpc.isSyscoinRpc ? 'syscoin' : 'ethereum';

    try {
      if (newRpc.isSyscoinRpc) {
        await validateSysRpc(newRpc.url);
      }

      await validateEthRpc(newRpc.url);

      if (oldRpc.chainId !== newRpc.chainId) {
        store.dispatch(
          removeNetwork({
            chainId: oldRpc.chainId,
            prefix: chain,
          })
        );

        return await addCustomRpc(newRpc);
      }

      delete newRpc.isSyscoinRpc;

      const { networks } = store.getState().vault;

      const existentRpc = networks[chain][Number(newRpc.chainId)];

      if (existentRpc) {
        const edited = {
          ...existentRpc,
          ...newRpc,
        };

        store.dispatch(setNetwork(edited));

        return edited;
      }

      store.dispatch(setNetworks({ chain, network: newRpc }));

      return newRpc;
    } catch (error) {
      throw new Error('RPC URL is not valid for this Chain ID.');
    }
  };

  const removeKeyringNetwork = (chain: string, chainId: number) => {
    keyringManager.removeNetwork(chain, chainId);

    store.dispatch(removeNetworkFromStore({ prefix: chain, chainId }));
  };

  const getRecommendedFee = () => {
    const { isBitcoinBased, activeNetwork } = store.getState().vault;

    const { tx } = isBitcoinBased
      ? walletController.account.sys
      : walletController.account.eth;

    if (isBitcoinBased) {
      return Number(tx.getRecommendedFee(activeNetwork.url)) || 0;
    }

    return Number(tx.getRecommendedGasPrice(true).gwei) || 0;
  };

  return {
    createWallet,
    forgetWallet,
    unlock,
    lock,
    createAccount,
    account: walletController.account,
    setAccount,
    setAutolockTimer,
    setActiveNetwork,
    addCustomRpc,
    editCustomRpc,
    removeKeyringNetwork,
    resolveError,
    getRecommendedFee,
    getNetworkData,
    ...keyringManager,
  };
};

export default MainController;
