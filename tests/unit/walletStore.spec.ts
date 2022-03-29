import CryptoJS from 'crypto-js';
import reducer, {
  changeAccountActiveId,
  changeActiveNetwork,
  clearAllTransactions,
  createAccount,
  forgetWallet,
  initialState,
  removeAccount,
  removeAccounts,
  removeConnection,
  setEncriptedMnemonic,
  setSenderURL,
  updateAccount,
  updateAccountAddress,
  updateAccountXpub,
  updateAllTokens,
  updateCanConfirmTransaction,
  updateCanConnect,
  updateConnectionsArray,
  updateCurrentURL,
  updateLabel,
  updateNetwork,
  updateSwitchNetwork,
  updateTransactions,
  setTimer,
  setTemporaryTransactionState,
  updateStatus,
} from 'state/wallet';
import IWalletState, {
  Connection,
  IAccountState,
  INetwork,
  IAccountUpdateAddress,
  IAccountUpdateState,
  IAccountUpdateXpub,
  IWalletTokenState,
} from 'state/wallet/types';

import {
  FAKE_ACCOUNT,
  FAKE_ASSETS,
  FAKE_CONNECTION,
  FAKE_TAB,
  FAKE_TRANSACTIONS,
  FAKE_XPUB,
  STATE_W_ACCOUNT,
} from '../mocks';

//* ----- Tests -----

describe('Wallet store actions', () => {
  it('should return the initial state', () => {
    expect(reducer(undefined, { type: undefined })).toEqual(initialState);
  });

  //* updateNetwork
  describe('updateNetwork method', () => {
    it('should update an existing network', () => {
      const payload: INetwork = {
        beUrl: 'https://this-is-an.url',
        chainId: 57,
        id: 'main',
        label: 'CoinLabel',
        type: 'syscoin',
      };

      const newState = reducer(initialState, updateNetwork(payload));

      expect(newState.networks[payload.id]).toEqual(payload);
    });

    it('should create a network', () => {
      const payload: INetwork = {
        beUrl: 'https://this-is-an.url',
        chainId: 57,
        id: 'somenet',
        label: 'CoinLabel',
        type: 'syscoin',
      };

      const newState = reducer(initialState, updateNetwork(payload));

      expect(newState.networks[payload.id]).toEqual(payload);
    });
  });

  //* setTimer
  it('should set the timer', () => {
    const payload = 10;
    const newState = reducer(initialState, setTimer(payload));

    expect(newState.timer).toEqual(payload);
  });

  //* updateAllTokens
  describe('updateAllTokens method. create/update [walletTokens]', () => {
    // same payload for tests
    const payload: IWalletTokenState = {
      accountId: FAKE_ACCOUNT.id,
      accountXpub: FAKE_XPUB,
      // unidentified type
      holdings: [
        {
          data: 'value',
          info: 'content',
        },
      ],
      mintedTokens: [
        {
          assetGuid: 'guid1',
          symbol: 'symbol',
          maxSupply: 2,
          totalSupply: 5, // random numbers
        },
      ],
      tokens: {
        guid0: FAKE_ASSETS[0],
        guid1: FAKE_ASSETS[1],
      },
    };

    it('should add a token', () => {
      const newState = reducer(initialState, updateAllTokens(payload));

      expect(newState.walletTokens).toContain(payload);
    });

    it('should update an existent token', () => {
      const fakeToken: IWalletTokenState = {
        accountId: FAKE_ACCOUNT.id,
        accountXpub: FAKE_XPUB,
        holdings: [],
        mintedTokens: [],
        tokens: {
          guid0: FAKE_ASSETS[0],
        },
      };

      // state with token
      const customState: IWalletState = {
        ...initialState,
        walletTokens: [fakeToken],
      };

      const newState = reducer(customState, updateAllTokens(payload));

      expect(newState.walletTokens).toContainEqual(payload);
    });
  });

  //* clearAllTransactions
  it('should clear all transactions [temporaryTransactionState]', () => {
    const newState = reducer(initialState, clearAllTransactions());

    expect(newState.temporaryTransactionState).toEqual({
      executing: false,
      type: '',
    });
  });

  //* updateSwitchNetwork
  it('should update switch network [changingNetwork]', () => {
    const payload = true;
    const newState = reducer(initialState, updateSwitchNetwork(payload));

    expect(newState.changingNetwork).toEqual(true);
  });

  //* updateCanConfirmTransaction
  it('should update can confirm transaction [confirmingTransaction]', () => {
    const payload = true;
    const newState = reducer(
      initialState,
      updateCanConfirmTransaction(payload)
    );

    expect(newState.confirmingTransaction).toEqual(true);
  });

  //* setTemporaryTransactionState
  it('should set [temporaryTransactionState]', () => {
    const payload = {
      executing: true,
      type: '',
    };

    const newState = reducer(
      initialState,
      setTemporaryTransactionState(payload)
    );

    expect(newState.temporaryTransactionState).toEqual(payload);
  });

  //* removeConnection
  it('should remove a connection', () => {
    const payload: Connection = FAKE_CONNECTION;

    // state with an account and tab
    const customState: IWalletState = {
      ...STATE_W_ACCOUNT,
      tabs: FAKE_TAB,
    };

    const newState = reducer(customState, removeConnection(payload));

    expect(newState.accounts[0].connectedTo).not.toContain(payload.url);

    expect(newState.tabs.connections).not.toContain(payload);
  });

  //* updateConnectionsArray
  describe('updateConnectionsArray method', () => {
    it('should create a connection', () => {
      const fakeAccount: IAccountState = {
        ...FAKE_ACCOUNT,
        connectedTo: [],
      };

      const payload: Connection = {
        accountId: fakeAccount.id,
        url: 'https://sysmint.paliwallet.com',
      };

      // state with an account
      const customState: IWalletState = {
        ...initialState,
        accounts: [fakeAccount],
      };

      const newState = reducer(customState, updateConnectionsArray(payload));

      // remove the 'https://'
      payload.url = payload.url.replace(/(^\w+:|^)\/\//, '');

      expect(newState.tabs.connections).toContainEqual(payload);
      expect(newState.accounts[0].connectedTo).toContainEqual(payload.url);
    });

    it('should remove the existent connection and create a new one', () => {
      // FAKE_ACCOUNT is connected to the url
      // fakeAccount will replace the connection

      const fakeAccount: IAccountState = {
        ...FAKE_ACCOUNT,
        connectedTo: [],
        id: 2,
      };

      const payload: Connection = {
        accountId: fakeAccount.id,
        url: 'https://sysmint.paliwallet.com',
      };

      // state with an account and tab
      const customState: IWalletState = {
        ...initialState,
        accounts: [FAKE_ACCOUNT, fakeAccount],
        tabs: FAKE_TAB,
      };

      const newState = reducer(customState, updateConnectionsArray(payload));

      // remove the 'https://'
      payload.url = payload.url.replace(/(^\w+:|^)\/\//, '');

      const previousConnection = customState.tabs.connections[0];

      expect(newState.tabs.connections).not.toContainEqual(previousConnection);
      expect(newState.tabs.connections).toContainEqual(payload);

      expect(newState.accounts[0].connectedTo).not.toContainEqual(payload.url);
      expect(newState.accounts[1].connectedTo).toContainEqual(payload.url);
      // expect
    });

    it('should not duplicate a connection', () => {
      // state with a connection
      const customState: IWalletState = {
        ...initialState,
        accounts: [FAKE_ACCOUNT],
        tabs: FAKE_TAB,
      };

      // duplicated connection. equals FAKE_CONNECTION
      const payload: Connection = {
        accountId: FAKE_ACCOUNT.id,
        url: 'https://sysmint.paliwallet.com',
      };

      const newState = reducer(customState, updateConnectionsArray(payload));

      // expect to have the same length as before
      expect(newState.tabs.connections).toHaveLength(
        customState.tabs.connections.length
      );
    });
  });

  //* updateCanConnect
  it('should update [tabs.canConnect]', () => {
    const payload = true;
    const newState = reducer(initialState, updateCanConnect(payload));

    expect(newState.tabs.canConnect).toEqual(payload);
  });

  //* updateCurrentURL
  it('should update [tabs.currentURL]', () => {
    const payload = 'url://thisisan.url';
    const newState = reducer(initialState, updateCurrentURL(payload));

    expect(newState.tabs.currentURL).toEqual(payload);
  });

  //* setSenderURL
  it('should set sender url [currentSenderURL]', () => {
    const payload = 'url://thisisan.url';
    const newState = reducer(initialState, setSenderURL(payload));

    expect(newState.tabs.currentSenderURL).toEqual(payload);
  });

  //* setEncriptedMnemonic
  it('should set the [encriptedMnemonic]', () => {
    const fakeMnemonic =
      'buffalo parade cotton festival trap gap judge slush wall top tired club';
    const fakePassword = 'st0rngp@ssword';

    // encryptedMnemonic
    const payload = CryptoJS.AES.encrypt(fakeMnemonic, fakePassword);

    const newState = reducer(initialState, setEncriptedMnemonic(payload));

    expect(newState.encriptedMnemonic).toEqual(payload.toString());
  });

  //* updateStatus
  it('should update the [status] to current datetime', () => {
    const startTime = Date.now();
    const newState = reducer(initialState, updateStatus());

    expect(newState.status).toBeGreaterThanOrEqual(startTime);
    expect(newState.status).toBeLessThanOrEqual(Date.now());
  });

  //* createAccount
  it('should create an account', () => {
    const payload: IAccountState = FAKE_ACCOUNT;

    const newState = reducer(initialState, createAccount(payload));

    expect(newState.accounts).toContain(payload);
  });

  //* removeAccount
  it('should remove an account', () => {
    const fakeAccount1: IAccountState = FAKE_ACCOUNT;
    const fakeAccount2: IAccountState = {
      ...FAKE_ACCOUNT,
      id: 27,
    };

    // create a state where there are accounts to be removed
    let customState: IWalletState = {
      ...initialState,
      accounts: [fakeAccount1],
    };

    const payload = FAKE_ACCOUNT.id; // accountId
    let newState = reducer(customState, removeAccount(payload));

    // when there is only one account, should not be remove
    expect(newState.accounts).toContain(fakeAccount1);

    // add second account
    customState = {
      ...customState,
      accounts: [fakeAccount1, fakeAccount2],
    };

    // with two accounts, remove one
    newState = reducer(customState, removeAccount(payload));

    expect(newState.accounts).not.toContain(fakeAccount1);
    expect(newState.accounts).toContain(fakeAccount2);
  });

  //* removeAccounts
  it('should remove all accounts', () => {
    const newState = reducer(initialState, removeAccounts());

    expect(newState.accounts).toEqual([]);
    expect(newState.activeAccountId).toEqual(0);
  });

  //* updateAccount
  it('should update an account [assets, transactions, balance]', () => {
    const payload: IAccountUpdateState = {
      assets: FAKE_ASSETS,
      balance: 0.57316579,
      id: FAKE_ACCOUNT.id,
      transactions: FAKE_TRANSACTIONS,
    };

    const newState = reducer(STATE_W_ACCOUNT, updateAccount(payload));

    const updatedAccount = newState.accounts[0];
    expect(updatedAccount.assets).toEqual(payload.assets);
    expect(updatedAccount.balance).toEqual(payload.balance);
    expect(updatedAccount.transactions).toEqual(payload.transactions);
  });

  //* updateAccountAddress
  it('should update the [address] of an account', () => {
    const payload: IAccountUpdateAddress = {
      address: {
        main: 'sys1qydmw8wrtl4mvk6he65qqrq8ml9f6eyyl9tasax',
      },
      id: FAKE_ACCOUNT.id, // accountId
    };

    const newState = reducer(STATE_W_ACCOUNT, updateAccountAddress(payload));

    expect(newState.accounts[0].address).toEqual(payload.address);
  });

  //* updateAccountXpub
  it('should update [xpub, xprv] of an account', () => {
    const payload: IAccountUpdateXpub = {
      id: FAKE_ACCOUNT.id, // accountId
      xprv: 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
      xpub: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
    };

    const newState = reducer(STATE_W_ACCOUNT, updateAccountXpub(payload));

    const updatedAccount = newState.accounts[0];
    expect(updatedAccount.xprv).toEqual(payload.xprv);
    expect(updatedAccount.xpub).toEqual(payload.xpub);
  });

  //* forgetWallet
  it('should forget the wallet', () => {
    // these fields should not change when deleting the wallet
    const staticFields = {
      timer: 10,
      currentBlockbookURL: 'https://something.url',
      networks: {
        fakenetwork: {
          id: 'fakenetwork',
          label: 'Fake Network',
          beUrl: 'https://fake.network.com/',
        },
      },
      trustedApps: {
        'website.com': 'https://website.com/route',
      },
      temporaryTransactionState: {
        executing: true,
        type: 'type',
      },
    };

    // populate a state
    const customState: IWalletState = {
      ...initialState,
      accounts: [FAKE_ACCOUNT],
      tabs: FAKE_TAB,
      ...staticFields,
    };

    const newState = reducer(customState, forgetWallet());

    expect(newState).toEqual(initialState);
  });

  //* changeAccountActiveId
  it('should update [activeAccountId]', () => {
    const payload = FAKE_ACCOUNT.id;
    const newState = reducer(initialState, changeAccountActiveId(payload));

    expect(newState.activeAccountId).toEqual(payload);
  });

  //* changeActiveNetwork
  it('should update [activeNetwork] (and [currentBlockbookURL])', () => {
    const payload: INetwork = {
      id: 'testnet',
      beUrl: 'https://blockbook-dev.elint.services/',
      chainId: 57,
      label: 'testnet',
      type: 'syscoin',
    };

    const newState = reducer(initialState, changeActiveNetwork(payload));

    expect(newState.activeNetwork).toEqual(payload.id);
    expect(newState.currentBlockbookURL).toEqual(payload.beUrl);
  });

  //* updateTransactions
  it('should update [transactions] for a given account', () => {
    const payload = {
      id: FAKE_ACCOUNT.id, // accountId
      txs: FAKE_TRANSACTIONS,
    };

    const newState = reducer(STATE_W_ACCOUNT, updateTransactions(payload));

    expect(newState.accounts[0].transactions).toEqual(payload.txs);
  });

  //* updateLabel
  it('should update account [label]', () => {
    const payload = {
      id: FAKE_ACCOUNT.id, // accountId
      label: 'New Account Label',
    };

    const newState = reducer(STATE_W_ACCOUNT, updateLabel(payload));

    expect(newState.accounts[0].label).toEqual(payload.label);
  });
});
