import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';
import { getNetworkConfigFromCoin } from '@sidhujag/sysweb3-network/cjs/networks.js';
import { isNonBlankNetworkText } from '../../../../source/shared/networkText.ts';
import { createUtxoRegistrationPin } from '../../../../source/shared/utxoRegistration.ts';
import { getDefaultUTXONetworks } from '../../../../source/utils/defaultNetworks.ts';

export type CustomUtxoNetworkId = `utxo:custom:${string}`;
export type UtxoNetworkId = 'syscoin' | 'bitcoin' | `utxo:${number}` | CustomUtxoNetworkId;
type AddressNetwork = ReturnType<typeof getNetworkConfigFromCoin>['networks']['mainnet'];
const sdkDefaults = getDefaultUTXONetworks();

export type UtxoRegistration = Readonly<{
  id: UtxoNetworkId;
  chainId: number;
  slip44: number;
  backendChain: string;
  endpoint: string;
  name: string;
  explorer: string;
}>;

export type UtxoNetwork = UtxoRegistration & Readonly<{
  kind: 'utxo';
  symbol: string;
  decimals: number;
  testnet: boolean;
  addressNetwork: AddressNetwork;
  publicKeyVersion: string;
  blockbookCoin: string;
  genesisHash: string;
}>;

const admitted = new WeakSet<UtxoNetwork>();
const fields = ['id', 'chainId', 'slip44', 'backendChain', 'endpoint', 'name', 'explorer'] as const;
const invalid = (): never => { throw new Error('Invalid UTXO registration'); };

export function isCustomUtxoNetworkId(id: unknown): id is CustomUtxoNetworkId {
  return typeof id === 'string' && /^utxo:custom:[0-9a-f]{32}$/.test(id);
}

export function newCustomUtxoNetworkId(): CustomUtxoNetworkId {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `utxo:custom:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function presetId(chainId: number): UtxoNetworkId {
  if (chainId === 57) return 'syscoin';
  if (chainId === 0) return 'bitcoin';
  return `utxo:${chainId}`;
}

export function canonicalUtxoEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value) || /[\s\\?#]/.test(value)) return invalid();
  const url = new URL(value);
  if (url.username || url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))))
    return invalid();
  return url.href.replace(/\/$/, '');
}

export function projectUtxoRegistration(input: unknown): UtxoNetwork {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).length !== fields.length) return invalid();
  const record: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
    record[field] = descriptor.value;
  }
  const { id, endpoint, name, explorer } = record;
  const { registration, backendChain } = createUtxoRegistrationPin({
    chainId: record.chainId, slip44: record.slip44, backendChain: record.backendChain,
  });
  const { chainId, slip44 } = registration;
  if ((!isCustomUtxoNetworkId(id) && (!sdkDefaults[chainId] || id !== presetId(chainId))) ||
      typeof endpoint !== 'string' || canonicalUtxoEndpoint(endpoint) !== endpoint ||
      !isNonBlankNetworkText(name) || !name.isWellFormed() || name.length > 128 || typeof explorer !== 'string')
    return invalid();
  canonicalUtxoEndpoint(explorer);
  const coin = findUtxoCoinByRegistration(registration);
  if (!coin || !/^[0-9a-f]{64}$/.test(coin.hashGenesisBlock)) return invalid();
  const testnet = coin.slip44 === 1;
  const { networks, types } = getNetworkConfigFromCoin(coin);
  const addressNetwork = testnet ? networks.testnet : networks.mainnet;
  const publicVersions = types.zPubType as (typeof types.zPubType & { testnet?: { vpub: string } }) | undefined;
  const publicKeyVersion = testnet ? publicVersions?.testnet?.vpub : publicVersions?.mainnet.zpub;
  if (!publicKeyVersion) return invalid();
  const network = Object.freeze({
    id: id as UtxoNetworkId, kind: 'utxo' as const, name, symbol: coin.coinShortcut,
    decimals: coin.decimals, chainId, slip44, testnet,
    addressNetwork: Object.freeze({ ...addressNetwork, bip32: Object.freeze({ ...addressNetwork.bip32 }) }),
    publicKeyVersion, blockbookCoin: testnet ? coin.coinLabel : coin.coinName,
    backendChain, genesisHash: coin.hashGenesisBlock, endpoint, explorer,
  });
  admitted.add(network);
  return network;
}

export function utxoRegistrationData(network: UtxoNetwork): UtxoRegistration {
  const { id, chainId, slip44, backendChain, endpoint, name, explorer } = resolveUtxoNetwork(network);
  return Object.freeze({ id, chainId, slip44, backendChain, endpoint, name, explorer });
}

/** Public-read registrations derived from the same default list as the extension. */
export const UTXO_NETWORKS: readonly UtxoNetwork[] = Object.freeze(
  Object.values(sdkDefaults)
    .sort((a, b) => Number(!!b.default) - Number(!!a.default))
    .map((network) => projectUtxoRegistration({
      id: presetId(network.chainId), chainId: network.chainId, slip44: network.slip44, backendChain: network.utxoBackendChain,
      endpoint: canonicalUtxoEndpoint(network.url), name: network.label,
      explorer: network.explorer,
    }))
);

export function findUtxoNetwork(id: unknown, registrations = UTXO_NETWORKS): UtxoNetwork | undefined {
  return registrations.find((entry) => entry.id === id);
}

export function getUtxoNetwork(id: unknown, registrations = UTXO_NETWORKS): UtxoNetwork {
  const network = findUtxoNetwork(id, registrations);
  if (!network || !admitted.has(network)) throw new Error('Unsupported UTXO network');
  return network;
}

/** A saved registration is a distinct, immutable authority from a shipped ID. */
export function resolveUtxoNetwork(scope: UtxoNetwork | UtxoNetworkId): UtxoNetwork {
  if (typeof scope === 'string') return getUtxoNetwork(scope);
  if (!admitted.has(scope)) throw new Error('Unverified UTXO registration');
  return scope;
}

/** Custody remains limited to the shared shipped defaults in this slice. */
export function getUtxoSdkNetwork(id: UtxoNetworkId): ReturnType<typeof getDefaultUTXONetworks>[number] {
  return { ...sdkDefaults[getUtxoNetwork(id).chainId]! };
}
