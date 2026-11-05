import { keccak256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';
import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks.ts';
import { isNonBlankNetworkText } from '../../../../source/shared/networkText.ts';
import { findUtxoNetwork } from '../core/utxoNetworks.ts';

/** A saved registration ID, not a compile-time list of supported EVM chains. */
export type EvmNetworkId = string;
export type NativeNetworkRegistration = Readonly<{
  id: EvmNetworkId; name: string; kind: 'evm'; chainId: string; slip44: 60; rpcUrl: string;
  symbol: string; decimals: 18; testnet: boolean; registrationHash: string;
}>;
const fields = ['id', 'name', 'kind', 'chainId', 'slip44', 'rpcUrl', 'symbol', 'decimals', 'testnet'] as const;
/** Strict detached snapshot: persisted registrations, never defaults, own their endpoints. */
export function snapshotNativeNetwork(input: unknown): NativeNetworkRegistration {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('Invalid EVM registration');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== fields.length + 1 || keys.some((key) => typeof key !== 'string' || ![...fields, 'registrationHash'].includes(key as typeof fields[number]))) throw new Error('Invalid EVM registration');
  const raw: Record<string, unknown> = Object.create(null);
  for (const key of [...fields, 'registrationHash']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('Invalid EVM registration');
    raw[key] = descriptor.value;
  }
  if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/.test(raw.id) ||
      !isNonBlankNetworkText(raw.name) ||
      raw.kind !== 'evm' || typeof raw.chainId !== 'string' || !/^[1-9][0-9]{0,15}$/.test(raw.chainId) ||
      BigInt(raw.chainId) > BigInt(Number.MAX_SAFE_INTEGER) || raw.slip44 !== 60 || raw.decimals !== 18 ||
      typeof raw.testnet !== 'boolean' || !isNonBlankNetworkText(raw.symbol) ||
      typeof raw.rpcUrl !== 'string' || raw.rpcUrl.length > 2048) throw new Error('Invalid EVM registration');
  const url = new URL(raw.rpcUrl);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Invalid EVM endpoint');
  const registrationHash = keccak256(toUtf8Bytes(JSON.stringify(fields.map((key) => raw[key]))));
  if (raw.registrationHash !== registrationHash) throw new Error('Invalid EVM registration fingerprint');
  return Object.freeze(raw) as NativeNetworkRegistration;
}
export function createNativeNetwork(data: Omit<NativeNetworkRegistration, 'registrationHash'>): NativeNetworkRegistration {
  return snapshotNativeNetwork({ ...data, registrationHash: keccak256(toUtf8Bytes(JSON.stringify(fields.map((key) => data[key])))) });
}
export const NATIVE_NETWORKS: readonly NativeNetworkRegistration[] = Object.freeze(
  EVM_NETWORK_DEFINITIONS.map(({ id, name, network, testnet }) => createNativeNetwork({ id, name, kind: 'evm', chainId: String(network.chainId),
    slip44: 60, rpcUrl: network.url, symbol: network.currency.toUpperCase(), decimals: 18, testnet }))
);
export function getNativeNetwork(id: string, registrations: readonly NativeNetworkRegistration[] = NATIVE_NETWORKS): NativeNetworkRegistration {
  const network = registrations.find((value) => value.id === id);
  if (!network) throw new Error('Unknown EVM registration');
  return network;
}
/** Resource bounds are checked against the selected chain's RPC block gas limit. */
export const nativeTransferGasLimit = (_id?: EvmNetworkId): bigint => BigInt(Number.MAX_SAFE_INTEGER);
export type NativeSendContext = Readonly<{
  networkId: EvmNetworkId; chainId: string; registrationHash: string; rpcUrl: string;
  name: string; symbol: string; decimals: 18; testnet: boolean;
}>;
const contexts = new WeakMap<NativeNetworkRegistration, NativeSendContext>();
export function getNativeSendContext(input: string | NativeNetworkRegistration, registrations?: readonly NativeNetworkRegistration[]): NativeSendContext {
  const network = typeof input === 'string' ? getNativeNetwork(input, registrations) : input;
  let context = contexts.get(network);
  if (!context) {
    snapshotNativeNetwork(network);
    context = Object.freeze({ networkId: network.id, chainId: network.chainId, registrationHash: network.registrationHash,
      rpcUrl: network.rpcUrl, name: network.name,
      symbol: network.symbol, decimals: network.decimals, testnet: network.testnet });
    contexts.set(network, context);
  }
  return context;
}
/** UI eligibility only; signing additionally validates the selected saved registration. */
export const nativeSigningEnabled = (id: EvmNetworkId, registrations: readonly NativeNetworkRegistration[] = NATIVE_NETWORKS): boolean =>
  !findUtxoNetwork(id) && registrations.some((network) => network.kind === 'evm' && network.id === id);
export const erc20SigningEnabled = nativeSigningEnabled;
export function getNativeSendCapabilities(id: EvmNetworkId, registrations?: readonly NativeNetworkRegistration[]) {
  const enabled = nativeSigningEnabled(id, registrations);
  return Object.freeze({ native: enabled, erc20: enabled });
}
