import { sys, SYS_NETWORK } from 'constants/index';

import { generateMnemonic, validateMnemonic } from 'bip39';
import { fromZPrv, fromZPub } from 'bip84';
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

  const checkPassword = (pwd: string) => {
    return password === pwd;
  };

  const account = AccountController({ checkPassword });

  const isLocked = () => {
    return !password || !mnemonic;
  };

  const retrieveEncriptedMnemonic = () => {
    // not encrypted for now but we got to retrieve
    const { encriptedMnemonic }: IWalletState = store.getState().wallet;

    return encriptedMnemonic !== ''
      ? encriptedMnemonic
      : null;
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

    account.subscribeAccount(false, sjs, undefined, true).then(() => {
      account.getPrimaryAccount(password, sjs);

      account.updateTokensState().then(() => {
        console.log('update tokens state after create wallet')
      })
    })
  };

  const createHardwareWallet = async () => {
    const isTestnet = store.getState().wallet.activeNetwork === 'testnet';
    
    if (isTestnet) {
      console.log('trying to display testnet message')
      const message = "Trezor doesn't support SYS testnet";
      chrome.notifications.create(new Date().getTime().toString(), {
        type: 'basic',
        iconUrl: 'assets/icons/favicon-48.png',
        title: 'Cant create hardware wallet on testnet',
        message
      });
      return
    }
    try{

    const TrezorSigner =  new sys.utils.TrezorSigner();
    console.log(TrezorSigner)
    // const myacc = await TrezorSigner.createAccount();
    TrezorSigner.createAccount().then((myacc : number) => {
      console.log('Created trezor wallet')
      const message = `Trezor Wallet Account Created`;
        chrome.notifications.create(new Date().getTime().toString(), {
          type: 'basic',
          iconUrl: 'assets/icons/favicon-48.png',
          title: 'Hardware Wallet connected',
          message,
        });
        console.log(myacc)
        console.log(TrezorSigner)
        console.log(TrezorSigner.getAccountXpub())
        account.subscribeAccount(true, TrezorSigner);
    }).catch((err : any) => {
      console.log('error trezor wallet')
      const message = `Trezor Error: ${err}`;
        chrome.notifications.create(new Date().getTime().toString(), {
          type: 'basic',
          iconUrl: 'assets/icons/favicon-48.png',
          title: 'Hardware Wallet error',
          message,
        });
    });
    }
    catch(e){
      console.log('error trezor wallet | bad hardcore error')
          const message = `Error: ${e}`;
        chrome.notifications.create(new Date().getTime().toString(), {
          type: 'basic',
          iconUrl: 'assets/icons/favicon-48.png',
          title: 'Hardware Wallet connected',
          message,
        });
        
    }
  }




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
      console.log('Unlocking')
      console.log('Unlocking')
      console.log('Unlocking')
      console.log('Unlocking')
      console.log('Unlocking')
      console.log('Unlocking')
      console.log('Unlocking')
      console.log('Unlocking')
      console.log('Unlocking')

      if (HDsigner === null || sjs === null) {
        console.log('Recreating wallet')
        const isTestnet = store.getState().wallet.activeNetwork === 'testnet';

        const backendURl: string = store.getState().wallet.activeNetwork === 'testnet' ? SYS_NETWORK.testnet.beUrl : SYS_NETWORK.main.beUrl;
        console.log(backendURl)
        HDsigner = new sys.utils.HDSigner(decriptedMnemonic, null, isTestnet, sys.utils.syscoinNetworks, 57, sys.utils.syscoinZPubTypes);
        console.log(HDsigner)
        sjs = new sys.SyscoinJSLib(HDsigner, backendURl);

        const { activeAccountId, accounts } = store.getState().wallet;

        if (accounts.length > 1000) {
          return false;
        }

        for (let i = 1; i < accounts.length; i++) {
          if (i > 0 && accounts[i].isTrezorWallet) {
            console.log("Should not derive from hdsigner if the account is from the hardware wallet");
          }
          else{

            const child = sjs.Signer.deriveAccount(i);

            sjs.Signer.Signer.accounts.push(new fromZPrv(child, sjs.Signer.Signer.pubTypes, sjs.Signer.Signer.networks));
            // sjs.Signer.accountIndex = activeAccountId;
            sjs.Signer.setAccountIndex(activeAccountId)
          }
        }
      }

      password = pwd;
      mnemonic = decriptedMnemonic;

      account.getPrimaryAccount(password, sjs);

      const { accounts, activeAccountId } = store.getState().wallet;

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

  const _getAccountDataByNetwork = (sjs: any) => {
    const { activeAccountId, accounts } = store.getState().wallet;

    if (accounts.length > 1000) {
      return false;
    }
    const ToRemoveWalletIds : any = [];
    for (let i = 0; i <= accounts.length; i++) {
      if (accounts[i] === undefined || accounts[i] === null) break;

      if (accounts[i].isTrezorWallet) {
        ToRemoveWalletIds.push(accounts[i].id);
        // console.log(accounts[i])
        // store.dispatch(removeAccount(i));
        // store.dispatch(updateStatus());

        // const message = 'Your device is being disconnected';

        // chrome.notifications.create(new Date().getTime().toString(), {
        //   type: 'basic',
        //   iconUrl: 'assets/icons/favicon-48.png',
        //   title: 'Hardware Wallet removed due to network switch',
        //   message
        // });

      }
      else{
        if (i !== 0) {

          const child = sjs.Signer.deriveAccount(i);
          const derived = new fromZPrv(child, sjs.Signer.Signer.pubTypes, sjs.Signer.Signer.networks);
          sjs.Signer.Signer.accounts.push(derived);
          // sjs.Signer.accountIndex = activeAccountId;
          sjs.Signer.setAccountIndex(activeAccountId)
          account.setNewXpub(i, derived.getAccountPublicKey(), derived.getAccountPrivateKey());
        }
        else {
          account.setNewXpub(i, sjs.Signer.Signer.accounts[i].getAccountPublicKey(), sjs.Signer.Signer.accounts[i].getAccountPrivateKey());
        }
      }
    }

    if(ToRemoveWalletIds.length > 0){
      console.log(ToRemoveWalletIds)
      for (let i = 0; i < ToRemoveWalletIds.length; i++) {
        console.log('dont be weitd')
        console.log(ToRemoveWalletIds[i])
        store.dispatch(removeAccount(ToRemoveWalletIds[i]));
        store.dispatch(updateStatus());

        const message = 'Your device is being disconnected';

        chrome.notifications.create(new Date().getTime().toString(), {
          type: 'basic',
          iconUrl: 'assets/icons/favicon-48.png',
          title: 'Hardware Wallet removed due to network switch',
          message
        });
      }
    }
       


    account.getPrimaryAccount(password, sjs);

    account.updateTokensState().then(() => {
      console.log('tokens state updated')
    });
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

      const account0 = new fromZPub(userAccount.xpub, sjs.Signer.Signer.pubTypes, sjs.Signer.Signer.networks);

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
      sjs.Signer.Signer.receivingIndex = -1;
      address = await sjs.Signer.getNewReceivingAddress();
      console.log('new address received')
      console.log(address)
      console.log(sjs)
      console.log("Receiving Index :")
      console.log(sjs.Signer.Signer.receivingIndex)
    }

    return account.setNewAddress(address);
  }

  // const account = AccountController({ checkPassword });

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