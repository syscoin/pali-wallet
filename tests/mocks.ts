import { initialState } from 'state/wallet';
import IWalletState, {
  Connection,
  IAccountState,
  ITab,
} from 'state/wallet/types';
import { Assets, Transaction } from 'types/transactions';

export const FAKE_PASSWORD = 'Asdqwe123!';
export const FAKE_INVALID_PASSWORD = '12345';
export const FAKE_SEED_PHRASE =
  'peace uncle grit essence stuff angle cruise annual fury letter snack globe';
export const INVALID_SEED_PHRASE =
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';

export const FAKE_XPUB =
  'zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2';
export const FAKE_XPRV =
  'U2FsdGVkX18BNGHcPVXdJTVqdLn8/W4r/6UxD2Q1oshv/UkxSk/ir/uvXGDb3nP1TcvCcaruZU7FFXzLR7Uh/tr1j12/cEKWqUNwaNO/KXSVNvJP4dH8BN2ZTNfJMWgIdChPFFBsG1dCEODvrrntmYpB/gz8eEqSChr4j7xpFuc=';

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

export const FAKE_ACCOUNT: IAccountState = {
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

export const FAKE_CONNECTION: Connection = {
  accountId: FAKE_ACCOUNT.id,
  url: 'sysmint.paliwallet.com',
};

export const FAKE_TAB: ITab = {
  canConnect: false,
  connections: [FAKE_CONNECTION],
  currentSenderURL: 'https://sysmint.paliwallet.com/',
  currentURL: 'https://sysmint.paliwallet.com/',
};

// state with an account
export const STATE_W_ACCOUNT: IWalletState = {
  ...initialState,
  accounts: [FAKE_ACCOUNT],
};
