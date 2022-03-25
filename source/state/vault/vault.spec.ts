import { IAccountState } from 'state/wallet/types';
import { Assets, Transaction } from 'source/types/transactions';

import reducer, {
  changeActiveAccount,
  changeActiveNetwork,
  initialState,
  migrateWalletComplete,
  setTemporaryTransactionState,
  setTimer,
  setVaultInfo,
  updateBalances,
  updateStatus,
  updateTransactions,
  updateWalletAssets,
  updateWalletLabel,
} from '.';

//* ------- Mocks -------

const FAKE_XPUB =
  'zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2';
const FAKE_XPRV =
  'U2FsdGVkX18BNGHcPVXdJTVqdLn8/W4r/6UxD2Q1oshv/UkxSk/ir/uvXGDb3nP1TcvCcaruZU7FFXzLR7Uh/tr1j12/cEKWqUNwaNO/KXSVNvJP4dH8BN2ZTNfJMWgIdChPFFBsG1dCEODvrrntmYpB/gz8eEqSChr4j7xpFuc=';

const FAKE_ACCOUNT: IAccountState = {
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
  web3PrivateKey: '',
  web3Address: '0x0beaDdE9e116ceF07aFedc45a8566d1aDd3168F3',
};

export const FAKE_ASSETS: Assets[] = [
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

export const FAKE_TRANSACTIONS: Transaction[] = [
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

//* ------- Tests -------

describe('Vault store', () => {
  //* setVaultInfo
  it('should set accounts', () => {
    const payload = { accounts: [FAKE_ACCOUNT] };
    const newState = reducer(initialState, setVaultInfo(payload));

    expect(newState.accounts).toBe(payload.accounts);
  });

  //* setTimer
  it('should set the timer', () => {
    const payload = 7;
    const newState = reducer(initialState, setTimer(payload));

    expect(newState.timer).toBe(payload);
  });

  //* updateStatus
  it('should update the last login time', () => {
    const startTime = Date.now();
    const newState = reducer(initialState, updateStatus());

    expect(newState.lastLogin).toBeGreaterThanOrEqual(startTime);
    expect(newState.lastLogin).toBeLessThanOrEqual(Date.now());
  });

  //* changeActiveAccount
  it('should change the active account', () => {
    const newState = reducer(initialState, changeActiveAccount(FAKE_ACCOUNT));

    expect(newState.activeAccount).toBe(FAKE_ACCOUNT);
  });

  //* changeActiveNetwork
  it('should change the active network', () => {
    // TODO: populate payload for changeActiveNetwork
    const payload = { chainId: '?', network: '??' };
    const newState = reducer(initialState, changeActiveNetwork(payload));

    expect(newState.networks[payload.chainId]).toBe(payload);
  });

  //* updateWalletAssets
  it('should update active account assets', () => {
    const newState = reducer(initialState, updateWalletAssets(FAKE_ASSETS));

    expect(newState.activeAccount.assets).toBe(FAKE_ASSETS);
  });

  //* updateWalletLabel
  it('should update active account label', () => {
    const payload = 'New Label 0';
    const newState = reducer(initialState, updateWalletLabel(payload));

    expect(newState.activeAccount.label).toBe(payload);
  });

  //* updateTransactions
  it('should update active account transactions', () => {
    const payload = { txs: FAKE_TRANSACTIONS };
    const newState = reducer(initialState, updateTransactions(payload));

    expect(newState.activeAccount.transactions).toBe(FAKE_TRANSACTIONS);
  });

  //* updateBalances
  it('should update balances', () => {
    // TODO: populate payload for updateBalances
    const payload = 'any';
    const newState = reducer(initialState, updateBalances(payload));

    expect(newState.balances).toBe(payload);
  });

  //* migrateWalletComplete
  it('should delete [migrateWallet]', () => {
    const newState = reducer(initialState, migrateWalletComplete());

    expect(newState.migrateWallet).toBeUndefined();
  });

  //* setTemporaryTransactionState
  it('should set the temporary transaction state', () => {
    const payload = { executing: true, type: 'sendAsset' };
    const newState = reducer(
      initialState,
      setTemporaryTransactionState(payload)
    );

    expect(newState.temporaryTransactionState).toEqual(payload);
  });
});
