if (process.env.NODE_ENV === 'test') {
  chrome.runtime.id = 'testid';
}

import { browser } from 'webextension-polyfill-ts';

import {
  KeyringManager,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import {
  getSysRpc,
  getEthRpc,
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
  setActiveAccountProperty,
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

    console.log({ password });
    keyringManager.setWalletPassword(password);

    console.log({ password2: password });
    const account =
      (await keyringManager.createKeyringVault()) as IKeyringAccountState;

    console.log({ account });
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

    window.controller.dapp.dispatchEvent(
      DAppEvents.accountsChanged,
      removeXprv(newAccount)
    );

    return newAccountWithAssets;
  };

  const setAccount = (id: number): void => {
    const { accounts } = store.getState().vault;

    keyringManager.setActiveAccount(id);
    store.dispatch(setActiveAccount(accounts[id]));

    window.controller.dapp.dispatchEvent(
      DAppEvents.accountsChanged,
      removeXprv(accounts[id])
    );
  };

  const setActiveNetwork = async (network: INetwork, chain: string) => {
    store.dispatch(setIsPendingBalances(true));

    const { activeNetwork, activeAccount } = store.getState().vault;

    const isBitcoinBased =
      chain === 'syscoin' && (await isBitcoinBasedNetwork(network));

    store.dispatch(setIsBitcoinBased(isBitcoinBased));

    try {
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

      if (isBitcoinBased) {
        store.dispatch(
          setActiveAccountProperty({
            property: 'xpub',
            value: keyringManager.getAccountXpub(),
          })
        );

        store.dispatch(
          setActiveAccountProperty({
            property: 'xprv',
            value: keyringManager.getEncryptedXprv(),
          })
        );

        walletController.account.sys.setAddress();
      }

      walletController.account.sys.getLatestUpdate(true);

      const chainId = await web3Provider.send('eth_chainId', []);
      const networkVersion = await web3Provider.send('net_version', []);

      window.controller.dapp.dispatchEvent(DAppEvents.chainChanged, {
        chainId,
        networkVersion,
      });

      const tabs = await browser.tabs.query({
        windowType: 'normal',
      });

      for (const tab of tabs) {
        browser.tabs.sendMessage(Number(tab.id), {
          type: 'CHAIN_CHANGED',
          data: { networkVersion, chainId },
        });
      }

      return { chainId, networkVersion };
    } catch (error) {
      const statusCodeInError = ['401', '429', '500'];

      const errorMessageValidate = statusCodeInError.some((message) =>
        error.message.includes(message)
      );

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

      store.dispatch(setStoreError(true));
    }
  };

  const resolveError = () => store.dispatch(setStoreError(false));

  const getRpc = async (data: ICustomRpcParams): Promise<INetwork> => {
    const response = data.isSyscoinRpc
      ? await getSysRpc(data)
      : await getEthRpc(data);

    return response.formattedNetwork;
  };

  const addCustomRpc = async (data: ICustomRpcParams): Promise<INetwork> => {
    const network = await getRpc(data);

    const chain = data.isSyscoinRpc ? 'syscoin' : 'ethereum';

    delete data.isSyscoinRpc;

    const newNetwork = {
      ...network,
      ...data,
    };

    store.dispatch(setNetworks({ chain, network: newNetwork }));

    return newNetwork;
  };

  const editCustomRpc = async (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ): Promise<INetwork> => {
    const chain = newRpc.isSyscoinRpc ? 'syscoin' : 'ethereum';
    const { chainId } = await getRpc(newRpc);

    if (chainId !== newRpc.chainId)
      throw new Error('RPC invalid. Endpoint returned a different Chain ID.');

    try {
      newRpc.isSyscoinRpc
        ? await validateSysRpc(newRpc.url)
        : await validateEthRpc(newRpc.url);

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

    const fee = isBitcoinBased
      ? tx.getRecommendedFee(activeNetwork.url)
      : tx.getRecommendedGasPrice(true).gwei;

    return fee && fee > 1 ? fee : 0;
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
    getRpc,
    ...keyringManager,
  };
};

export default MainController;
