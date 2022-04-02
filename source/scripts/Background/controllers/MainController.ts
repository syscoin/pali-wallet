import cryptojs from 'crypto-js';
import { KeyringManager, Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { validateMnemonic } from 'bip39';
import {
  IKeyringAccountState,
  SyscoinMainSigner,
  SyscoinHDSigner,
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
} from 'state/vault';

import WalletController from './account';

const MainController = () => {
  /** signers */
  let hd: SyscoinHDSigner = {} as SyscoinHDSigner;
  let main: SyscoinMainSigner = {} as SyscoinMainSigner;

  const keyringManager = KeyringManager();
  const Web3Wallet = Web3Accounts();

  const setAutolockTimer = (minutes: number) => {
    store.dispatch(setTimer(minutes));
  };

  /** forget your wallet created with pali and associated with your seed phrase,
   *  but don't delete seed phrase so it is possible to create a new
   *  account using the same seed
   */
  const forgetWallet = (pwd: string) => {
    if (checkPassword(pwd)) {
      keyringManager.forgetWallet();

      store.dispatch(forgetWalletState());
      store.dispatch(setLastLogin());
    }
  };

  const unlock = async (pwd: string): Promise<void> => {
    console.log('calling keyring manager login');

    if (!checkPassword(pwd)) return;

    const vault = await keyringManager.login(pwd);

    store.dispatch(setLastLogin());

    // store.dispatch(setActiveAccount())

    console.log('vault unlocked', vault);
  };

  const createWallet = async (): Promise<IKeyringAccountState> => {
    console.log('[main] setting signers 1', hd, main);

    const {
      account,
      hd: _hd,
      main: _main,
    } = await keyringManager.createVault();

    console.log('[main] setting signers 2', _hd, _main, _hd.mnemonic);

    store.dispatch(addAccountToStore(account));
    store.dispatch(setEncryptedMnemonic(keyringManager.getEncryptedMnemonic()));
    store.dispatch(setActiveAccount(account));
    store.dispatch(setLastLogin());

    /** set signers for syscoin when creating a new wallet */
    hd = _hd;
    main = _main;

    console.log('[main] getting latest update', account);

    return account;
  };

  const { account } = WalletController({
    checkPassword: keyringManager.checkPassword,
    hd,
    main,
  });

  const lock = () => {
    keyringManager.logout();

    store.dispatch(setLastLogin());
  };

  const createAccount = (label?: string) => account.addAccount(label);

  const setAccount = (id: number) => {
    const { accounts } = store.getState().vault;

    store.dispatch(setActiveAccount(accounts[id]));
    account.getLatestUpdate();
  };

  const setActiveNetwork = async (chain: string, chainId: number) => {
    const { networks, activeAccount } = store.getState().vault;

    const network = networks[chain][chainId];

    /** set local active network */
    store.dispatch(setNetwork(network));

    /** this method sets new signers for syscoin when changing networks */
    const { account } = await keyringManager.setActiveNetworkForSigner({
      network,
    });

    /** directly set new keys for the current chain and update state if the active account is the first one */
    if (activeAccount.id === 0) {
      const currentSignerAccount = hd.Signer.accounts[activeAccount.id];

      const xpub = currentSignerAccount.getAccountPublicKey();
      const xprv = currentSignerAccount.getAccountPrivateKey();

      store.dispatch(
        setActiveAccountProperty({
          property: 'xpub',
          value: xpub,
        })
      );

      store.dispatch(
        setActiveAccountProperty({
          property: 'xprv',
          value: keyringManager.getEncryptedXprv(),
        })
      );
    }
    /** end */

    /** if the account index is > 0, we need to derive this account again from hd signer and set its index in the active account from signer */
    keyringManager.setAccountIndexForDerivedAccount(hd, activeAccount.id);

    /** set active network with web3 account data for evm networks */
    store.dispatch(setActiveAccount(account));

    /** account returned from updated signer according to the current network so we can update frontend easier */
    return account;
  };

  return {
    createWallet,
    isUnlocked: keyringManager.isUnlocked,
    createSeed: keyringManager.createSeed,
    checkPassword: keyringManager.checkPassword,
    getSeed: keyringManager.getSeed,
    forgetWallet,
    importSeed: keyringManager.validateSeed,
    unlock,
    lock,
    createAccount,
    account,
    setWalletPassword: keyringManager.setWalletPassword,
    setAccount,
    setAutolockTimer,
    setActiveNetwork,
  };
};

export default MainController;
