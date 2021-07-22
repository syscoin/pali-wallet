import { sys, SYS_NETWORK } from 'constants/index';

import { generateMnemonic, validateMnemonic } from 'bip39';
import { fromZPrv , fromZPub } from 'bip84';
import store from 'state/store';
import {
  deleteWallet as deleteWalletState,
  changeAccountActiveId,
  changeActiveNetwork,
  updateStatus,
  setEncriptedMnemonic,
  removeAccounts,
  removeAccount,
  updateSwitchNetwork
} from 'state/wallet';
import IWalletState, {
  IAccountState
} from 'state/wallet/types';
import CryptoJS from 'crypto-js';

import AccountController from './AccountController';

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

  const createWallet = async (isUpdated = false) => {
    if (!isUpdated && sjs) {
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

    await account.subscribeAccount(false, sjs, undefined, true);

    account.getPrimaryAccount(password, sjs);

    await account.updateTokensState();
  };

  const createHardwareWallet = () => {
    const path = "m/84'/57'/0'";
    const coin = "sys";

    if (store.getState().wallet.activeNetwork === 'testnet') {
      const message = "Trezor doesn't support SYS testnet";

      chrome.notifications.create(new Date().getTime().toString(), {
        type: 'basic',
        iconUrl: 'assets/icons/favicon-48.png',
        title: 'Cant create hardware wallet on testnet',
        message
      });

      return;
    }

    window.trezorConnect.getAccountInfo({
      path,
      coin
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

      if (!HDsigner || !sjs) {
        const isTestnet = store.getState().wallet.activeNetwork === 'testnet';

        const backendURl: string = isTestnet ? SYS_NETWORK.testnet.beUrl : SYS_NETWORK.main.beUrl;

        HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, isTestnet);
        sjs = new sys.SyscoinJSLib(HDsigner, backendURl);

        const { activeAccountId, accounts } = store.getState().wallet;

        if (accounts.length > 1000) {
          return false;
        }

        for (let i = 1; i < accounts.length; i++) {
          if (i > 0 && accounts[i].isTrezorWallet) {
            console.log("Should not derive from hdsigner if the account is from the hardware wallet");

            return false;
          }

          const child = sjs.HDSigner.deriveAccount(i);

          sjs.HDSigner.accounts.push(new fromZPrv(child, sjs.HDSigner.pubTypes, sjs.HDSigner.networks));
          sjs.HDSigner.setAccountIndex(activeAccountId);
        }
      }

      password = pwd;
      mnemonic = decriptedMnemonic;

      account.getPrimaryAccount(password, sjs);

      const { activeAccountId, accounts } = store.getState().wallet;
      
      account.watchMemPool(accounts[activeAccountId]);

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

  const _getAccountDataByNetwork = async (sjs: any) => {
    const { activeAccountId, accounts } = store.getState().wallet;

    if (accounts.length > 1000) {
      return false;
    }

    for (let i = 0; i <= accounts.length; i++) {
      if (accounts[i] === undefined || accounts[i] === null) break;

      if (accounts[i].isTrezorWallet) {
        store.dispatch(removeAccount(i));
        store.dispatch(updateStatus());

        const message = 'Your device is being disconnected';

        chrome.notifications.create(new Date().getTime().toString(), {
          type: 'basic',
          iconUrl: 'assets/icons/favicon-48.png',
          title: 'Hardware Wallet removed due to network switch',
          message
        });

        return;
      }
      if (i !== 0) {

        const child = sjs.HDSigner.deriveAccount(i);
        const derived = new fromZPrv(child, sjs.HDSigner.pubTypes, sjs.HDSigner.networks);
        sjs.HDSigner.accounts.push(derived);
        // sjs.HDSigner.accountIndex = activeAccountId;
        sjs.HDSigner.setAccountIndex(activeAccountId)
        account.setNewXpub(i, derived.getAccountPublicKey(), derived.getAccountPrivateKey());
      }
      else {
        account.setNewXpub(i, sjs.HDSigner.accounts[i].getAccountPublicKey(), sjs.HDSigner.accounts[i].getAccountPrivateKey());
      }
    }

    account.getPrimaryAccount(password, sjs);

    await account.updateTokensState();
  }

  const switchNetwork = async (networkId: string) => {
    store.dispatch(changeActiveNetwork(SYS_NETWORK[networkId]!.id));

    const encriptedMnemonic = retrieveEncriptedMnemonic();
    const decriptedMnemonic = CryptoJS.AES.decrypt(encriptedMnemonic, password).toString(CryptoJS.enc.Utf8);

    if (!decriptedMnemonic) {
      throw new Error('password wrong');
    }

    if (SYS_NETWORK[networkId]!.id === 'main') {
      HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, false);
      sjs = new sys.SyscoinJSLib(HDsigner, SYS_NETWORK.main.beUrl);

      store.dispatch(updateSwitchNetwork(true));

      _getAccountDataByNetwork(sjs);

      return;
    }

    HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, true);
    sjs = new sys.SyscoinJSLib(HDsigner, SYS_NETWORK.testnet.beUrl);

    store.dispatch(updateSwitchNetwork(true));

    _getAccountDataByNetwork(sjs);
  };

  const getNewAddress = async () => {
    const { activeAccountId, accounts } = store.getState().wallet;
    let address = '';
    const userAccount: IAccountState = accounts.find((el: IAccountState) => el.id === activeAccountId);

    if (userAccount!.isTrezorWallet) {
      const res = await sys.utils.fetchBackendAccount(sjs.blockbookURL, userAccount.xpub, 'tokens=nonzero&details=txs', true);

      const account0 = new fromZPub(userAccount.xpub, sjs.HDSigner.pubTypes, sjs.HDSigner.networks);

      let receivingIndex = -1;

      if (res.tokens) {
        res.tokens.forEach((token: any) => {
          if (token.path) {
            const splitPath = token.path.split('/');

            if (splitPath.length >= 6) {
              const change = parseInt(splitPath[4], 10);
              const index = parseInt(splitPath[5], 10);

              if (change === 1) {
                console.log("Can't update it's change index");

                return;
              }

              if (index > receivingIndex) {
                receivingIndex = index
              }
            }
          }
        })
      }

      address = account0.getAddress(receivingIndex + 1);

      console.log("New address")
      console.log(address)
    } else {
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