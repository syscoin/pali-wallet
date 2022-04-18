import { KeyringManager } from '@pollum-io/sysweb3-keyring';
import {
  IKeyringAccountState,
  INetwork,
  validateSysRpc,
  validateEthRpc,
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
} from 'state/vault';

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
    keyringManager.forgetMainWallet(pwd);

    store.dispatch(forgetWalletState());
    store.dispatch(setLastLogin());
  };

  const unlock = async (pwd: string): Promise<void> => {
    const seedByPassword = await keyringManager.getSeed(pwd);

    if (seedByPassword) {
      const account = (await keyringManager.login(pwd)) as IKeyringAccountState;

      store.dispatch(setLastLogin());
      store.dispatch(setActiveAccount(account));
    }
  };

  const createWallet = async (): Promise<IKeyringAccountState> => {
    console.log('[main controller] calling keyring manager create vault');
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
    )) as IKeyringAccountState;

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

    store.dispatch(setIsPendingBalances(false));

    /** set active network with web3 account data for evm networks */
    store.dispatch(setActiveAccount(account));

    /** account returned from updated signer according to the current network so we can update frontend easier */
    return account;
  };

  const hexRegEx = /^0x[0-9a-f]+$/iu;
  const chainIdRegEx = /^0x[1-9a-f]+[0-9a-f]*$/iu;

  const addCustomRpc = async (network: INetwork): Promise<INetwork | Error> => {
    const { chainId, url } = network;

    const isRpcWithInvalidChainId =
      typeof chainId === 'string' &&
      !chainIdRegEx.test(chainId) &&
      hexRegEx.test(chainId);

    if (isRpcWithInvalidChainId) {
      return new Error('RPC has an invalid chain ID');
    }

    const { activeNetwork, networks } = store.getState().vault;

    const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);
    const chain = isSyscoinChain ? 'syscoin' : 'ethereum';

    const isValid = isSyscoinChain
      ? await validateSysRpc(url)
      : await validateEthRpc(chainId, url);

    if (!isValid) return new Error(`Invalid ${chain} RPC`);

    store.dispatch(setNetworks({ chain, network }));

    return network;
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
    ...keyringManager,
  };
};

export default MainController;
