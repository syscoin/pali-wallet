import {
  getDefaultUTXONetworks,
  getSyscoinUTXOMainnetNetwork,
  getBitcoinMainnetNetwork,
} from '@pollum-io/sysweb3-keyring';
import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import {
  FaucetChainIds,
  FaucetChainNames,
  FaucetChainSymbols,
} from '../types/faucet';

// Chain ID Constants
export const CHAIN_IDS = {
  SYSCOIN_MAINNET: 57,
  SYSCOIN_TESTNET: 5700,
  POLYGON_MAINNET: 137,
  SYSCOIN_NEVM_TESTNET: 5700,
  ROLLUX_MAINNET: 570,
  ROLLUX_TESTNET: 57000,
  ETHEREUM_MAINNET: 1,
  ZKSYNC_ERA_MAINNET: 324,
  ZKSYNC_ERA_TESTNET: 300,
} as const;

// zkSync Era networks that require CustomL2JsonRpcProvider (zksync-ethers.Provider)
export const L2_NETWORK_CHAIN_IDS: number[] = [
  CHAIN_IDS.ZKSYNC_ERA_MAINNET, // 324 - zkSync Era Mainnet
  CHAIN_IDS.ZKSYNC_ERA_TESTNET, // 300 - zkSync Era Sepolia Testnet
];

export const INITIAL_FEE = {
  baseFee: 0,
  gasPrice: 0,
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 0,
};

export const ONE_MILLION = 1000000;
export const ONE_BILLION = 1000000000;
export const ONE_TRILLION = 1000000000000;

export type FieldValuesType = {
  amount: string;
  receiver: string;
};

export const MINIMUM_FEE = 0.00001;

// Define the keys you are interested in
export const syscoinKeysOfInterest = [
  'symbol',
  'totalReceived',
  'totalSent',
  'balance',
  'decimals',
  'contract', // NEVM contract address for cross-chain assets
  'metaData', // Syscoin 5 metadata field
];

export const ROLLUX_DEFAULT_NETWORK = {
  chain: INetworkType.Ethereum,
  network: {
    chainId: CHAIN_IDS.ROLLUX_MAINNET,
    currency: 'sys',
    default: true,
    label: 'Rollux',
    url: 'https://rpc.rollux.com',
    apiUrl: 'https://explorer.rollux.com/api',
    explorer: 'https://explorer.rollux.com',
    kind: INetworkType.Ethereum,
    slip44: 60, // EVM networks use Ethereum's slip44
    coingeckoId: 'syscoin', // Native token (SYS) CoinGecko ID
    coingeckoPlatformId: 'rollux', // Platform ID for token searches
  } as INetwork,
};

export const SYSCOIN_NEVM_TESTNET_NETWORK_5700 = {
  chainId: CHAIN_IDS.SYSCOIN_NEVM_TESTNET,
  url: 'https://rpc.tanenbaum.io',
  label: 'Syscoin NEVM Testnet',
  default: false, // Allow users to remove testnets to avoid chainId conflicts
  currency: 'tsys',
  kind: INetworkType.Ethereum,
  slip44: 60, // EVM networks use Ethereum's slip44
  apiUrl: 'https://explorer.tanenbaum.io/api',
  explorer: 'https://explorer.tanenbaum.io/',
  coingeckoId: 'syscoin', // Native token (TSYS uses SYS for price reference)
} as INetwork;

export const SYSCOIN_MAINNET_NETWORK = {
  chainId: CHAIN_IDS.SYSCOIN_MAINNET,
  url: 'https://rpc.syscoin.org',
  label: 'Syscoin NEVM',
  default: true,
  currency: 'sys',
  kind: INetworkType.Ethereum,
  slip44: 60, // EVM networks use Ethereum's slip44
  apiUrl: 'https://explorer.syscoin.org/api',
  explorer: 'https://explorer.syscoin.org',
  coingeckoId: 'syscoin', // Native token (SYS) CoinGecko ID
  coingeckoPlatformId: 'syscoin-nevm', // Platform ID for token searches
} as INetwork;

export const SYSCOIN_UTXO_MAINNET_NETWORK = getSyscoinUTXOMainnetNetwork();
export const BITCOIN_MAINNET_NETWORK = getBitcoinMainnetNetwork();

interface IFaucetNetworkData {
  [key: string]: {
    network: string;
    token: string;
  };
}

// for faucet
export const faucetNetworkData: IFaucetNetworkData = {
  [FaucetChainIds.NevmMainnet]: {
    token: FaucetChainSymbols.SYS,
    network: FaucetChainNames.SYSCOIN_NEVM,
  },
  [FaucetChainIds.NevmTestnet]: {
    token: FaucetChainSymbols.TSYS,
    network: FaucetChainNames.SYSCOIN_NEVM_TESTNET,
  },
  [FaucetChainIds.RolluxMainnet]: {
    token: FaucetChainSymbols.SYS,
    network: FaucetChainNames.ROLLUX,
  },
  [FaucetChainIds.RolluxTestnet]: {
    token: FaucetChainSymbols.TSYS,
    network: FaucetChainNames.ROLLUX_TESTNET,
  },
};

export const faucetTxRolluxInfo = {
  chainId: CHAIN_IDS.ROLLUX_MAINNET,
  token: '$SYS',
  networkName: 'Rollux',
  quantity: 0.001,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxRolluxTestnetInfo = {
  chainId: CHAIN_IDS.ROLLUX_TESTNET,
  token: '$TSYS',
  networkName: 'Rollux Testnet',
  quantity: 1,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxSyscoinNEVMInfo = {
  chainId: CHAIN_IDS.SYSCOIN_MAINNET,
  token: '$SYS',
  networkName: 'Syscoin NEVM',
  quantity: 0.01,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxSyscoinNEVMTestnetInfo = {
  chainId: CHAIN_IDS.SYSCOIN_NEVM_TESTNET,
  token: '$TSYS',
  networkName: 'Syscoin NEVM Testnet',
  quantity: 1,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

// Our own networks state with proper 'kind' properties - replaces broken initialNetworksState
export const PALI_NETWORKS_STATE = {
  ethereum: {
    [CHAIN_IDS.SYSCOIN_MAINNET]: SYSCOIN_MAINNET_NETWORK,
    [CHAIN_IDS.ROLLUX_MAINNET]: ROLLUX_DEFAULT_NETWORK.network,
    [CHAIN_IDS.SYSCOIN_NEVM_TESTNET]: SYSCOIN_NEVM_TESTNET_NETWORK_5700,
    [CHAIN_IDS.ETHEREUM_MAINNET]: {
      chainId: CHAIN_IDS.ETHEREUM_MAINNET,
      url: 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      label: 'Ethereum Mainnet',
      default: true,
      currency: 'eth',
      explorer: 'https://etherscan.io/',
      apiUrl: 'https://api.etherscan.io/api',
      kind: INetworkType.Ethereum,
      slip44: 60, // Ethereum
      coingeckoId: 'ethereum', // Native token (ETH) CoinGecko ID
      coingeckoPlatformId: 'ethereum', // Platform ID for token searches
    } as INetwork,
    [CHAIN_IDS.POLYGON_MAINNET]: {
      chainId: CHAIN_IDS.POLYGON_MAINNET,
      currency: 'matic',
      default: true,
      label: 'Polygon Mainnet',
      url: 'https://polygon-rpc.com/',
      apiUrl: 'https://api.polygonscan.com/api',
      explorer: 'https://polygonscan.com',
      kind: INetworkType.Ethereum,
      slip44: 60, // EVM networks use Ethereum's slip44
      coingeckoId: 'matic-network', // Native token (MATIC) CoinGecko ID
      coingeckoPlatformId: 'polygon-pos', // Platform ID for token searches
    } as INetwork,
  },
  syscoin: getDefaultUTXONetworks(), // Use coins.ts as single source of truth
};
