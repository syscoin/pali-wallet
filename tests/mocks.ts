import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { initialState } from 'state/vault';
import { IVaultState } from 'state/vault/types';

export const MOCK_PASSWORD = 'Asdqwe123!';
export const MOCK_SEED_PHRASE = process.env.REACT_APP_SEED_PEACE_GLOBE;

export const MOCK_ADDRESS = 'sys1qm83pr54hxaxlmgy70758p2tgnv4c7njj72q834';
export const MOCK_XPUB =
  'zpub6rpiU44ZGiafs8jd23QWxNLmf9dtF46TKHANH4mHqd75Xc8ZBTA2mqnfzwcemsRhMYZGoM16AE3jFhuXSX13m9vQq4jrKrX4xCZaXZV1Cs5';
export const MOCK_XPRV =
  'U2FsdGVkX1+GKblz0VZx/IwS0+Lhuc13VSeHE5qEByWmIwNDBdt9MKxTAHn8f/cMdpxnLpKh/Y1WUcKSNjTHbBrU5c040USE/jL6OGkSSDyd7u/ayIl4QhNfq/my9R+NoRLFlO9KwUpbSZjUz45Uai4EOrkCR2UQOjspMZG0x0Q=';

export const MOCK_ACCOUNT: IKeyringAccountState = {
  id: 0,
  label: 'Account 1',
  balances: { syscoin: 0.1040162, ethereum: 0 },
  isTrezorWallet: false,
  address: MOCK_ADDRESS,
  assets: [],
  transactions: [],
  xprv: MOCK_XPRV,
  xpub: MOCK_XPUB,
};

export const MOCK_TRANSACTION = {
  blockHash: 'b0654c70ef8d5db6edcfb03e9639d62ebf9645ebff443e01c9c62834c0b16ef8',
  blockHeight: 1479610,
  blockTime: 1663452907,
  confirmations: 54640,
  fees: '1910',
  hex: '87000000000101fb886ab05ca5e361128df54eebfe119604b6c1a2a9310448e2fe8a0f878dfd370100000000fdffffff03007d000000000000160014bc0a1f6c6c71f0a0965177ab08275513d30b21fdc1ba8ba300000000160014a5ef31c4027095240dda51eba7b7c08ac7bfd31300000000000000001f6a1d0180aeafb256010185d54300fefeafafafaf44757374207061796f75740247304402202290a5c1d62ab7e6d66be7cc8fe86d807e721cc16f74fef742e1c692a488dd58022006ac155c3b761f48f4d3cfd9a1df459700a8920767e11d1d8f349d8c50da6251012102e27fcc3d017af51f96b87ab24de78831740f5e2f5dddc8a96e81477b2101ba8100000000',
  memo: '/v6vr6+vRHVzdCBwYXlvdXQ=',
  tokenTransfers: [
    {
      AuxFeeDetails: {},
      decimals: 8,
      from: '',
      name: '',
      symbol: 'QUdY',
      to: '',
      token: '367794646',
      valueOut: '1215300000000',
    },
  ],
  tokenType: 'SPTAssetAllocationSend',
  txid: '38c7962ab8ebdc91d7412b0fad9535a45a47e7a652749017f030b91d4efd4ea2',
  value: '2743875521',
  valueIn: '2743877431',
  version: 135,
  vin: [
    {
      addresses: ['sys1q5hhnr3qzwz2jgrw628460d7q3trml5cntr29g9'],
      assetInfo: {
        assetGuid: '367794646',
        value: '1215300000000',
        valueStr: '12153 QUdY',
      },
      isAddress: true,
      n: 0,
      sequence: 4294967293,
      txid: '37fd8d870f8afee2480431a9a2c1b6049611feeb4ef58d1261e3a55cb06a88fb',
      value: '2743877431',
      vout: 1,
    },
  ],
  vout: [
    {
      addresses: ['sys1qhs9p7mrvw8c2p9j3w74ssf64z0fskg0av26n84'],
      hex: '0014bc0a1f6c6c71f0a0965177ab08275513d30b21fd',
      isAddress: true,
      n: 0,
      value: '32000',
    },
    {
      addresses: ['sys1q5hhnr3qzwz2jgrw628460d7q3trml5cntr29g9'],
      assetInfo: {
        assetGuid: '367794646',
        value: '1215300000000',
        valueStr: '12153 QUdY',
      },
      hex: '0014a5ef31c4027095240dda51eba7b7c08ac7bfd313',
      isAddress: true,
      n: 1,
      spent: true,
      value: '2743843521',
    },
    {
      addresses: [
        'OP_RETURN 0180aeafb256010185d54300fefeafafafaf44757374207061796f7574',
      ],
      hex: '6a1d0180aeafb256010185d54300fefeafafafaf44757374207061796f7574',
      isAddress: false,
      n: 2,
      value: '0',
    },
  ],
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
  chainId: '0x89',
  networkVersion: '137',
};

export const CUSTOM_UTXO_RPC_VALID_PAYLOAD = {
  label: 'test custom litecoin rpc',
  chainId: 2,
  url: 'https://blockbook-litecoin.binancechain.io/',
  explorerUrl: '',
};

export const VALID_GET_UTXO_RPC_RESPONSE = {
  url: 'https://blockbook-litecoin.binancechain.io/',
  explorer: 'https://blockbook-litecoin.binancechain.io/',
  currency: 'ltc',
  label: 'Litecoin',
  default: false,
  chainId: 2,
};

export const VALID_GET_WEB3_RPC_RESPONSE = {
  url: 'https://mainnet.optimism.io',
  explorerUrl: 'https://optimistic.etherscan.io',
  currency: 'ETH',
  label: 'test custom optimism rpc',
  default: false,
  chainId: 10,
};

export const CUSTOM_WEB3_RPC_VALID_PAYLOAD = {
  label: 'test custom optimism rpc',
  chainId: 10,
  url: 'https://mainnet.optimism.io',
  explorerUrl: 'https://optimistic.etherscan.io',
};

export const CUSTOM_WEB3_ID_INVALID_PAYLOAD = {
  label: 'custom web3 rpc payload with invalid chain id',
  chainId: 10,
  explorerUrl: '',
  url: 'https://arb1.arbitrum.io/rpc',
};

export const CUSTOM_WEB3_URL_INVALID_PAYLOAD = {
  label: 'custom web3 rpc payload with invalid url',
  chainId: 42161,
  explorerUrl: '',
  url: 'https://arb1.arbitrum.io',
};

export const VALID_INITIAL_CUSTOM_RPC = {
  label: 'initial custom rpc',
  chainId: 10,
  url: 'https://mainnet.optimism.io',
};

export const VALID_EDITED_CUSTOM_RPC = {
  label: 'edited custom arbitrum rpc',
  chainId: 42161,
  url: 'https://arb1.arbitrum.io/rpc',
};

const { chainId: initialId } = VALID_INITIAL_CUSTOM_RPC;
const { chainId: editedId } = VALID_EDITED_CUSTOM_RPC;

export const NEW_VALID_CHAIN_ID = editedId !== initialId ? initialId : editedId;
