import { KeyringManager } from '@pollum-io/sysweb3-keyring';
import {
  getSymbolByChain,
  IKeyringAccountState,
  INetwork,
} from '@pollum-io/sysweb3-utils';

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
  setActiveToken,
  removeNetwork,
} from 'state/vault';
import { ICustomRpcParams } from 'types/transactions';

import WalletController from './account';
import { validateEthRpc, validateSysRpc } from './utils';

const MainController = () => {
  const keyringManager = KeyringManager();
  const walletController = WalletController();

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

  const setActiveNetwork = async (
    chain: string,
    chainId: number,
    key?: string | number
  ) => {
    store.dispatch(setIsPendingBalances(true));

    const { networks, activeAccount } = store.getState().vault;

    if (key) {
      const network = networks[chain][key];
      store.dispatch(setNetwork(network));

      const account = (await keyringManager.setSignerNetwork(
        network,
        chain
      )) as IKeyringAccountState;

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

      if (account.id === 0)
        keyringManager.setAccountIndexForDerivedAccount(activeAccount.id);

      store.dispatch(setIsPendingBalances(false));
      store.dispatch(setActiveAccount(account));

      return account;
    }

    const network = networks[chain][chainId];

    store.dispatch(setNetwork(network));

    const networkAccount = await keyringManager.setSignerNetwork(
      network,
      chain
    );

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

    if (networkAccount.id === 0)
      keyringManager.setAccountIndexForDerivedAccount(activeAccount.id);

    store.dispatch(setIsPendingBalances(false));
    // @ts-ignore
    store.dispatch(setActiveAccount(networkAccount));

    return networkAccount;
  };

  const validateAndBuildRpc = async ({
    chainId,
    label,
    rpcUrl,
    isSyscoinRpc,
    tokenContractAddress,
  }: ICustomRpcParams): Promise<INetwork> => {
    const { valid, data: _data } = isSyscoinRpc
      ? await validateSysRpc(rpcUrl)
      : await validateEthRpc(chainId, rpcUrl, tokenContractAddress);

    if (!valid)
      throw new Error('Invalid chainID, please verify the current RPC URL!');

    return {
      ..._data,
      label,
    };
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

  const setActiveTokenForWallet = async () => {
    const { networks, activeNetwork } = store.getState().vault;

    const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);

    const chain = isSyscoinChain ? 'syscoin' : 'ethereum';
    const symbol = await getSymbolByChain(chain);

    store.dispatch(setActiveToken(String(symbol) || ''));
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
    setActiveTokenForWallet,
    ...keyringManager,
  };
};

export default MainController;
