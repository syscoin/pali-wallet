import { keccak256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';
import { EVM_NETWORK_DEFINITIONS, type EvmNetworkId } from '../../../../source/shared/evmNetworks.ts';
export type { EvmNetworkId } from '../../../../source/shared/evmNetworks.ts';

export type NativeNetworkRegistration = Readonly<{
  id: EvmNetworkId; kind: 'evm'; chainId: string; slip44: 60; rpcUrl: string;
  symbol: string; decimals: 18; testnet: boolean; registrationHash: string;
}>;
export const NATIVE_NETWORKS: readonly NativeNetworkRegistration[] = Object.freeze(
  EVM_NETWORK_DEFINITIONS.map(({ id, network, testnet }) => {
    const data = { id, kind: 'evm' as const, chainId: String(network.chainId), slip44: 60 as const,
      rpcUrl: network.url, symbol: network.currency.toUpperCase(), decimals: 18 as const, testnet };
    const registrationHash = keccak256(toUtf8Bytes(JSON.stringify([
      data.id, data.kind, data.chainId, data.slip44, data.rpcUrl, data.symbol, data.decimals, data.testnet,
    ])));
    return Object.freeze({ ...data, registrationHash });
  })
);
export function getNativeNetwork(id: string): NativeNetworkRegistration {
  const network = NATIVE_NETWORKS.find((value) => value.id === id);
  if (!network) throw new Error('Unsupported native network');
  return network;
}
/** New-send ceilings: zkOS and Ethereum EIP-7825 cap each transaction at 2^24. */
export const nativeTransferGasLimit = (id: EvmNetworkId): bigint =>
  id === 'zksys-testnet' || id === 'ethereum' ? 16777216n : 30000000n;
export type NativeSendContext = Readonly<{
  networkId: 'ethereum' | 'syscoin-nevm-testnet' | 'zksys-testnet';
  chainId: string;
  registrationHash: string;
  rpcUrl: string;
  name: string;
  symbol: string;
  decimals: 18;
  testnet: boolean;
  settlement: Readonly<{ kind: 'ethereum-finalized' } | { kind: 'nevm-depth-12'; confirmations: 12 } | { kind: 'zkos-finalized-executed' }>;
}>;
const sendCapabilities = Object.freeze(Object.fromEntries(NATIVE_NETWORKS.map((network) => [network.id,
  Object.freeze({ native: ['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet'].includes(network.id), erc20: network.id === 'ethereum' }),
])) as Record<EvmNetworkId, Readonly<{ native: boolean; erc20: boolean }>>);
const sendContexts: readonly NativeSendContext[] = Object.freeze(NATIVE_NETWORKS
  .filter((network) => sendCapabilities[network.id].native)
  .map((network) => Object.freeze({
    networkId: network.id as NativeSendContext['networkId'], chainId: network.chainId,
    registrationHash: network.registrationHash, rpcUrl: network.rpcUrl,
    name: EVM_NETWORK_DEFINITIONS.find((definition) => definition.id === network.id)!.name,
    symbol: network.symbol, decimals: network.decimals, testnet: network.testnet,
    settlement: Object.freeze(network.id === 'ethereum' ? { kind: 'ethereum-finalized' as const }
      : network.id === 'syscoin-nevm-testnet' ? { kind: 'nevm-depth-12' as const, confirmations: 12 as const }
      : { kind: 'zkos-finalized-executed' as const }),
  })));
export function getNativeSendContext(id: string): NativeSendContext {
  const context = sendContexts.find((value) => value.networkId === id);
  if (!context) throw new Error('Native sending is unavailable for this network');
  return context;
}
export function getNativeSendCapabilities(id: EvmNetworkId) {
  getNativeNetwork(id);
  return sendCapabilities[id];
}
export const nativeSigningEnabled = (id: EvmNetworkId): boolean => getNativeSendCapabilities(id).native;
export const erc20SigningEnabled = (id: EvmNetworkId): boolean => getNativeSendCapabilities(id).erc20;
