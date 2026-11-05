import { coins } from '@sidhujag/sysweb3-network/cjs/coins.js';
import { getNetworkConfigFromCoin } from '@sidhujag/sysweb3-network/cjs/networks.js';
import { getDefaultUTXONetworks } from '../../../../source/utils/defaultNetworks.ts';

export type UtxoNetworkId = 'syscoin' | 'bitcoin' | `utxo:${number}`;
type AddressNetwork = ReturnType<typeof getNetworkConfigFromCoin>['networks']['mainnet'];

function registrationId(chainId: number): UtxoNetworkId {
  // Keep the IDs already used by saved public accounts.
  if (chainId === 57) return 'syscoin';
  if (chainId === 0) return 'bitcoin';
  return `utxo:${chainId}`;
}

export type UtxoNetwork = Readonly<{
  id: UtxoNetworkId;
  kind: 'utxo';
  name: string;
  symbol: string;
  decimals: number;
  chainId: number;
  slip44: number;
  testnet: boolean;
  addressNetwork: AddressNetwork;
  publicKeyVersion: string;
  blockbookCoin: string;
  backendChain: ReturnType<typeof getDefaultUTXONetworks>[number]['utxoBackendChain'];
  genesisHash: string;
  endpoint: string;
  explorer: string;
}>;

const sdkDefaults = getDefaultUTXONetworks();

/** Public-read registrations derived from the extension defaults and the pinned SDK coin catalogue. */
export const UTXO_NETWORKS: readonly UtxoNetwork[] = Object.freeze(
  Object.values(sdkDefaults)
    .sort((a, b) => Number(!!b.default) - Number(!!a.default))
    .map((network): UtxoNetwork => {
      const coin = coins.find((entry) => (entry.chainId ?? entry.slip44) === network.chainId &&
        entry.slip44 === network.slip44 && entry.coinShortcut.toLowerCase() === network.currency.toLowerCase());
      if (!coin || !network.explorer) throw new Error('Incomplete default UTXO registration');
      const testnet = coin.slip44 === 1;
      const { networks, types } = getNetworkConfigFromCoin(coin);
      const addressNetwork = testnet ? networks.testnet : networks.mainnet;
      // SDK 1.0.111's declaration omits the testnet member of its zPubType.
      const publicVersions = types.zPubType as (typeof types.zPubType & { testnet?: { vpub: string } }) | undefined;
      const publicKeyVersion = testnet ? publicVersions?.testnet?.vpub : publicVersions?.mainnet.zpub;
      if (!publicKeyVersion) throw new Error('Incomplete default UTXO key versions');
      return Object.freeze({
        id: registrationId(network.chainId), kind: 'utxo', name: network.label, symbol: coin.coinShortcut,
        decimals: coin.decimals, chainId: network.chainId, slip44: coin.slip44, testnet,
        addressNetwork: Object.freeze({ ...addressNetwork, bip32: Object.freeze({ ...addressNetwork.bip32 }) }),
        publicKeyVersion,
        blockbookCoin: testnet ? coin.coinLabel : coin.coinName,
        backendChain: network.utxoBackendChain,
        genesisHash: coin.hashGenesisBlock,
        endpoint: network.url.replace(/\/$/, ''),
        explorer: network.explorer,
      });
    })
);

export function findUtxoNetwork(id: unknown): UtxoNetwork | undefined {
  return UTXO_NETWORKS.find((entry) => entry.id === id);
}

export function getUtxoNetwork(id: unknown): UtxoNetwork {
  const network = findUtxoNetwork(id);
  if (!network) throw new Error('Unsupported UTXO network');
  return network;
}

/** The same default registration configures the SDK account scope. */
export function getUtxoSdkNetwork(id: UtxoNetworkId): ReturnType<typeof getDefaultUTXONetworks>[number] {
  return { ...sdkDefaults[getUtxoNetwork(id).chainId]! };
}
