import { generateMnemonic, validateMnemonic } from 'bip39';
import { fromZPrv, fromZPub } from 'bip84';
import CryptoJS from 'crypto-js';
import store from 'state/store';
import axios from 'axios';
import { IWalletController } from 'types/controllers';
import { log, logError, openNotificationsPopup } from 'utils/index';

import AccountController from './accController';
import TrezorController from './TrezorController';
import {
  forgetWallet as forgetWalletState,
  setLastLogin,
  setEncryptedMnemonic,
  setActiveNetwork,
  setIsPendingBalances,
  setActiveAccount,
  removeAccounts,
  removeAccount,
} from 'state/vault';
import { setHdSigner, setMainSigner } from 'state/signer';
import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';

const sys = require('syscoinjs-lib');

const WalletController = (): IWalletController => {
  let password: any = '';
  let encryptedPassword: any = '';
  let mnemonic = '';
  let HDsigner: any = null;
  let sjs: any = null;

  const setHDsigner = ({
    walletMnemonic,
    walletPassword,
    isTestnet,
    networks,
    SLIP44,
    pubTypes,
  }: any) => {
    HDsigner = new sys.utils.HDsigner(
      walletMnemonic,
      walletPassword,
      isTestnet,
      networks,
      SLIP44,
      pubTypes
    );

    setHdSigner(HDsigner);
  };

  const setSjs = ({ SignerIn, blockbookURL, network }: any) => {
    sjs = new sys.SyscoinJSLib(SignerIn, blockbookURL, network);
    setMainSigner(sjs);
  };

  const setWalletPassword = (pwd: string) => {
    password = pwd;
    encryptedPassword = CryptoJS.SHA3(pwd).toString();
  };

  const checkPassword = (pwd: string) => {
    if (encryptedPassword === CryptoJS.SHA3(pwd).toString()) {
      return true;
    }

    return encryptedPassword === pwd;
  };

  const account = AccountController({ checkPassword });
  const trezor = TrezorController({ account });

  const retrieveEncriptedMnemonic = () => {
    // not encrypted for now but we got to retrieve
    const { encryptedMnemonic } = store.getState().vault;

    return encryptedMnemonic !== '' ? encryptedMnemonic : null;
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

    const { activeNetwork } = store.getState().vault;

    setHDsigner({
      walletMnemonic: mnemonic,
      walletPassword: null,
      isTestnet: false,
    });
    setSjs({ SignerIn: HDsigner, blockbookURL: activeNetwork.url });

    if (isUpdated) {
      const { accounts } = store.getState().vault;

      if (accounts) {
        store.dispatch(removeAccounts());
      }
    }

    const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, password);

    store.dispatch(setEncryptedMnemonic(String(encryptedMnemonic)));

    account.subscribeAccount(false, sjs, undefined, true).then(() => {
      account.getPrimaryAccount(password, sjs);
      password = '';
      mnemonic = '';

      account.updateTokensState().then(() => {
        log('update tokens state after create wallet');
      });
    });
  };

  const getPhrase = (pwd: string) =>
    checkPassword(pwd) ? HDsigner.mnemonic : null;

  const unLock = async (pwd: string) => {
    try {
      const encryptedMnemonic = retrieveEncriptedMnemonic();
      const decriptedMnemonic = CryptoJS.AES.decrypt(
        String(encryptedMnemonic),
        pwd
      ).toString(CryptoJS.enc.Utf8);

      if (!decriptedMnemonic) {
        throw new Error('password wrong');
      }

      const { activeAccount, accounts } = store.getState().vault;

      if (!HDsigner || !sjs) {
        const response = await axios.get(
          `${store.getState().vault.activeNetwork.url}/api/v2`
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

            setHDsigner({
              walletMnemonic: decriptedMnemonic,
              walletPassword: null,
              isTestnet,
              networks: sys.utils.syscoinNetworks,
              SLIP44: 57,
              pubTypes: sys.utils.syscoinZPubTypes,
            });
            setSjs({
              SignerIn: HDsigner,
              blockbookURL: store.getState().vault.activeNetwork.url,
            });
          }
        }

        if (accounts) {
          return false;
        }

        for (let i = 1; i < Object.values(accounts).length; i++) {
          if (false) {
            log(
              'Should not derive from HDsigner if the account is from the hardware wallet'
            );
          } else {
            const child = sjs.Signer.deriveAccount(i);
            HDsigner.accounts.push(
              new fromZPrv(child, HDsigner.pubTypes, HDsigner.networks)
            );
            sjs.Signer.setAccountIndex(activeAccount.id);
          }
        }
      }

      encryptedPassword = CryptoJS.SHA3(pwd).toString();

      account.getPrimaryAccount(pwd, sjs);

      account.watchMemPool(accounts[activeAccount.id]);

      return true;
    } catch (error) {
      return false;
    }
  };

  const forgetWallet = (pwd: string) => {
    if (checkPassword(pwd)) {
      password = '';
      encryptedPassword = '';
      mnemonic = '';
      HDsigner = null;
      sjs = null;

      store.dispatch(forgetWalletState());
      store.dispatch(setLastLogin());
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
    // todo: vault
    const { accounts } = store.getState().vault;

    // const acc = accounts.find((account) => account.id === id);

    store.dispatch(setActiveAccount(accounts[id]));
    account.getLatestUpdate();
  };

  const logOut = () => {
    password = '';
    encryptedPassword = '';
    mnemonic = '';
    store.dispatch(setLastLogin());
  };

  const checkAndSetNewXpub = (index: number, activeAccountId: number) => {
    if (Number(index) === 0) {
      account.setNewXpub(
        HDsigner.accounts[Number(index)].getAccountPublicKey(),
        HDsigner.accounts[Number(index)].getAccountPrivateKey(),
        encryptedPassword
      );

      return;
    }

    const child = sjs.Signer.deriveAccount(Number(index));
    const derived = new fromZPrv(child, HDsigner.pubTypes, HDsigner.networks);

    HDsigner.accounts.push(derived);
    sjs.Signer.setAccountIndex(activeAccountId);

    account.setNewXpub(
      derived.getAccountPublicKey(),
      derived.getAccountPrivateKey(),
      encryptedPassword
    );
  };

  const checkAndSeparateTrezorAccounts = (
    accounts: Array<IKeyringAccountState>,
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
    account.subscribeAccount(false, null, label, false);

  const getAccountDataByNetwork = (currentSysInstance: any) => {
    const { activeAccount, accounts } = store.getState().vault;

    if (accounts) {
      return false;
    }

    const accountsToBeRemoved: number[] = [];

    if (accounts) {
      for (const index in Object.values(accounts)) {
        if (!accounts[index]) return;

        checkAndSeparateTrezorAccounts(
          accounts,
          Number(index),
          activeAccount.id,
          accountsToBeRemoved
        );
      }
    }

    if (accountsToBeRemoved) {
      for (const id of accountsToBeRemoved) {
        // store.dispatch(removeConnection({ accountId: id }));
        store.dispatch(removeAccount({ id: Number(id) }));
        store.dispatch(setLastLogin());

        openNotificationsPopup(
          'Hardware Wallet removed due to network switch',
          'Your device is being disconnected'
        );
      }
    }

    account.getPrimaryAccount(encryptedPassword, currentSysInstance);

    account.updateTokensState().then(() => {
      log('tokens state updated after removing trezor');
    });
  };

  // todo: switch network vault state
  const switchNetwork = async (networkId: number, prefix: string) => {
    const { networks } = store.getState().vault;

    store.dispatch(
      setActiveNetwork({
        chainId: networkId,
        label: networks[prefix].label,
        default: networks[prefix].default,
        url: networks[prefix].url,
      })
    );

    try {
      const response = await axios.get(
        `${networks.syscoin[networkId].url}/api/v2`
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

          setHDsigner({
            walletMnemonic: HDsigner.mnemonic,
            walletPassword: null,
            isTestnet,
          });
          setSjs({
            SignerIn: HDsigner,
            blockbookURL: networks.syscoin[networkId].url,
          });

          store.dispatch(setIsPendingBalances(true));

          getAccountDataByNetwork(sjs);
        }

        return;
      }
    } catch (error) {
      throw new Error('Invalid network.');
    }
  };

  const getNewAddress = async () => {
    const { activeAccount } = store.getState().vault;

    let address = '';

    if (activeAccount?.isTrezorWallet) {
      const res = await sys.utils.fetchBackendAccount(
        sjs.blockbookURL,
        activeAccount.xpub,
        'tokens=nonzero&details=txs',
        true
      );

      const account0 = new fromZPub(
        activeAccount.xpub,
        HDsigner.pubTypes,
        HDsigner.networks
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
                logError("Can't update it's change index", 'Transaction');
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
        logError('Failed to get receiving address');

        throw new Error(error);
      }
    }

    return account.setNewAddress(address);
  };

  return {
    account,
    setWalletPassword,
    generatePhrase,
    createWallet,
    checkPassword,
    getPhrase,
    forgetWallet,
    importPhrase,
    unLock,
    switchWallet,
    switchNetwork,
    getNewAddress,
    logOut,
    addNewAccount,
    password,
    mnemonic,
    encryptedPassword,
    trezor,
  };
};

export default WalletController;
