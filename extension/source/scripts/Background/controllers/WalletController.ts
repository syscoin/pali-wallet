import { generateMnemonic, validateMnemonic } from 'bip39';
import { fromZPrv } from 'bip84';
import store from 'state/store';
import {
  deleteWallet as deleteWalletState,
  changeAccountActiveId,
  changeActiveNetwork,
  updateStatus,
  setEncriptedMnemonic,
  removeAccounts,
  updateBlockbookURL,
  removeAccount
} from 'state/wallet';
import AccountController, { IAccountController } from './AccountController';
import IWalletState, {
  IAccountState
} from 'state/wallet/types';
import { sys, SYS_NETWORK } from 'constants/index';
import CryptoJS from 'crypto-js';
// var TrezorConnect = window.trezorConnect;
import { fromZPub } from 'bip84';

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
    store.dispatch(updateBlockbookURL(SYS_NETWORK.main.beUrl));

    account.subscribeAccount(false, sjs, undefined, true).then(() => {
      account.getPrimaryAccount(password, sjs);
    })
  };

  const createHardwareWallet = () => {
    const isTestnet = store.getState().wallet.activeNetwork === 'testnet';
    let path: string = "m/84'/57'/0'";
    let coin: string = "sys"
    if (isTestnet) {
      path = "m/84'/1'/0'";
      coin = "tsys";
    }
    console.log(window.trezorConnect)
    window.trezorConnect.getAccountInfo({
      path: path,
      coin: coin
    })
      .then((response: any) => {
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
        store.dispatch(updateBlockbookURL(backendURl));

        const { activeAccountId, accounts } = store.getState().wallet;

        if (accounts.length > 1000) {
          return false;
        }
        for (let i = 1; i <= accounts.length; i++) {
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
    const { activeAccountId, accounts, activeNetwork } = store.getState().wallet;

    if (accounts.length > 1000) {
      return false;
    }
    console.log(accounts.length)
    for (let i = 1; i <= accounts.length; i++) {
      console.log("loop number " + i)
      console.log(accounts[i])
      if (accounts[i] === undefined || accounts[i] === null) break;
      if (accounts[i].isTrezorWallet) {
        console.log("Should not derive from hdsigner if the account is from the hardware wallet")
        if (activeAccountId !== accounts[i].id) {
          console.log("User switching network without trezor connected")
          store.dispatch(removeAccount(i));
          store.dispatch(updateStatus());
          const message = "Your device is being disconnected";
          chrome.notifications.create(new Date().getTime().toString(), {
            type: 'basic',
            iconUrl: 'assets/icons/favicon-48.png',
            title: 'Hardware Wallet removed due to network switch',
            message
          });

        }
        else {
          let path: string = "m/84'/57'/0'";
          let coin: string = "sys"
          if (activeNetwork === 'testnet') {
            path = "m/84'/1'/0'";
            coin = "tsys";
          }
          window.trezorConnect.getAccountInfo({
            path: path,
            coin: coin
          })
            .then((response: any) => {
              const message = response.success
                ? `Trezor Wallet Account Created`
                : `Error: ${response.payload.error}`;
              chrome.notifications.create(new Date().getTime().toString(), {
                type: 'basic',
                iconUrl: 'assets/icons/favicon-48.png',
                title: 'Hardware Wallet updated to ' + activeNetwork,
                message,
              });
              if (response.success) {
                console.log("update xpub")
              }
            })
            .catch((error: any) => {
              console.error('TrezorConnectError', error);
            });

        }
      }
      else {
        const child = sjs.HDSigner.deriveAccount(i);
        let derived = new fromZPrv(child, sjs.HDSigner.pubTypes, sjs.HDSigner.networks);

        console.log('child', child, 'derived', derived)

        account.setNewXpub(i, derived.getAccountPublicKey());
        console.log('account', account, sjs, sjs.HDSigner)
        sjs.HDSigner.accounts.push(derived);
        sjs.HDSigner.accountIndex = activeAccountId;
        console.log("end of for")
      }
    }
    console.log("Updating account controller")
    account.getPrimaryAccount(password, sjs);
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
      store.dispatch(updateBlockbookURL(SYS_NETWORK.main.beUrl));

      _getAccountDataByNetwork(sjs);

      return;
    }

    HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, true);
    sjs = new sys.SyscoinJSLib(HDsigner, SYS_NETWORK.testnet.beUrl);

    store.dispatch(updateBlockbookURL(SYS_NETWORK.testnet.beUrl));

    _getAccountDataByNetwork(sjs);

    return;
  };

  const getNewAddress = async () => {
    const { activeAccountId, accounts } = store.getState().wallet;
    let address: string = ""
    let userAccount: IAccountState = accounts.find((el: IAccountState) => el.id === activeAccountId)
    if (userAccount!.isTrezorWallet) {
      console.log("Updating trezor address")
      console.log("Old address")
      console.log(userAccount.address)
      const res = await sys.utils.fetchBackendAccount(sjs.blockbookURL, userAccount.xpub, 'tokens=nonzero&details=txs', true);
      let account0 = new fromZPub(userAccount.xpub, sjs.HDSigner.pubTypes, sjs.HDSigner.networks)
      let receivingIndex: number = -1
      if (res.tokens) {
        res.tokens.forEach((token: any) => {
          if (token.path) {
            const splitPath = token.path.split('/')
            if (splitPath.length >= 6) {
              const change = parseInt(splitPath[4], 10)
              const index = parseInt(splitPath[5], 10)
              if (change === 1) {
                console.log("Can't update it's change index")
              }
              else if (index > receivingIndex) {
                receivingIndex = index
              }
            }
          }
        })
      }
      console.log(receivingIndex)
      address = account0.getAddress(receivingIndex + 1)
      console.log("New address")
      console.log(address)



    }
    else {
      sjs.HDSigner.receivingIndex = -1;
      address = await sjs.HDSigner.getNewReceivingAddress();
      console.log("Receiving Index :")
      console.log(sjs.HDSigner.receivingIndex)
    }

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