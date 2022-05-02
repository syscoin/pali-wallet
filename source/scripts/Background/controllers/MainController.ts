import { KeyringManager } from '@pollum-io/sysweb3-keyring';
import { IKeyringAccountState, INetwork } from '@pollum-io/sysweb3-utils';
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
} from 'state/vault';
import { CustomRpcParams } from 'types/transactions';

import WalletController from './account';
import { validateEthRpc, validateSysRpc } from './utils';

const MainController = () => {
  const keyringManager = KeyringManager();

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

  const { account, addAccount } = WalletController();

  const lock = () => {
    keyringManager.logout();

    store.dispatch(setLastLogin());
  };

  const createAccount = async (
    label?: string
  ): Promise<IKeyringAccountState> => {
    const newAccount = await addAccount(label);

    store.dispatch(addAccountToStore(newAccount));
    store.dispatch(setActiveAccount(newAccount));

    return newAccount;
  };

  const setAccount = (id: number): void => {
    const { accounts } = store.getState().vault;

    keyringManager.setActiveAccount(id);
    store.dispatch(setActiveAccount(accounts[id]));

    account.sys.getLatestUpdate(false);
  };

  const setAccountDefaultAssets = () => {
    const { activeAccount } = store.getState().vault;

    const defaultAsset = {
      name: 'ethereum',
      symbol: 'ETH',
      decimals: 18,
    };

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        assets: [...activeAccount.assets, defaultAsset],
      })
    );
  };

  const setActiveNetwork = async (chain: string, chainId: number) => {
    store.dispatch(setIsPendingBalances(true));

    const { networks, activeAccount } = store.getState().vault;

    const network = networks[chain][chainId];

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

    if (chain === 'ethereum') setAccountDefaultAssets();

    return account;
  };

  const addCustomRpc = async (data: CustomRpcParams): Promise<INetwork> => {
    const { chainId, rpcUrl, token_contract_address, isSyscoinRpc, label } =
      data;

    const chain = isSyscoinRpc ? 'syscoin' : 'ethereum';

    const { networks } = store.getState().vault;

    if (networks[chainId]) throw new Error('Network already exists');

    const { valid, data: _data } = isSyscoinRpc
      ? await validateSysRpc(rpcUrl)
      : await validateEthRpc(chainId, rpcUrl, token_contract_address);

    if (!valid) throw new Error(`Invalid ${chain} RPC`);

    const network = {
      ..._data,
      label,
    };

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
    account,
    setAccount,
    setAutolockTimer,
    setActiveNetwork,
    addCustomRpc,
    removeKeyringNetwork,
    ...keyringManager,
  };
};

export default MainController;
