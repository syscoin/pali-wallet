import { generateMnemonic, validateMnemonic } from 'bip39';
import { fromZPrv } from 'bip84';
import store from 'state/store';
import {
  deleteWallet as deleteWalletState,
  changeAccountActiveId,
  changeActiveNetwork,
  updateStatus,
  setEncriptedMnemonic,
  removeAccounts
} from 'state/wallet';
import AccountController, { IAccountController } from './AccountController';
import IWalletState from 'state/wallet/types';
import { sys, SYS_NETWORK } from 'constants/index';
import CryptoJS from 'crypto-js';
// var TrezorConnect = window.trezorConnect;

export interface IWalletController {
  account: Readonly<IAccountController>;
  setWalletPassword: (pwd: string) => void;
  isLocked: () => boolean;
  generatePhrase: () => string | null;
  createWallet: (isUpdated?: boolean) => void;
  createHardwareWallet: () => void;
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

  const setWalletPassword = (pwd: string) => {
    password = pwd;
  };

  const isLocked = () => {
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
    if (!isUpdated && sjs !== null) {
      return;
    }

    HDsigner = new sys.utils.HDSigner(mnemonic, null, false);
    sjs = new sys.SyscoinJSLib(HDsigner, SYS_NETWORK.main.beUrl);

    if (isUpdated) {
      const { accounts } = store.getState().wallet;

      if (accounts) {
        store.dispatch(removeAccounts());
      }
    }

    const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, password);

    store.dispatch(setEncriptedMnemonic(encryptedMnemonic));

    account.subscribeAccount(false, sjs).then(() => {
      account.getPrimaryAccount(password, sjs);
    })
  };

  const createHardwareWallet = () => {
    const isTestnet = store.getState().wallet.activeNetwork === 'testnet';
    console.log(isTestnet)
    console.log("...................................")
    console.log(store.getState().wallet.activeNetwork)
    console.log("...................................")

    let path: string = "m/84'/57'/0'";
    let coin: string = "sys"
    if (isTestnet) {
      console.log("NO NO NO")
      console.log("Wallet on testnet thats a NONO")
      return;
    }
    window.trezorConnect.getAccountInfo({
      path: path,
      coin: coin
    })
      .then((response: any) => {
        console.log("Only everything")
        console.log(response.payload)
        const message = response.success
          ? `Trezor Wallet Account Created`
          : `Error: ${response.payload.error}`;
        chrome.notifications.create(new Date().getTime().toString(), {
          type: 'basic',
          iconUrl: 'assets/icons/favicon-48.png',
          title: 'Hardware Wallet connected',
          message,
        });
        if (response.success) {
          account.subscribeAccount(true, response.payload);
        }
      })
      .catch((error: any) => {
        console.error('TrezorConnectError', error);
      });
  }

  const retrieveEncriptedMnemonic = () => {
    // not encrypted for now but we got to retrieve
    const { encriptedMnemonic }: IWalletState = store.getState().wallet;

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
      const decriptedMnemonic = CryptoJS.AES.decrypt(encriptedMnemonic, pwd).toString(CryptoJS.enc.Utf8);

      if (!decriptedMnemonic) {
        throw new Error('password wrong');
      }

      if (HDsigner === null || sjs === null) {
        const isTestnet = store.getState().wallet.activeNetwork === 'testnet';
        const backendURl: string = store.getState().wallet.activeNetwork === 'testnet' ? SYS_NETWORK.testnet.beUrl : SYS_NETWORK.main.beUrl;
        HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, isTestnet);
        sjs = new sys.SyscoinJSLib(HDsigner, backendURl);

        const { activeAccountId, accounts } = store.getState().wallet;

        if (accounts.length > 1000) {
          return false;
        }
        for (let i = 1; i <= accounts.length - 1; i++) {
          if (accounts[i].isTrezorWallet) {
            console.log("Should not derive from hdsigner if the account is from the hardware wallet")
          }
          else {
            const child = sjs.HDSigner.deriveAccount(i);

            sjs.HDSigner.accounts.push(new fromZPrv(child, sjs.HDSigner.pubTypes, sjs.HDSigner.networks));
            sjs.HDSigner.accountIndex = activeAccountId;
          }

        }
      }

      password = pwd;
      mnemonic = decriptedMnemonic;

      account.getPrimaryAccount(password, sjs);
      account.watchMemPool();

      return true;
    } catch (error) {
      return false;
    }
  };

  const deleteWallet = (pwd: string) => {
    if (checkPassword(pwd)) {
      password = '';
      mnemonic = '';
      HDsigner = null;
      sjs = null;
      store.dispatch(deleteWalletState());
      store.dispatch(updateStatus());
    }
  };

  const importPhrase = (seedphrase: string) => {
    if (validateMnemonic(seedphrase)) {
      mnemonic = seedphrase;

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

  const _getAccountDataByNetwork = (sjs: any) => {
    const { activeAccountId, accounts } = store.getState().wallet;

    if (accounts.length > 1000) {
      return false;
    }

    for (let i = 1; i <= accounts.length - 1; i++) {
      if (accounts[i].isTrezorWallet) {
        console.log("Should not derive from hdsigner if the account is from the hardware wallet")
      }
      else {
        const child = sjs.HDSigner.deriveAccount(i);

        sjs.HDSigner.accounts.push(new fromZPrv(child, sjs.HDSigner.pubTypes, sjs.HDSigner.networks));
        sjs.HDSigner.accountIndex = activeAccountId;
      }
    }

    account.getPrimaryAccount(password, sjs);
    // account.getLatestUpdate();
    // account.watchMemPool();

    return;
  }

  const switchNetwork = (networkId: string) => {
    store.dispatch(changeActiveNetwork(SYS_NETWORK[networkId]!.id));

    const encriptedMnemonic = retrieveEncriptedMnemonic();
    const decriptedMnemonic = CryptoJS.AES.decrypt(encriptedMnemonic, password).toString(CryptoJS.enc.Utf8);

    if (!decriptedMnemonic) {
      throw new Error('password wrong');
    }

    if (SYS_NETWORK[networkId]!.id === 'main') {
      HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, false);
      sjs = new sys.SyscoinJSLib(HDsigner, SYS_NETWORK.main.beUrl);

      _getAccountDataByNetwork(sjs);

      return;
    }

    HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, true);
    sjs = new sys.SyscoinJSLib(HDsigner, SYS_NETWORK.testnet.beUrl);

    _getAccountDataByNetwork(sjs);

    return;
  };

  const getNewAddress = async () => {
    sjs.HDSigner.receivingIndex = -1;
    const address = await sjs.HDSigner.getNewReceivingAddress();

    return account.setNewAddress(address);
  }

  const account = AccountController({ checkPassword });

  return {
    account,
    isLocked,
    setWalletPassword,
    generatePhrase,
    createWallet,
    createHardwareWallet,
    checkPassword,
    getPhrase,
    deleteWallet,
    importPhrase,
    unLock,
    switchWallet,
    switchNetwork,
    getNewAddress,
    logOut
  };
};

export default WalletController;