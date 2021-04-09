import { generateMnemonic, validateMnemonic } from 'bip39';
import store from 'state/store';
import {
  setKeystoreInfo,
  deleteWallet as deleteWalletState,
  changeAccountActiveId,
  changeActiveNetwork,
  updateStatus,
  setEncriptedMnemonic,
  removeAccounts
} from 'state/wallet';
import AccountController, { IAccountController } from './AccountController';
import IWalletState, { Keystore } from 'state/wallet/types';
import { sys, SYS_NETWORK } from 'constants/index';
import CryptoJS from 'crypto-js';
// import {sys, SYS_NETWORK} from '../../../constants'
// import {SyscoinJSLib} from 'syscoinjs-lib';
// import {HDSigner} from 'syscoinjs-lib/utils';
export interface IWalletController {
  account: Readonly<IAccountController>;
  setWalletPassword: (pwd: string) => void;
  isLocked: () => boolean;
  generatePhrase: () => string | null;
  createWallet: (isUpdated?: boolean) => void;
  unLock: (pwd: string) => boolean;
  checkPassword: (pwd: string) => boolean;
  getPhrase: (pwd: string) => string | null;
  deleteWallet: (pwd: string) => void;
  importPhrase: (phr: string) => boolean;
  switchWallet: (id: number) => void;
  switchNetwork: (networkId: string) => void;
  getNewAddress: () => Promise<boolean>;
  logOut: () => void;
}

const WalletController = (): IWalletController => {
  let password = '';
  let mnemonic = '';
  let HDsigner: any = null;
  let sjs: any = null;
  let backendURl = SYS_NETWORK.testnet.beUrl;

  const setWalletPassword = (pwd: string) => {
    password = pwd;
  };

  const isLocked = () => {
    console.log('is locked', !password || !mnemonic)
    return !password || !mnemonic;
  };

  const generatePhrase = () => {
    if (retrieveEncriptedMnemonic()) {
      return null;
    }

    if (!mnemonic) mnemonic = generateMnemonic();
    return mnemonic;
  };

  const createWallet = (isUpdated = false) => {
    // if (!isUpdated && seedWalletKeystore()) {
    //   return;
    // }
    if (!isUpdated && sjs !== null) {
      return
    }
    console.log("creating mnemonic", mnemonic)
    console.log("creating password", password)
    HDsigner = new sys.utils.HDSigner(mnemonic, null, true)
    sjs = new sys.SyscoinJSLib(HDsigner, backendURl)
    // if (HDsigner.accountIndex > 0) {
    //   throw new Error("account index is bigger then 0 logic inconsistency")
    // }
    if (isUpdated) {
      const { accounts } = store.getState().wallet;

      if (accounts) {
        store.dispatch(removeAccounts());
      }
    }

    const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, password)
    store.dispatch(setEncriptedMnemonic(encryptedMnemonic));
    console.log("The accounts on HDsigner:", HDsigner.accounts)
    account.subscribeAccount(sjs);
    account.getPrimaryAccount(password, sjs);

    if (isUpdated) {
      account.getLatestUpdate();
    }
  };

  // const seedWalletKeystore = () => {
  //   const { keystores, seedKeystoreId }: IWalletState = store.getState().wallet;

  //   return keystores && seedKeystoreId > -1 && keystores[seedKeystoreId]
  //     ? keystores[seedKeystoreId]
  //     : null;
  // };

  const retrieveEncriptedMnemonic = () => {
    // not encrypted for now but we got to retrieve
    const { encriptedMnemonic }: IWalletState = store.getState().wallet
    // const { keystores, seedKeystoreId }: IWalletState = store.getState().wallet;

    return encriptedMnemonic != ''
      ? encriptedMnemonic
      : null;
  };
  const checkPassword = (pwd: string) => {
    return password === pwd;
  };

  const getPhrase = (pwd: string) => {
    return checkPassword(pwd) ? mnemonic : null;
  };

  const unLock = (pwd: string): boolean => {
    try {
      const encriptedMnemonic = retrieveEncriptedMnemonic();
      //add unencript password 
      console.log("The hash", encriptedMnemonic)
      const decriptedMnemonic = CryptoJS.AES.decrypt(encriptedMnemonic, pwd).toString(CryptoJS.enc.Utf8); //add unencript password 
      if (!decriptedMnemonic) {
        throw new Error('password wrong');
      }
      if (HDsigner === null || sjs === null) {
        HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, true)
        sjs = new sys.SyscoinJSLib(HDsigner, backendURl)

        //Restore logic/ function goes here 
        console.log('HDsigner retrieved')
        console.log('XPUB retrieved', sjs.HDSigner.getAccountXpub())
      }

      password = pwd;
      mnemonic = decriptedMnemonic;

      account.getPrimaryAccount(password, sjs);
      account.watchMemPool();
      console.log('unblock')
      return true;
    } catch (error) {
      console.log(error);
      return false;
    }
  };

  const deleteWallet = (pwd: string) => {
    if (checkPassword(pwd)) {
      password = '';
      mnemonic = '';

      store.dispatch(deleteWalletState());
      store.dispatch(updateStatus());
    }
  };

  const importPhrase = (seedphrase: string) => {

    if (validateMnemonic(seedphrase)) {
      mnemonic = seedphrase
      console.log("mnemonic is set:", mnemonic)
      return true;
    }

    return false;
  };

  const switchWallet = (id: number) => {
    store.dispatch(changeAccountActiveId(id));
    account.getLatestUpdate();
  };

  const logOut = () => {
    password = '';
    mnemonic = '';
    store.dispatch(updateStatus());
  };

  const importPrivKey = (privKey: string) => {
    const { keystores }: IWalletState = store.getState().wallet;

    if (isLocked() || !privKey) {
      return null;
    }

    const newKeystoreImportAccount: Keystore = {
      id: 0,
      address: 'address-newkeystore-imported',
      phrase: mnemonic
    }

    if (keystores.filter((keystore) => (keystore as Keystore).address === (newKeystoreImportAccount as Keystore).address).length) {
      return null;
    }

    store.dispatch(setKeystoreInfo(newKeystoreImportAccount));
    return newKeystoreImportAccount;
  };

  const switchNetwork = (networkId: string) => {
    if (SYS_NETWORK[networkId]!.id) {
      // set network here (syscoin set network)
      store.dispatch(changeActiveNetwork(SYS_NETWORK[networkId]!.id));
      account.getLatestUpdate();
    }
  };

  const getNewAddress = async () => {

    sjs.HDSigner.receivingIndex = -1;
    const address = await sjs.HDSigner.getNewReceivingAddress()
    return account.setNewAddress(address)
  }

  const account = AccountController({ checkPassword, importPrivKey });

  return {
    account,
    isLocked,
    setWalletPassword,
    generatePhrase,
    createWallet,
    checkPassword,
    getPhrase,
    deleteWallet,
    importPhrase,
    unLock,
    switchWallet,
    switchNetwork,
    getNewAddress,
    logOut,
  };
};

export default WalletController;