import { KeyringManager } from '@pollum-io/sysweb3-keyring';
import { IToken } from 'pages/Tokens';
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
  setWeb3Assets,
} from 'state/vault';
import { IKeyringAccount } from 'state/vault/types';

import WalletController from './account';

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
    // @ts-ignore
    keyringManager.forgetMainWallet(pwd);

    store.dispatch(forgetWalletState());
    store.dispatch(setLastLogin());
  };

  const unlock = async (pwd: string): Promise<void> => {
    const vault = (await keyringManager.login(pwd)) as IKeyringAccount;

    store.dispatch(setLastLogin());
    store.dispatch(setActiveAccount(vault));
  };

  const createWallet = async (): Promise<IKeyringAccount> => {
    console.log('[main controller] calling keyring manager create vault');
    const account =
      (await keyringManager.createKeyringVault()) as IKeyringAccount;

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
  const importWeb3Tokens = (filterArr: IToken[], index: number) => {
    store.dispatch(setWeb3Assets(filterArr[index]));
  };
  const createAccount = async (label?: string) => {
    const newAccount = await addAccount(label);

    console.log('adding account to store', newAccount);

    store.dispatch(addAccountToStore(newAccount));

    return newAccount;
  };

  const setAccount = (id: number) => {
    const { accounts } = store.getState().vault;

    store.dispatch(setActiveAccount(accounts[id]));
    account.getLatestUpdate(false);
  };

  const setActiveNetwork = async (chain: string, chainId: number) => {
    store.dispatch(setIsPendingBalances(true));

    const { networks, activeAccount } = store.getState().vault;

    const network = networks[chain][chainId];

    /** set local active network */
    store.dispatch(setNetwork(network));

    /** this method sets new signers for syscoin when changing networks */
    const account = (await keyringManager.setActiveNetworkForSigner(
      network
    )) as IKeyringAccount;

    /** directly set new keys for the current chain and update state if the active account is the first one */
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
    /** end */

    /** if the account index is > 0, we need to derive this account again from hd signer and set its index in the active account from signer */
    if (account.id === 0)
      keyringManager.setAccountIndexForDerivedAccount(activeAccount.id);

    /** set active network with web3 account data for evm networks */
    store.dispatch(setActiveAccount(account));
    store.dispatch(setIsPendingBalances(false));

    /** account returned from updated signer according to the current network so we can update frontend easier */
    return account;
  };

  return {
    createWallet,
    importWeb3Tokens,
    forgetWallet,
    unlock,
    lock,
    createAccount,
    account,
    setAccount,
    setAutolockTimer,
    setActiveNetwork,
    ...keyringManager,
  };
};

export default MainController;
