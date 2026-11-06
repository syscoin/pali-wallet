import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks.ts';
import type { NetworkId, WalletNetwork } from './types.ts';
import { findUtxoNetwork, UTXO_NETWORKS, type UtxoNetwork } from './utxoNetworks.ts';

function projectUtxoDisplay({ id, name, symbol, decimals, kind, chainId, testnet }: UtxoNetwork): WalletNetwork {
  return Object.freeze({ id, name, symbol, decimals, kind, chainId, testnet,
    color: symbol === 'BTC' ? '#F7931A' : '#42B6E8', canWatch: true });
}

const EVM_NETWORKS: readonly WalletNetwork[] = Object.freeze(EVM_NETWORK_DEFINITIONS.map((definition) => Object.freeze({
  id: definition.id, name: definition.name, symbol: definition.network.currency.toUpperCase(), decimals: 18,
  kind: 'evm' as const, chainId: definition.network.chainId, color: definition.color, canWatch: true, testnet: definition.testnet,
})));

export const NETWORKS: readonly WalletNetwork[] = Object.freeze([...UTXO_NETWORKS.map(projectUtxoDisplay), ...EVM_NETWORKS]);

export function getNetwork(id: NetworkId, registrations = UTXO_NETWORKS): WalletNetwork {
  const utxo = findUtxoNetwork(id, registrations);
  if (utxo) return projectUtxoDisplay(utxo);
  const network = EVM_NETWORKS.find((entry) => entry.id === id);
  if (!network) throw new Error('Unknown network');
  return network;
}
