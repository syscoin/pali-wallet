import { CHAIN_IDS, createExtensionEvmNetworks } from '../shared/evmNetworks';
import {
  FaucetChainIds,
  FaucetChainNames,
  FaucetChainSymbols,
} from '../types/faucet';
import { INetwork, INetworkType } from 'types/network';

import {
  getDefaultUTXONetworks,
  getSyscoinUTXOMainnetNetwork,
  getBitcoinMainnetNetwork,
} from './defaultNetworks';

export { CHAIN_IDS } from '../shared/evmNetworks';

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

// Large consolidation PSBTs resolve prevouts through a bounded worker pool.
export const SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS = 60_000;

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

const defaultEvmNetworks = createExtensionEvmNetworks() as Record<
  number,
  INetwork
>;
export const ROLLUX_DEFAULT_NETWORK = {
  chain: INetworkType.Ethereum,
  network: defaultEvmNetworks[CHAIN_IDS.ROLLUX_MAINNET],
};
export const SYSCOIN_NEVM_TESTNET_NETWORK_5700 =
  defaultEvmNetworks[CHAIN_IDS.SYSCOIN_NEVM_TESTNET];
export const ZKSYS_TANENBAUM_TESTNET_NETWORK_57057 =
  defaultEvmNetworks[CHAIN_IDS.ZKSYS_TANENBAUM_TESTNET];
export const SYSCOIN_MAINNET_NETWORK =
  defaultEvmNetworks[CHAIN_IDS.SYSCOIN_MAINNET];

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
  ethereum: defaultEvmNetworks,
  syscoin: getDefaultUTXONetworks(), // Use coins.ts as single source of truth
};
