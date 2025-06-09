import { INetworkType } from '@pollum-io/sysweb3-network';

import { INetworkWithKind } from '../state/vault/types';
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
export const FIELD_VALUES_INITIAL_STATE = { amount: '', receiver: '' };

export const MINIMUM_FEE = 0.00001;

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
export const ethTestnetsChainsIds = [5700, 11155111, 421611, 5, 69]; // Some ChainIds from Ethereum Testnets as Polygon Testnet, Goerli, Sepolia, etc.

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
    isTestnet: false,
    kind: 'evm',
  } as INetworkWithKind,
  isEdit: false,
};

/**
 * SYSCOIN NETWORK ARCHITECTURE EXPLANATION:
 *
 * Syscoin has two different network types that can share the same chain ID (57):
 *
 * 1. Syscoin NEVM (Network Enhanced Virtual Machine):
 *    - EVM-compatible layer built on top of Syscoin
 *    - Uses RPC endpoints like https://rpc.syscoin.org
 *    - Supports Ethereum-style transactions, smart contracts, etc.
 *    - Chain ID 57 (mainnet) and 5700 (testnet)
 *    - Handles eth_chainId, eth_requestAccounts, etc.
 *    - kind: 'evm'
 *
 * 2. Syscoin UTXO (Bitcoin-style):
 *    - Traditional UTXO-based blockchain (like Bitcoin)
 *    - Uses Blockbook endpoints like https://explorer-blockbook.syscoin.org
 *    - Supports Bitcoin-style transactions
 *    - Chain ID 57 (same as NEVM but different protocol)
 *    - Does NOT support eth_* methods
 *    - kind: 'utxo'
 *
 * The distinction is made by network.kind field:
 * - kind: 'evm' = NEVM (EVM-compatible)
 * - kind: 'utxo' = UTXO (Bitcoin-style)
 *
 * Other networks:
 * - Chain ID 57000: Rollux Testnet
 */

export const SYSCOIN_NEVM_TESTNET_NETWORK_5700 = {
  chainId: CHAIN_IDS.SYSCOIN_NEVM_TESTNET,
  url: 'https://rpc.tanenbaum.io',
  label: 'Syscoin NEVM Testnet',
  default: true,
  currency: 'tsys',
  isTestnet: true,
  kind: 'evm',
  apiUrl: 'https://explorer.tanenbaum.io/api',
  explorer: 'https://explorer.tanenbaum.io/',
} as INetworkWithKind;

export const SYSCOIN_MAINNET_NETWORK = {
  chainId: CHAIN_IDS.SYSCOIN_MAINNET,
  url: 'https://rpc.syscoin.org',
  label: 'Syscoin NEVM',
  default: true,
  currency: 'sys',
  isTestnet: false,
  kind: 'evm',
  apiUrl: 'https://explorer.syscoin.org/api',
  explorer: 'https://explorer.syscoin.org',
} as INetworkWithKind;

export const SYSCOIN_UTXO_MAINNET_NETWORK = {
  chainId: CHAIN_IDS.SYSCOIN_MAINNET,
  url: 'https://explorer-blockbook.syscoin.org',
  label: 'Syscoin Mainnet',
  default: true,
  currency: 'sys',
  slip44: 57,
  isTestnet: false,
  kind: 'utxo',
} as INetworkWithKind;

export const SYSCOIN_UTXO_TESTNET_NETWORK = {
  chainId: CHAIN_IDS.SYSCOIN_TESTNET,
  url: 'https://explorer-blockbook-dev.syscoin.org',
  label: 'Syscoin Testnet',
  default: true,
  currency: 'tsys',
  slip44: 0,
  isTestnet: true,
  kind: 'utxo',
} as INetworkWithKind;

export const SYSCOIN_MAINNET_DEFAULT_NETWORK = {
  chain: INetworkType.Syscoin,
  network: SYSCOIN_UTXO_MAINNET_NETWORK,
  isEdit: true,
};

export const SYSCOIN_TESTNET_DEFAULT_NETWORK = {
  chain: INetworkType.Syscoin,
  network: SYSCOIN_UTXO_TESTNET_NETWORK,
  isEdit: true,
};

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
      isTestnet: false,
      kind: 'evm',
    } as INetworkWithKind,
    [CHAIN_IDS.POLYGON_MAINNET]: {
      chainId: CHAIN_IDS.POLYGON_MAINNET,
      currency: 'matic',
      default: true,
      label: 'Polygon Mainnet',
      url: 'https://polygon-rpc.com/',
      apiUrl: 'https://api.polygonscan.com/api',
      explorer: 'https://polygonscan.com',
      isTestnet: false,
      kind: 'evm',
    } as INetworkWithKind,
  },
  syscoin: {
    [CHAIN_IDS.SYSCOIN_MAINNET]: SYSCOIN_UTXO_MAINNET_NETWORK,
    [CHAIN_IDS.SYSCOIN_TESTNET]: SYSCOIN_UTXO_TESTNET_NETWORK,
  },
};
