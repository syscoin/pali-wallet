import cryptojs from 'crypto-js';
import { KeyringManager } from '@pollum-io/sysweb3-keyring';
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
} from 'state/vault';
import WalletController from './account';

const MainController = () => {
  /** signers */
  let hd: SyscoinHDSigner = {} as SyscoinHDSigner;
  let main: SyscoinMainSigner = {} as SyscoinMainSigner;

  /** local keys */
  let encryptedPassword: string = '';
  let mnemonic = '';

  const keyringManager = KeyringManager();

  // const setMainSigner = () => {
  //   const { activeNetwork: { url, isTestnet } } = store.getState().vault;
  //   console.log('setting hd signer', url, isTestnet)

  //   const { hd: _hd, main: _main } = MainSigner({
  //     walletMnemonic: mnemonic,
  //     network: 'main',
  //     blockbookURL: url,
  //     isTestnet,
  //   });

  //   console.log('hd signer', _hd)
  //   console.log('main signer', _main)

  //   hd = _hd;
  //   main = _main;
  // };

  const checkPassword = (pwd: string) => {
    if (encryptedPassword === cryptojs.SHA3(pwd).toString()) {
      return true;
    }

    return encryptedPassword === pwd;
  };

  const { account } = WalletController({ checkPassword, hd, main });

  const getSeed = (pwd: string) => (checkPassword(pwd) ? hd.mnemonic : null);

  const isUnlocked = () => encryptedPassword && mnemonic;

  const setAutolockTimer = (minutes: number) => {
    store.dispatch(setTimer(minutes));
  };

  const forgetWallet = (pwd: string) => {
    if (checkPassword(pwd)) {
      encryptedPassword = '';
      mnemonic = '';

      store.dispatch(forgetWalletState());
      store.dispatch(setLastLogin());
    }
  };

  const unlock = async (pwd: string): Promise<void> => {
    console.log('calling keyring manager login');

    if (!checkPassword(pwd)) return;

    keyringManager.login(pwd);

    store.dispatch(setLastLogin());

    account.tx.getLatestUpdate();
  };

  const createSeed = () => {
    mnemonic = keyringManager.generatePhrase();

    return mnemonic;
  };

  const setWalletPassword = (pwd: string) => {
    encryptedPassword = cryptojs.SHA3(pwd).toString();

    return keyringManager.setWalletPassword(pwd);
  };

  const getEncryptedMnemonic = (
    mnemonic: string,
    encryptedPassword: string
  ): string => {
    const encryptedMnemonic = cryptojs.AES.encrypt(mnemonic, encryptedPassword);

    return encryptedMnemonic.toString();
  };

  const createWallet = async (): Promise<IKeyringAccountState> => {
    console.log('[main] setting signers 1', hd, main);

    const {
      account,
      hd: _hd,
      main: _main,
    } = await keyringManager.createVault({
      encryptedPassword,
    });

    console.log('[main] setting signers 2', _hd, _main, _hd.mnemonic);

    store.dispatch(addAccountToStore(account));
    store.dispatch(
      setEncryptedMnemonic(getEncryptedMnemonic(mnemonic, encryptedPassword))
    );
    store.dispatch(setActiveAccount(account));
    store.dispatch(setLastLogin());

    hd = _hd;
    main = _main;

    console.log('[main] getting latest update', account);

    return account;
  };

  const importSeed = (seedphrase: string) => {
    console.log('[main] validating mnemonic:', seedphrase);

    if (validateMnemonic(seedphrase)) {
      mnemonic = seedphrase;

      console.log('[main] validation passed:', seedphrase);

      return true;
    }

    return false;
  };

  const lock = () => {
    encryptedPassword = '';
    mnemonic = '';

    store.dispatch(setLastLogin());
  };

  const createAccount = (label?: string) => account.addAccount(label);

  const setAccount = (id: number) => {
    const { accounts } = store.getState().vault;

    store.dispatch(setActiveAccount(accounts[id]));
    account.tx.getLatestUpdate();
  };

  return {
    createWallet,
    isUnlocked,
    createSeed,
    checkPassword,
    getSeed,
    forgetWallet,
    importSeed,
    unlock,
    lock,
    createAccount,
    account, // trezor, tx inside account
    setWalletPassword,
    setAccount,
    setAutolockTimer,
  };
};

export default MainController;
