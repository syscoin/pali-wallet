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
  Object.freeze({
    id: 'syscoin-nevm',
    name: 'Syscoin NEVM',
    symbol: 'SYS',
    decimals: 18,
    kind: 'evm',
    chainId: 57,
    color: '#42B6E8',
    canWatch: true,
  }),
  Object.freeze({
    id: 'ethereum',
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
    kind: 'evm',
    chainId: 1,
    color: '#8B9EEC',
    canWatch: true,
  }),
  Object.freeze({
    id: 'base',
    name: 'Base',
    symbol: 'ETH',
    decimals: 18,
    kind: 'evm',
    chainId: 8453,
    color: '#477CFF',
    canWatch: true,
  }),
  Object.freeze({
    id: 'arbitrum',
    name: 'Arbitrum One',
    symbol: 'ETH',
    decimals: 18,
    kind: 'evm',
    chainId: 42161,
    color: '#7EC7F0',
    canWatch: true,
  }),
] satisfies WalletNetwork[]);

export function getNetwork(id: NetworkId): WalletNetwork {
  const network = NETWORKS.find((entry) => entry.id === id);
  if (!network) throw new Error('Unknown network');
  return network;
}
