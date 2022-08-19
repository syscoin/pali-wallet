import {
  KeyringManager,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';
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
} from 'state/vault';
import { IMainController } from 'types/controllers';
import { ICustomRpcParams } from 'types/transactions';

import WalletController from './account';

const MainController = (): IMainController => {
  const keyringManager = KeyringManager();
  const walletController = WalletController(keyringManager);

  const setAutolockTimer = (minutes: number) => {
    store.dispatch(setTimer(minutes));
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

    const account = (await keyringManager.login(pwd)) as IKeyringAccountState;

    store.dispatch(setLastLogin());
    store.dispatch(setActiveAccount(account));
  };

  const createWallet = async (): Promise<IKeyringAccountState> => {
    const account =
      (await keyringManager.createKeyringVault()) as IKeyringAccountState;

    store.dispatch(addAccountToStore(account));
    store.dispatch(setEncryptedMnemonic(keyringManager.getEncryptedMnemonic()));
    store.dispatch(setActiveAccount(account));
    store.dispatch(setLastLogin());

    return account;
  };

  const lock = () => {
    keyringManager.logout();

    store.dispatch(setLastLogin());
  };

  const createAccount = async (
    label?: string
  ): Promise<IKeyringAccountState> => {
    const newAccount = await walletController.addAccount(label);

    store.dispatch(addAccountToStore(newAccount));
    store.dispatch(setActiveAccount(newAccount));

    return newAccount;
  };

  const setAccount = (id: number): void => {
    const { accounts } = store.getState().vault;

    keyringManager.setActiveAccount(id);
    store.dispatch(setActiveAccount(accounts[id]));

    walletController.account.sys.getLatestUpdate(false);
  };

  const setActiveNetwork = async (network: INetwork) => {
    store.dispatch(setIsPendingBalances(true));

    const { networks, activeNetwork } = store.getState().vault;

    const isSyscoinChain =
      networks.syscoin[network.chainId] && network.url.includes('blockbook');

    const chain = isSyscoinChain ? 'syscoin' : 'ethereum';

    try {
      const networkAccount = await keyringManager.setSignerNetwork(
        network,
        chain
      );

      store.dispatch(setNetwork(network));
      store.dispatch(setIsPendingBalances(false));
      store.dispatch(setActiveAccount(networkAccount));

      if (isSyscoinChain) {
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

      return networkAccount;
    } catch (error) {
      setActiveNetwork(activeNetwork);

      store.dispatch(setStoreError(true));
    }
  };

  const resolveError = () => store.dispatch(setStoreError(false));

  const validateAndBuildRpc = async ({
    label,
    url,
    isSyscoinRpc,
  }: ICustomRpcParams): Promise<INetwork> => {
    const { valid } = isSyscoinRpc
      ? await validateSysRpc(url)
      : await validateEthRpc(url);

    if (!valid)
      throw new Error('Invalid chainID. Please, verify the current RPC URL.');

    return { label } as INetwork;
  };

  const addCustomRpc = async (data: ICustomRpcParams): Promise<INetwork> => {
    const network = await validateAndBuildRpc(data);

    const chain = data.isSyscoinRpc ? 'syscoin' : 'ethereum';

    store.dispatch(setNetworks({ chain, network, chainId: network.chainId }));

    return network;
  };

  const editCustomRpc = async (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ): Promise<INetwork> => {
    const changedChainId = oldRpc.chainId !== newRpc.chainId;
    const network = await validateAndBuildRpc(newRpc);

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
    ...keyringManager,
  };
};

export default MainController;
