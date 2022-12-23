import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { initialState } from 'state/vault';
import { IVaultState } from 'state/vault/types';

export const MOCK_PASSWORD = 'Asdqwe123!';
export const MOCK_SEED_PHRASE = process.env.REACT_APP_SEED_PEACE_GLOBE;

export const MOCK_XPUB =
  'zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2';
export const MOCK_XPRV =
  'U2FsdGVkX18BNGHcPVXdJTVqdLn8/W4r/6UxD2Q1oshv/UkxSk/ir/uvXGDb3nP1TcvCcaruZU7FFXzLR7Uh/tr1j12/cEKWqUNwaNO/KXSVNvJP4dH8BN2ZTNfJMWgIdChPFFBsG1dCEODvrrntmYpB/gz8eEqSChr4j7xpFuc=';

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
};

export const STATE_W_ACCOUNT: IVaultState = {
  ...initialState,
  accounts: { [MOCK_ACCOUNT.id]: MOCK_ACCOUNT },
};

export const VALID_NETWORK_VERSION_UTXO_RESPONSE = {
  chainId: '0x39',
  networkVersion: '57',
};

export const VALID_NETWORK_VERSION_WEB3_RESPONSE = {
  chainId: '0x1',
  networkVersion: '1',
};

export const CUSTOM_UTXO_RPC_VALID_PAYLOAD = {
  label: 'test custom litecoin rpc',
  chainId: 2,
  isSyscoinRpc: true,
  url: 'https://blockbook-litecoin.binancechain.io/',
};

export const VALID_GET_UTXO_RPC_RESPONSE = {
  url: 'https://blockbook-litecoin.binancechain.io/',
  apiUrl: 'https://blockbook-litecoin.binancechain.io/',
  explorer: 'https://blockbook-litecoin.binancechain.io/',
  currency: 'ltc',
  label: 'Litecoin',
  default: false,
  chainId: 2,
};

export const VALID_GET_WEB3_RPC_RESPONSE = {
  url: 'https://mainnet.optimism.io',
  apiUrl: undefined,
  explorer: 'https://optimistic.etherscan.io',
  currency: 'ETH',
  label: 'test custom optimism rpc',
  default: false,
  chainId: 10,
};

export const CUSTOM_WEB3_RPC_VALID_PAYLOAD = {
  label: 'test custom optimism rpc',
  chainId: 10,
  isSyscoinRpc: false,
  url: 'https://mainnet.optimism.io',
};

export const CUSTOM_WEB3_ID_INVALID_PAYLOAD = {
  label: 'custom web3 rpc payload with invalid chain id',
  chainId: 10,
  isSyscoinRpc: false,
  url: 'https://arb1.arbitrum.io/rpc',
};

export const CUSTOM_WEB3_URL_INVALID_PAYLOAD = {
  label: 'custom web3 rpc payload with invalid url',
  chainId: 42161,
  isSyscoinRpc: false,
  url: 'https://arb1.arbitrum.io',
};

export const VALID_INITIAL_CUSTOM_RPC = {
  label: 'initial custom rpc',
  chainId: 10,
  isSyscoinRpc: false,
  url: 'https://mainnet.optimism.io',
};

export const VALID_EDITED_CUSTOM_RPC = {
  label: 'edited custom arbitrum rpc',
  chainId: 42161,
  isSyscoinRpc: false,
  url: 'https://arb1.arbitrum.io/rpc',
};

const { chainId: initialId } = VALID_INITIAL_CUSTOM_RPC;
const { chainId: editedId } = VALID_EDITED_CUSTOM_RPC;

export const NEW_VALID_CHAIN_ID = editedId !== initialId ? initialId : editedId;
