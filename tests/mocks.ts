import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { initialState } from 'state/vault';
import { IVaultState } from 'state/vault/types';

export const MOCK_PASSWORD = 'Asdqwe123!';
export const MOCK_SEED_PHRASE = process.env.REACT_APP_SEED_PEACE_GLOBE;

export const MOCK_XPUB =
  'zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2';
export const MOCK_XPRV =
  'U2FsdGVkX18BNGHcPVXdJTVqdLn8/W4r/6UxD2Q1oshv/UkxSk/ir/uvXGDb3nP1TcvCcaruZU7FFXzLR7Uh/tr1j12/cEKWqUNwaNO/KXSVNvJP4dH8BN2ZTNfJMWgIdChPFFBsG1dCEODvrrntmYpB/gz8eEqSChr4j7xpFuc=';

//todo: adjust mocks to guarantee new types
export const MOCK_ACCOUNT: IKeyringAccountState = {
  address: 'sys1qydmw8wrtl4mvk6he65qqrq8ml9f6eyyl9tasax',
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
  balances: { syscoin: 0.48430419, ethereum: 5.1 },
  id: 15,
  isTrezorWallet: false,
  label: 'My account',
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
  xprv: MOCK_XPRV,
  xpub: MOCK_XPUB,
  isImported: false,
};

export const STATE_W_ACCOUNT: IVaultState = {
  ...initialState,
  accounts: { [MOCK_ACCOUNT.id]: MOCK_ACCOUNT },
};
