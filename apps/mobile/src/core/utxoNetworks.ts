/** Fixed public-read registrations only. These do not enable wallet capabilities. */
export type UtxoNetworkId = 'syscoin' | 'bitcoin';
export type UtxoNetwork = Readonly<{
  id: UtxoNetworkId;
  kind: 'utxo';
  name: string;
  symbol: 'SYS' | 'BTC';
  decimals: 8;
  chainId: 57 | 0;
  slip44: 57 | 0;
  addressHrp: 'sys' | 'bc';
  blockbookCoin: 'Syscoin' | 'Bitcoin';
  backendChain: 'main';
  genesisHash: string;
  endpoint: string;
}>;

// Fixed mobile providers: the extension's Syscoin explorer and the Bitcoin
// endpoint in the pinned SDK coin list. Their canonical origins were verified
// without redirect following. Genesis hashes/HRPs match SDK data and Syscoin Core.
// No testnet, alternate endpoint or numeric-only network selection is accepted.
export const UTXO_NETWORKS: readonly UtxoNetwork[] = Object.freeze([
  Object.freeze({
    id: 'syscoin', kind: 'utxo', name: 'Syscoin UTXO', symbol: 'SYS', decimals: 8,
    chainId: 57, slip44: 57, addressHrp: 'sys', blockbookCoin: 'Syscoin', backendChain: 'main',
    genesisHash: '0000022642db0346b6e01c2a397471f4f12e65d4f4251ec96c1f85367a61a7ab',
    endpoint: 'https://explorer-blockbook.syscoin.org',
  }),
  Object.freeze({
    id: 'bitcoin', kind: 'utxo', name: 'Bitcoin', symbol: 'BTC', decimals: 8,
    chainId: 0, slip44: 0, addressHrp: 'bc', blockbookCoin: 'Bitcoin', backendChain: 'main',
    genesisHash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    endpoint: 'https://blockbook.btc.zelcore.io',
  }),
] satisfies UtxoNetwork[]);

export function getUtxoNetwork(id: UtxoNetworkId): UtxoNetwork {
  const network = UTXO_NETWORKS.find((entry) => entry.id === id);
  if (!network) throw new Error('Unsupported UTXO network');
  return network;
}
