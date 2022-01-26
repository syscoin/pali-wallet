import { generateMnemonic, validateMnemonic } from 'bip39';
import { fromZPrv, fromZPub } from 'bip84';
import {
  deleteWallet as deleteWalletState,
  changeAccountActiveId,
  changeActiveNetwork,
  updateStatus,
  setEncriptedMnemonic,
  removeAccounts,
  removeAccount,
  updateSwitchNetwork,
  // removeConnection,
} from 'state/wallet';
import IWalletState, { IAccountState } from 'state/wallet/types';
import CryptoJS from 'crypto-js';
import store from 'state/store';
import axios from 'axios';
import { IWalletController } from 'types/controllers';

import AccountController from './AccountController';

const sys = require('syscoinjs-lib');

const WalletController = (): IWalletController => {
  let password: any = '';
  let encriptedPassword: any = '';
  let mnemonic = '';
  let HDsigner: any = null;
  let sjs: any = null;

  const setHDSigner = ({
    walletMnemonic,
    walletPassword,
    isTestnet,
    networks,
    SLIP44,
    pubTypes,
  }: any) => {
    HDsigner = new sys.utils.HDSigner(
      walletMnemonic,
      walletPassword,
      isTestnet,
      networks,
      SLIP44,
      pubTypes
    );
  };

  const setSjs = ({ SignerIn, blockbookURL, network }: any) => {
    sjs = new sys.SyscoinJSLib(SignerIn, blockbookURL, network);
  };

  const setWalletPassword = (pwd: string) => {
    password = pwd;
    encriptedPassword = CryptoJS.SHA3(pwd).toString();
  };

  const checkPassword = (pwd: string) => {
    if (encriptedPassword === CryptoJS.SHA3(pwd).toString()) {
      return true;
    }

    return encriptedPassword === pwd;
  };

  const account = AccountController({ checkPassword });

  const isLocked = () => !encriptedPassword || !HDsigner;

  const retrieveEncriptedMnemonic = () => {
    // not encrypted for now but we got to retrieve
    const { encriptedMnemonic }: IWalletState = store.getState().wallet;

    return encriptedMnemonic !== '' ? encriptedMnemonic : null;
  };

  const generatePhrase = () => {
    if (retrieveEncriptedMnemonic()) {
      return null;
    }

    if (!mnemonic) mnemonic = generateMnemonic();

    return mnemonic;
  };

  const createWallet = (isUpdated = false) => {
    if (!isUpdated && sjs) {
      return;
    }

    const { networks } = store.getState().wallet;

    setHDSigner({
      walletMnemonic: mnemonic,
      walletPassword: null,
      isTestnet: false,
    });
    setSjs({ SignerIn: HDsigner, blockbookURL: networks.main.beUrl });

    if (isUpdated) {
      const { accounts } = store.getState().wallet;

      if (accounts) {
        store.dispatch(removeAccounts());
      }
    }

    const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, password);

    store.dispatch(setEncriptedMnemonic(encryptedMnemonic));

    account
      .subscribeAccount(encriptedPassword, false, sjs, undefined, true)
      .then(() => {
        account.getPrimaryAccount(password, sjs);
        password = '';
        mnemonic = '';

        account.updateTokensState().then(() => {
          console.log('update tokens state after create wallet');
        });
      });
  };

  const openNotificationsPopup = (title: string, message: string) => {
    chrome.notifications.create(new Date().getTime().toString(), {
      type: 'basic',
      iconUrl: 'assets/icons/favicon-48.png',
      title,
      message,
    });
  };

  const createHardwareWallet = async () => {
    const isTestnet = store.getState().wallet.activeNetwork === 'testnet';

    if (isTestnet) {
      openNotificationsPopup(
        "Can't create hardware wallet on testnet",
        "Trezor doesn't support SYS testnet"
      );

      return;
    }

    try {
      const TrezorSigner = new sys.utils.TrezorSigner();

      TrezorSigner.createAccount()
        .then(async () => {
          openNotificationsPopup(
            'Hardware Wallet connected',
            'Trezor Wallet account created'
          );

          await account.subscribeAccount(
            encriptedPassword,
            true,
            TrezorSigner,
            undefined,
            false
          );
          await account.updateTokensState();
        })
        .catch((error: any) => {
          openNotificationsPopup(
            'Hardware Wallet error',
            `Trezor Error: ${error}`
          );
        });
    } catch (error) {
      openNotificationsPopup('Hardware Wallet error', `Trezor Error: ${error}`);
    }
  };

  const getPhrase = (pwd: string) =>
    checkPassword(pwd) ? HDsigner.mnemonic : null;

  const unLock = async (pwd: string) => {
    try {
      const encriptedMnemonic = retrieveEncriptedMnemonic();
      const decriptedMnemonic = CryptoJS.AES.decrypt(
        encriptedMnemonic,
        pwd
      ).toString(CryptoJS.enc.Utf8);

      if (!decriptedMnemonic) {
        throw new Error('password wrong');
      }

      const { activeAccountId, accounts } = store.getState().wallet;

      if (!HDsigner || !sjs) {
        const response = await axios.get(
          `${store.getState().wallet.currentBlockbookURL}/api/v2`
        );

        const { blockbook, backend } = response.data;

        if (response && blockbook && backend) {
          let isTestnet = false;

          if (
            blockbook.coin === 'Syscoin' ||
            blockbook.coin === 'Syscoin Testnet'
          ) {
            if (backend.chain === 'main') {
              isTestnet = false;
            }

            if (backend.chain === 'test') {
              isTestnet = true;
            }

            setHDSigner({
              walletMnemonic: decriptedMnemonic,
              walletPassword: null,
              isTestnet,
              networks: sys.utils.syscoinNetworks,
              SLIP44: 57,
              pubTypes: sys.utils.syscoinZPubTypes,
            });
            setSjs({
              SignerIn: HDsigner,
              blockbookURL: store.getState().wallet.currentBlockbookURL,
            });
          }
        }

        if (accounts.length > 1000) {
          return false;
        }

        for (let i = 1; i < accounts.length; i++) {
          if (i > 0 && accounts[i].isTrezorWallet) {
            console.log(
              'Should not derive from hdsigner if the account is from the hardware wallet'
            );
          } else {
            const child = sjs.Signer.deriveAccount(i);
            sjs.Signer.Signer.accounts.push(
              new fromZPrv(
                child,
                sjs.Signer.Signer.pubTypes,
                sjs.Signer.Signer.networks
              )
            );
            sjs.Signer.setAccountIndex(activeAccountId);
          }
        }
      }

      encriptedPassword = CryptoJS.SHA3(pwd).toString();

      account.getPrimaryAccount(pwd, sjs);

      account.watchMemPool(accounts[activeAccountId]);

      return true;
    } catch (error) {
      return false;
    }
  };

  const deleteWallet = (pwd: string) => {
    if (checkPassword(pwd)) {
      password = '';
      encriptedPassword = '';
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
    encriptedPassword = '';
    mnemonic = '';
    store.dispatch(updateStatus());
  };

  const checkAndSetNewXpub = (index: number, activeAccountId: number) => {
    if (Number(index) === 0) {
      account.setNewXpub(
        Number(index),
        sjs.Signer.Signer.accounts[Number(index)].getAccountPublicKey(),
        sjs.Signer.Signer.accounts[Number(index)].getAccountPrivateKey(),
        encriptedPassword
      );

      return;
    }

    const child = sjs.Signer.deriveAccount(Number(index));
    const derived = new fromZPrv(
      child,
      sjs.Signer.Signer.pubTypes,
      sjs.Signer.Signer.networks
    );

    sjs.Signer.Signer.accounts.push(derived);
    sjs.Signer.setAccountIndex(activeAccountId);

    account.setNewXpub(
      Number(index),
      derived.getAccountPublicKey(),
      derived.getAccountPrivateKey(),
      encriptedPassword
    );
  };

  const checkAndSeparateTrezorAccounts = (
    accounts: Array<IAccountState>,
    index: number,
    activeAccountId: number,
    accountsToBeRemoved: number[]
  ) => {
    if (!accounts[index].isTrezorWallet) {
      checkAndSetNewXpub(Number(index), activeAccountId);

      return;
    }

    // accountsToBeRemoved[accounts[index].id] = accounts[index].id;
    accountsToBeRemoved.push(accounts[index].id);
  };

  const addNewAccount = (label?: string) =>
    account.subscribeAccount(encriptedPassword, false, null, label, false);

  const getAccountDataByNetwork = (currentSysInstance: any) => {
    const { activeAccountId, accounts } = store.getState().wallet;

    if (accounts.length > 1000) {
      return false;
    }

    const accountsToBeRemoved: number[] = [];

    if (accounts) {
      for (const index in accounts) {
        if (!accounts[index]) return;

        checkAndSeparateTrezorAccounts(
          accounts,
          Number(index),
          activeAccountId,
          accountsToBeRemoved
        );
      }
    }

    if (accountsToBeRemoved) {
      for (const id of accountsToBeRemoved) {
        // store.dispatch(removeConnection({ accountId: id }));
        store.dispatch(removeAccount(Number(id)));
        store.dispatch(updateStatus());

        openNotificationsPopup(
          'Hardware Wallet removed due to network switch',
          'Your device is being disconnected'
        );
      }
    }

    account.getPrimaryAccount(encriptedPassword, currentSysInstance);

    account.updateTokensState().then(() => {
      console.log('tokens state updated after remove trezor');
    });
  };

  const switchNetwork = async (networkId: string) => {
    const { networks } = store.getState().wallet;

    store.dispatch(changeActiveNetwork(networks[networkId]));

    try {
      const response = await axios.get(`${networks[networkId].beUrl}/api/v2`);
      const { blockbook, backend } = response.data;

      if (response && blockbook && backend) {
        let isTestnet = false;

        if (
          blockbook.coin === 'Syscoin' ||
          blockbook.coin === 'Syscoin Testnet'
        ) {
          if (backend.chain === 'main') {
            isTestnet = false;
          }

          if (backend.chain === 'test') {
            isTestnet = true;
          }

          setHDSigner({
            walletMnemonic: HDsigner.mnemonic,
            walletPassword: null,
            isTestnet,
          });
          setSjs({
            SignerIn: HDsigner,
            blockbookURL: networks[networkId].beUrl,
          });

          store.dispatch(updateSwitchNetwork(true));

          getAccountDataByNetwork(sjs);
        }

        return;
      }
    } catch (error) {
      throw new Error('Invalid network.');
    }
  };

  const getNewAddress = async () => {
    const { activeAccountId, accounts } = store.getState().wallet;

    const userAccount: IAccountState = accounts.find(
      (el: IAccountState) => el.id === activeAccountId
    );
    let address = '';

    if (userAccount?.isTrezorWallet) {
      const res = await sys.utils.fetchBackendAccount(
        sjs.blockbookURL,
        userAccount.xpub,
        'tokens=nonzero&details=txs',
        true
      );

      const account0 = new fromZPub(
        userAccount.xpub,
        sjs.Signer.Signer.pubTypes,
        sjs.Signer.Signer.networks
      );

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
                receivingIndex = index;
              }
            }
          }
        });
      }

      address = account0.getAddress(receivingIndex + 1);
    } else {
      try {
        address = await sjs.Signer.getNewReceivingAddress(true);
      } catch (error: any) {
        console.log('error getting receiving address from sysjs', error);

        throw new Error(error);
      }
    }

    return account.setNewAddress(address);
  };

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
    logOut,
    addNewAccount,
    password,
    mnemonic,
    encriptedPassword,
  };
};

export default WalletController;
