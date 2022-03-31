import cryptojs from 'crypto-js';
import { KeyringManager } from '@pollum-io/sysweb3-keyring';
import { validateMnemonic } from 'bip39';
import {
  IKeyringAccountState,
  MainSigner,
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
  let main: any;

  /** local keys */
  let encryptedPassword: string = '';
  let mnemonic = '';

  const keyringManager = KeyringManager();

  // todo: add is test net to network sysweb3
  const setMainSigner = () => {
    const { hd: _hd, main: _main } = MainSigner({
      walletMnemonic: mnemonic,
      network: 'main',
      blockbookURL: store.getState().vault.activeNetwork.url,
      isTestnet: false,
    });

    hd = _hd;
    main = _main;
  };

  const checkPassword = (pwd: string) => {
    if (encryptedPassword === cryptojs.SHA3(pwd).toString()) {
      return true;
    }

    return encryptedPassword === pwd;
  };

  const { account } = WalletController({ checkPassword, hd, main });

  const getSeed = (pwd: string) => (checkPassword(pwd) ? mnemonic : null);

  const isUnlocked = () => Boolean(encryptedPassword) || hd;

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
    console.log('[main] creating vault', encryptedPassword);

    console.log('[pali] setting signer, mnemonic:', mnemonic);

    setMainSigner();

    const vault: IKeyringAccountState = await keyringManager.createVault({
      encryptedPassword,
    });

    console.log('[main] storing wallet:', vault);

    store.dispatch(addAccountToStore(vault));
    store.dispatch(
      setEncryptedMnemonic(getEncryptedMnemonic(mnemonic, encryptedPassword))
    );
    store.dispatch(setActiveAccount(vault));
    store.dispatch(setLastLogin());

    console.log('[main] getting latest update');

    return vault;
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
