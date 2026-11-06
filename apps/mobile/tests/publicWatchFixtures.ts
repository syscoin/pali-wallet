import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { resolveUtxoNetwork, type UtxoNetwork, type UtxoNetworkId } from '../src/core/utxoNetworks.ts';
import type { StoredWatchAccount } from '../src/core/watchAccountCodec.ts';
// BIP173 public witness program under each supported address prefix.
export const UTXO_ADDRESSES = {
  syscoin: 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58',
  bitcoin: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  'utxo:5700': 'tsys1qw508d6qejxtdg4y5r3zarvary0c5xw7kn9mz8d',
} as const;
export const XPUB = 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
export const KEY = parseUtxoPublicIdentifier(XPUB, 'bitcoin').identifier;
export const keyRecord = (id = 'key', networkId: UtxoNetworkId = 'bitcoin', identifier = XPUB): StoredWatchAccount => ({ kind: 'utxo-public', id, name: id, networkId, identifier });
export const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
export const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
export const metadata = (networkId: UtxoNetworkId | UtxoNetwork) => {
  const n = resolveUtxoNetwork(networkId);
  return { blockbook: { coin: n.blockbookCoin, network: n.symbol, decimals: n.decimals, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 123 }, backend: { chain: n.backendChain } };
};
