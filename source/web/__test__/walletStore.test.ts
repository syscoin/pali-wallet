import CryptoJS from 'crypto-js';

import { Assets, Transaction } from 'types/transactions';
import reducer, {
  changeAccountActiveId,
  changeActiveNetwork,
  clearAllTransactions,
  createAccount,
  deleteWallet,
  initialState,
  removeAccount,
  removeAccounts,
  removeConnection,
  setEncriptedMnemonic,
  setSenderURL,
  setTemporaryTransactionState,
  setTimer,
  updateAccount,
  updateAccountAddress,
  updateAccountXpub,
  updateCanConfirmTransaction,
  updateCanConnect,
  updateCurrentURL,
  updateLabel,
  updateNetwork,
  updateStatus,
  updateSwitchNetwork,
  updateTransactions,
} from '../../state/wallet';
import IWalletState, {
  Connection,
  IAccountState,
  INetwork,
  ITab,
  IAccountUpdateAddress,
  IAccountUpdateState,
  IAccountUpdateXpub,
} from '../../state/wallet/types';

//* ----- Mocks -----

const FAKE_XPUB =
  'zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2';
const FAKE_XPRV =
  'U2FsdGVkX18BNGHcPVXdJTVqdLn8/W4r/6UxD2Q1oshv/UkxSk/ir/uvXGDb3nP1TcvCcaruZU7FFXzLR7Uh/tr1j12/cEKWqUNwaNO/KXSVNvJP4dH8BN2ZTNfJMWgIdChPFFBsG1dCEODvrrntmYpB/gz8eEqSChr4j7xpFuc=';

const FAKE_ASSETS: Assets[] = [
  {
    type: 'SPTAllocated',
    assetGuid: 1179191490,
    symbol: 'asd',
    balance: 1200000000,
    decimals: 8,
  },
  {
    type: 'SPTAllocated',
    assetGuid: 1214075697,
    symbol: 'nfttt',
    balance: 100000000,
    decimals: 8,
  },
];

const FAKE_TRANSACTIONS: Transaction[] = [
  {
    tokenType: '',
    txid: '278faced0d28ff8179dec9c6706c59c6a4375cdb03c7a873eb39ac2d66c54e0d',
    value: 28968000,
    confirmations: 3830,
    fees: 215000,
    blockTime: 1641427017,
  },
  {
    tokenType: '',
    txid: '1f30e6e4bebb900492984f31bc038e42f9e5d5b79a0001b3b8bb1eceddd80781',
    value: 19638000,
    confirmations: 3830,
    fees: 147000,
    blockTime: 1641427017,
  },
];

const FAKE_ACCOUNT = {
  address: {
    main: 'sys1qydmw8wrtl4mvk6he65qqrq8ml9f6eyyl9tasax',
  },
  assets: [
    {
      type: 'SPTAllocated',
      assetGuid: 3144265615,
      symbol: 'NikBar',
      balance: 200000000,
      decimals: 8,
    },
    {
      type: 'SPTAllocated',
      assetGuid: 3569136514,
      symbol: 'ads',
      balance: 100000000,
      decimals: 8,
    },
  ],
  balance: 0.48430419,
  connectedTo: ['sysmint.paliwallet.com', 'another.url'],
  id: 15,
  isTrezorWallet: false,
  label: 'Account 15',
  transactions: [
    {
      tokenType: '',
      txid: 'ce57ad43942302b95f71008176bbf9648933c16bae678ab512f309616643604b',
      value: 28323000,
      confirmations: 3830,
      fees: 283000,
      blockTime: 1641427017,
    },
    {
      tokenType: '',
      txid: 'd81f315c74d2ddc1ab6b4b125b968d9236bb646c13e7036f26ecaa1b379f1ed6',
      value: 29398000,
      confirmations: 3831,
      fees: 215000,
      blockTime: 1641426442,
    },
  ],
  xprv: FAKE_XPRV,
  xpub: FAKE_XPUB,
};

const FAKE_CONNECTION: Connection = {
  accountId: FAKE_ACCOUNT.id,
  url: 'sysmint.paliwallet.com',
};

const FAKE_TAB: ITab = {
  canConnect: false,
  connections: [FAKE_CONNECTION],
  currentSenderURL: 'https://sysmint.paliwallet.com/',
  currentURL: 'https://sysmint.paliwallet.com/',
};

// state with an account
const STATE_W_ACCOUNT: IWalletState = {
  ...initialState,
  accounts: [FAKE_ACCOUNT],
};

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
        id: 'main',
        label: 'CoinLabel',
      };

      const newState = reducer(initialState, updateNetwork(payload));

      expect(newState.networks[payload.id]).toEqual(payload);
    });

    it('should create a network', () => {
      const payload: INetwork = {
        beUrl: 'https://this-is-an.url',
        id: 'somenet',
        label: 'CoinLabel',
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

  // TODO updateAllTokens test
  // unclear what to expect

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

  // TODO updateConnectionsArray test
  // unclear what to expect
  /* it('should update the connections array', () => {
    const payload: Connection = {
      accountId: 1,
      url: '',
    };

    const newState =
      reducer(initialState, updateConnectionsArray(payload));

    expect(newState.).toEqual(payload);
  }); */

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

  //* deleteWallet
  it('should delete the wallet', () => {
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

    const newState = reducer(customState, deleteWallet());

    expect(newState).toEqual({
      ...initialState,
      ...staticFields,
    });
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
      label: 'Testnet',
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
