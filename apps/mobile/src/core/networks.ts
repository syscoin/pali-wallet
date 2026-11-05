import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks.ts';
import type { NetworkId, WalletNetwork } from './types.ts';
import { UTXO_NETWORKS } from './utxoNetworks.ts';

// Kind participates in identity: a numeric chain identifier alone is not enough.
export const NETWORKS: readonly WalletNetwork[] = Object.freeze([
  ...UTXO_NETWORKS.map(({ id, name, symbol, decimals, kind, chainId, testnet }) => Object.freeze({
    id, name, symbol, decimals, kind, chainId, testnet,
    color: symbol === 'BTC' ? '#F7931A' : '#42B6E8', canWatch: true,
  })),
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
