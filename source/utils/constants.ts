import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import {
  FaucetChainIds,
  FaucetChainNames,
  FaucetChainSymbols,
} from '../types/faucet';
import rolluxChain from 'assets/images/rolluxChain.png';
import sysChain from 'assets/images/sysChain.svg';

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

export const MINIMUN_FEE = 0.00001;

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
 *
 * 2. Syscoin UTXO (Bitcoin-style):
 *    - Traditional UTXO-based blockchain (like Bitcoin)
 *    - Uses Blockbook endpoints like https://explorer-blockbook.syscoin.org
 *    - Supports Bitcoin-style transactions
 *    - Chain ID 57 (same as NEVM but different protocol)
 *    - Does NOT support eth_* methods
 *
 * The distinction is made by URL pattern:
 * - rpc.syscoin.org or rpc.tanenbaum.io = NEVM (EVM-compatible)
 * - explorer-blockbook.syscoin.org = UTXO (Bitcoin-style)
 *
 * Other networks:
 * - Chain ID 57000: Rollux Testnet
 */

export const SYSCOIN_NEVM_TESTNET_NETWORK_5700 = {
  chainId: 5700,
  url: 'https://rpc.tanenbaum.io',
  label: 'Syscoin NEVM Testnet',
  default: true,
  currency: 'tsys',
  isTestnet: true,
} as INetwork;

export const SYSCOIN_NEVM_NETWORK_57 = {
  chainId: 57,
  url: 'https://rpc.syscoin.org',
  label: 'Syscoin NEVM',
  default: true,
  currency: 'sys',
  isTestnet: false,
} as INetwork;

export const SYSCOIN_UTXO_NETWORK_57 = {
  chainId: 57,
  url: 'https://explorer-blockbook.syscoin.org',
  label: 'Syscoin Mainnet',
  default: true,
  currency: 'sys',
  slip44: 57,
  isTestnet: false,
} as INetwork;

// For backwards compatibility - this should be the UTXO network
export const SYSCOIN_MAINNET_NETWORK_57 = SYSCOIN_UTXO_NETWORK_57;

export const SYSCOIN_MAINNET_DEFAULT_NETWORK = {
  chain: INetworkType.Syscoin,
  network: SYSCOIN_UTXO_NETWORK_57,
  isEdit: true,
};

export const SYS_UTXO_MAINNET_NETWORK = SYSCOIN_UTXO_NETWORK_57;

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
  icon: rolluxChain,
  token: '$SYS',
  networkName: 'Rollux',
  quantity: 0.001,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxRolluxTestnetInfo = {
  icon: rolluxChain,
  token: '$TSYS',
  networkName: 'Rollux Testnet',
  quantity: 1,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxSyscoinNEVMInfo = {
  icon: sysChain,
  token: '$SYS',
  networkName: 'Syscoin NEVM',
  quantity: 0.01,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxSyscoinNEVMTestnetInfo = {
  icon: sysChain,
  token: '$TSYS',
  networkName: 'Syscoin NEVM Testnet',
  quantity: 1,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};
