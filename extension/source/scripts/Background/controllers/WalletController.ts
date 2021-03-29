import { generateMnemonic } from 'bip39';
import store from 'state/store';
import {
  setKeystoreInfo,
  deleteWallet as deleteWalletState,
  changeAccountActiveId,
  changeActiveNetwork,
  updateStatus,
  updateSeedKeystoreId,
  removeSeedAccounts,
} from 'state/wallet';
import AccountController, { IAccountController } from './AccountController';
import IWalletState, { Keystore } from 'state/wallet/types';
import { SYS_NETWORK } from 'constants/index';

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
  logOut: () => void;
}

const WalletController = (): IWalletController => {
  let password = '';
  let phrase = '';

  const setWalletPassword = (pwd: string) => {
    password = pwd;
  };

  const isLocked = () => {
    return !password || !phrase;
  };

  const generatePhrase = () => {
    if (seedWalletKeystore()) {
      return null;
    }

    if (!phrase) phrase = generateMnemonic();

    return phrase;
  };

  const createWallet = (isUpdated = false) => {
    if (!isUpdated && seedWalletKeystore()) {
      return;
    }

    if (isUpdated) {
      const { seedKeystoreId, keystores } = store.getState().wallet;

      if (seedKeystoreId > -1 && keystores[seedKeystoreId]) {
        store.dispatch(removeSeedAccounts());
      }
    }

    const newKeystore: Keystore = {
      id: 0,
      address: 'address-newkeystore',
      phrase
    }

    store.dispatch(setKeystoreInfo(newKeystore));
    store.dispatch(updateSeedKeystoreId(newKeystore.id));

    account.subscribeAccount(0);
    account.getPrimaryAccount(password);

    if (isUpdated) {
      account.getLatestUpdate();
    }
  };

  const seedWalletKeystore = () => {
    const { keystores, seedKeystoreId }: IWalletState = store.getState().wallet;

    return keystores && seedKeystoreId > -1 && keystores[seedKeystoreId]
      ? keystores[seedKeystoreId]
      : null;
  };

  const checkPassword = (pwd: string) => {
    return password === pwd;
  };

  const getPhrase = (pwd: string) => {
    return checkPassword(pwd) ? phrase : null;
  };

  const unLock = (pwd: string): boolean => {
    try {
      const keystore = seedWalletKeystore();

      if (!keystore) {
        throw new Error('keystore not set');
      }

      password = pwd;
      phrase = keystore.phrase;

      account.getPrimaryAccount(password);
      account.watchMemPool();

      return true;
    } catch (error) {
      console.log(error);
    }

    return false;
  };

  const deleteWallet = (pwd: string) => {
    if (checkPassword(pwd)) {
      password = '';
      phrase = '';

      store.dispatch(deleteWalletState());
      store.dispatch(updateStatus());
    }
  };

  const importPhrase = (phr: string) => {
    const keystore = seedWalletKeystore();

    if (keystore) {
      return keystore.phrase == phr;
    }

    return false;
  };

  const switchWallet = (id: number) => {
    store.dispatch(changeAccountActiveId(id));
    account.getLatestUpdate();
  };

  const logOut = () => {
    password = '';
    phrase = '';
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
      phrase
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
    logOut,
  };
};

export default WalletController;