if (process.env.NODE_ENV === 'test') {
  chrome.runtime.id = 'testid';
}

import { chains } from 'eth-chains';
import { ethErrors } from 'helpers/errors';

import {
  KeyringManager,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import {
  web3Provider,
  setActiveNetwork as _sysweb3SetActiveNetwork,
  validateSysRpc,
  validateEthRpc,
  getBip44Chain,
  // coins,
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
  setChangingConnectedAccount,
  setIsNetworkChanging,
  setActiveAccountProperty,
} from 'state/vault';
import { IOmmitedAccount } from 'state/vault/types';
import { IMainController } from 'types/controllers';
import { IRpcParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';
import { isBitcoinBasedNetwork, networkChain } from 'utils/network';

import WalletController from './account';
import { PaliEvents } from './message-handler/types';

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
  };

  const unlock = async (pwd: string): Promise<void> => {
    if (!keyringManager.checkPassword(pwd)) throw new Error('Invalid password');
    await new Promise<void>(async (resolve) => {
      const { activeAccount } = store.getState().vault;
      const account = (await keyringManager.login(pwd)) as IKeyringAccountState;
      resolve();
      const { assets: currentAssets } = activeAccount;
      //TODO: find better implementation;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
      const { assets, ...keyringAccount } = account;

      const mainAccount = { ...keyringAccount, assets: currentAssets };

      store.dispatch(setLastLogin());
      store.dispatch(setActiveAccount(mainAccount));
      window.controller.dapp
        .handleStateChange(PaliEvents.lockStateChanged, {
          method: PaliEvents.lockStateChanged,
          params: {
            accounts: [],
            isUnlocked: keyringManager.isUnlocked(),
          },
        })
        .then(() => console.log('Successfully update all Dapps Unlock'))
        .catch((error) => console.error('Unlock', error));
    });

    return;
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
    window.controller.dapp
      .handleStateChange(PaliEvents.lockStateChanged, {
        method: PaliEvents.lockStateChanged,
        params: {
          accounts: [],
          isUnlocked: keyringManager.isUnlocked(),
        },
      })
      .then(() => console.log('Successfully update all Dapps'))
      .catch((error) => console.error(error));
    return;
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
    const { accounts, activeAccount } = store.getState().vault;
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
        return;
      }
    }

    keyringManager.setActiveAccount(id);
    store.dispatch(setActiveAccount(accounts[id]));
    // if (isBitcoinBased) {
    //   window.controller.dapp.dispatchEvent(
    //     DAppEvents.accountsChanged,
    //     removeXprv(accounts[id])
    //   );
    // } // TODO: check if this is relevant in any form to syscoin events
  };

  const setActiveNetwork = async (network: INetwork, chain: string) => {
    store.dispatch(setIsNetworkChanging(true));
    store.dispatch(setIsPendingBalances(true));

    store.dispatch(setIsPendingBalances(true));

    const { activeAccount, activeNetwork } = store.getState().vault;

    const isBitcoinBased =
      chain === 'syscoin' && (await isBitcoinBasedNetwork(network));

    store.dispatch(setIsBitcoinBased(isBitcoinBased));

    return new Promise<{ chainId: string; networkVersion: number }>(
      async (resolve, reject) => {
        try {
          if (!network) throw new Error('Missing required network info.');

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

          await walletController.account.sys.getLatestUpdate(true);

          const chainId = network.chainId.toString(16);
          const networkVersion = network.chainId;

          store.dispatch(setNetwork(network));
          store.dispatch(setIsPendingBalances(false));
          store.dispatch(setActiveAccount(account));
          resolve({ chainId: chainId, networkVersion: networkVersion });
          window.controller.dapp.handleStateChange(PaliEvents.chainChanged, {
            method: PaliEvents.chainChanged,
            params: {
              chainId: `0x${network.chainId.toString(16)}`,
              networkVersion: network.chainId,
            },
          });
          return;
        } catch (error) {
          console.error(
            'Pali: fail on setActiveNetwork due to the following reason',
            error
          );
          reject();
          const statusCodeInError = ['401', '429', '500'];

          const errorMessageValidate = statusCodeInError.some((message) =>
            error.message.includes(message)
          );

          if (errorMessageValidate) {
            const networkAccount = await keyringManager.setSignerNetwork(
              activeNetwork,
              networkChain()
            );
            window.controller.dapp.handleStateChange(PaliEvents.chainChanged, {
              method: PaliEvents.chainChanged,
              params: {
                chainId: `0x${activeNetwork.chainId.toString(16)}`,
                networkVersion: activeNetwork.chainId,
              },
            });

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
          store.dispatch(setIsNetworkChanging(false));
        }
      }
    );
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

  const getCustomUtxoRpc = async ({
    chainId,
    explorerUrl,
    url,
    label,
  }: IRpcParams) => {
    try {
      const { coin, chain } = await validateSysRpc(url);

      const {
        nativeCurrency: { symbol },
      } = getBip44Chain(coin, chain === 'test');

      //* needs sysweb3 updates
      // const rpcByCoins = coins.filter((data: any) => data.name === name);

      // const slip44ByCoins = rpcByCoins && rpcByCoins[0] && rpcByCoins[0].slip44;

      const formatted = {
        explorer: explorerUrl ?? url,
        default: false,
        currency: symbol,
        chainId: chainId,
        url,
        label,
      };

      return formatted;
    } catch (error) {
      throw cleanErrorStack(ethErrors.rpc.internal());
    }
  };

  const getCustomWeb3Rpc = async ({
    chainId,
    explorerUrl,
    url,
    label,
  }: IRpcParams) => {
    try {
      const detailsByChains = chains.getById(chainId);

      const explorerByChains =
        detailsByChains.explorers && detailsByChains.explorers[0].url;

      const explorer = explorerUrl ?? explorerByChains;

      const formatted = {
        explorer: explorerUrl ?? explorer,
        default: false,
        currency: detailsByChains.nativeCurrency.symbol,
        chainId,
        url,
        label,
      };

      return formatted;
    } catch (error) {
      throw cleanErrorStack(ethErrors.rpc.internal());
    }
  };

  const addCustomRpc = async (
    chain: string,
    data: IRpcParams
  ): Promise<INetwork> => {
    const method = chain === 'syscoin' ? getCustomUtxoRpc : getCustomWeb3Rpc;

    const formatted = await method(data);

    const { networks } = store.getState().vault;

    if (networks[chain][data.chainId] === formatted)
      throw new Error(
        'RPC already exists. Try with a new one or go to Manage Networks to edit this one.'
      );

    store.dispatch(setNetworks({ chain, network: formatted }));

    return formatted;
  };

  const editCustomRpc = async (
    chain: string,
    data: IRpcParams
  ): Promise<INetwork> => {
    try {
      const validate = chain === 'syscoin' ? validateSysRpc : validateEthRpc;

      await validate(data.url);

      const { networks } = store.getState().vault;

      const existentNetwork = networks[chain][data.chainId];
      const isAddMode =
        existentNetwork && existentNetwork.chainId !== data.chainId;

      //* remove the existent network and replace for the new rpc
      if (isAddMode) {
        store.dispatch(
          removeNetwork({
            chainId: existentNetwork.chainId,
            prefix: chain,
          })
        );

        return await addCustomRpc(chain, data);
      }

      const edited = existentNetwork ? { ...existentNetwork, ...data } : data;

      store.dispatch(setNetworks({ chain, network: edited }));

      return edited;
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
    getCustomWeb3Rpc,
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
