import { ethErrors } from 'helpers/errors';
import { browser } from 'webextension-polyfill-ts';

import {
  KeyringManager,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import {
  getSysRpc,
  getEthRpc,
  web3Provider,
  setActiveNetwork as _sysweb3SetActiveNetwork,
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
  setChangingConnectedAccount,
} from 'state/vault';
import { IOmmitedAccount } from 'state/vault/types';
import { IMainController } from 'types/controllers';
import { ICustomRpcParams } from 'types/transactions';
import { removeXprv } from 'utils/account';
import cleanErrorStack from 'utils/cleanErrorStack';
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
    const { activeNetwork } = store.getState().vault;
    if (web3Provider.connection.url !== activeNetwork.url)
      _sysweb3SetActiveNetwork(activeNetwork);
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
    store.dispatch(setLastLogin());
  };

  const unlock = async (pwd: string): Promise<void> => {
    if (!keyringManager.checkPassword(pwd)) throw new Error('Invalid password');
    const { activeAccount } = store.getState().vault;
    const account = (await keyringManager.login(pwd)) as IKeyringAccountState;
    const { assets: currentAssets } = activeAccount;

    const { assets, ...keyringAccount } = account;

    const mainAccount = { ...keyringAccount, assets: currentAssets };

    store.dispatch(setLastLogin());
    store.dispatch(setActiveAccount(mainAccount));
    window.controller.dapp.dispatchEvent(DAppEvents.accountsChanged, {
      lockState: '2',
    });
  };

  const createWallet = async (password: string): Promise<void> => {
    store.dispatch(setIsPendingBalances(true));

    keyringManager.setWalletPassword(password);

    const account =
      (await keyringManager.createKeyringVault()) as IKeyringAccountState;

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
  };

  const lock = () => {
    keyringManager.logout();

    store.dispatch(setLastLogin());
    window.controller.dapp.dispatchEvent(DAppEvents.accountsChanged, {
      lockState: '1',
    });
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

    return newAccountWithAssets;
  };

  const setAccount = (
    id: number,
    host?: string,
    connectedAccount?: IOmmitedAccount
  ): void => {
    const { accounts, activeAccount, isBitcoinBased } = store.getState().vault;
    if (
      connectedAccount &&
      connectedAccount.address === activeAccount.address
    ) {
      if (connectedAccount.address !== accounts[id].address) {
        store.dispatch(
          setChangingConnectedAccount({
            host,
            isChangingConnectedAccount: true,
            newConnectedAccount: accounts[id],
          })
        );
      }
    }

    keyringManager.setActiveAccount(id);
    store.dispatch(setActiveAccount(accounts[id]));
    if (isBitcoinBased) {
      window.controller.dapp.dispatchEvent(
        DAppEvents.accountsChanged,
        removeXprv(accounts[id])
      );
    }
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

      const chainId = network.chainId.toString(16);
      const networkVersion = network.chainId;
      window.controller.dapp.dispatchEvent(DAppEvents.chainChanged, chainId);

      const tabs = await browser.tabs.query({
        windowType: 'normal',
      });

      for (const tab of tabs) {
        browser.tabs.sendMessage(Number(tab.id), {
          type: 'CHAIN_CHANGED',
          data: { networkVersion, chainId },
        });
      }

      store.dispatch(setNetwork(network));
      store.dispatch(setIsPendingBalances(false));
      store.dispatch(setActiveAccount(account));

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
  const resolveAccountConflict = () => {
    store.dispatch(
      setChangingConnectedAccount({
        newConnectedAccount: undefined,
        host: undefined,
        isChangingConnectedAccount: false,
      })
    );
  };

  const getRpc = async (data: ICustomRpcParams): Promise<INetwork> => {
    try {
      const { formattedNetwork } = data.isSyscoinRpc
        ? await getSysRpc(data)
        : await getEthRpc(data);
      console.log('Response', formattedNetwork);
      return formattedNetwork;
    } catch (error) {
      throw cleanErrorStack(ethErrors.rpc.internal(error.error.data));
    }
  };

  const addCustomRpc = async (data: ICustomRpcParams): Promise<INetwork> => {
    const network = await getRpc(data);

    const chain = data.isSyscoinRpc ? 'syscoin' : 'ethereum';

    store.dispatch(setNetworks({ chain, network }));

    return network;
  };

  const editCustomRpc = async (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ): Promise<INetwork> => {
    const changedChainId = oldRpc.chainId !== newRpc.chainId;
    const network = await getRpc(newRpc);

    const chain = newRpc.isSyscoinRpc ? 'syscoin' : 'ethereum';

    if (changedChainId) {
      store.dispatch(
        removeNetwork({
          chainId: oldRpc.chainId,
          prefix: chain,
        })
      );
    }
    store.dispatch(setNetworks({ chain, network }));

    return network;
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

    if (isBitcoinBased) return tx.getRecommendedFee(activeNetwork.url);

    return tx.getRecommendedGasPrice(true).gwei;
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
    getRpc,
    editCustomRpc,
    removeKeyringNetwork,
    resolveAccountConflict,
    resolveError,
    getRecommendedFee,
    getNetworkData,
    ...keyringManager,
  };
};

export default MainController;
