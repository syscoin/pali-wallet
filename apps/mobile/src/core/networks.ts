import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks.ts';
import type { NetworkId, WalletNetwork } from './types.ts';

// Kind participates in identity: a numeric chain identifier alone is not enough.
export const NETWORKS: readonly WalletNetwork[] = Object.freeze([
  Object.freeze({
    id: 'syscoin',
    name: 'Syscoin UTXO',
    symbol: 'SYS',
    decimals: 8,
    kind: 'utxo',
    color: '#42B6E8',
    canWatch: false,
  }),
  Object.freeze({
    id: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    decimals: 8,
    kind: 'utxo',
    color: '#F7931A',
    canWatch: false,
  }),
  ...EVM_NETWORK_DEFINITIONS.map((definition) => Object.freeze({
    id: definition.id, name: definition.name, symbol: definition.network.currency.toUpperCase(), decimals: 18,
    kind: 'evm' as const, chainId: definition.network.chainId, color: definition.color, canWatch: true, testnet: definition.testnet,
  })),
] satisfies WalletNetwork[]);

export function getNetwork(id: NetworkId): WalletNetwork {
  const network = NETWORKS.find((entry) => entry.id === id);
  if (!network) throw new Error('Unknown network');
  return network;
}
