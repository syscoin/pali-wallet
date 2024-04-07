import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

export const INITIAL_FEE = {
  baseFee: 0,
  gasPrice: 0,
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 0,
};

export const ONE_MILLION = 1000000;
export const ONE_BILLION = 1000000000;
export const ONE_TRILLION = 1000000000000;

// Define the keys you are interested in
export const syscoinKeysOfInterest = [
  'symbol',
  'totalReceived',
  'totalSent',
  'balance',
  'decimals',
];

//Video formats for NFTs
export const nftsVideoFormats = ['.mp4', '.webm', '.avi', '.ogg'];
export const ethTestnetsChainsIds = [5700, 80001, 11155111, 421611, 5, 69]; // Some ChainIds from Ethereum Testnets as Polygon Testnet, Goerli, Sepolia, etc.

export const ROLLUX_DEFAULT_NETWORK = {
  chain: INetworkType.Ethereum,
  network: {
    chainId: 570,
    currency: 'sys',
    default: true,
    label: 'Rollux',
    url: 'https://rpc.rollux.com',
    apiUrl: 'https://explorer.rollux.com/api',
    explorer: 'https://explorer.rollux.com/',
    isTestnet: false,
  } as INetwork,
  isEdit: false,
};

export const SYSCOIN_MAINNET_NETWORK_57 = {
  chainId: 57,
  url: 'https://blockbook.syscoin.org',
  label: 'Syscoin Mainnet',
  default: true,
  currency: 'sys',
  slip44: 57,
  isTestnet: false,
} as INetwork;

export const SYSCOIN_MAINNET_DEFAULT_NETWORK = {
  chain: INetworkType.Syscoin,
  network: SYSCOIN_MAINNET_NETWORK_57,
  isEdit: true,
};
