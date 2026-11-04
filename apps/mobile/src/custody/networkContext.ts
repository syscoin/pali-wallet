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
/** Stage 1 adds context/read identities only. Signing remains Ethereum-only. */
export const nativeSigningEnabled = (id: EvmNetworkId): boolean => id === 'ethereum';
