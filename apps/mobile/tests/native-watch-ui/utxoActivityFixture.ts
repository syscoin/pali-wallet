// Public synthetic REST data; the actual activity reader and WatchSession remain in use.
import { getUtxoNetwork } from '../../src/core/utxoNetworks';
export type ActivityMode = 'value' | 'empty' | 'error' | 'slow' | 'asset';
let mode: ActivityMode = 'value';
let release: (() => void) | null = null;
const calls: string[] = [], opened: string[] = [];
export const activityFixture = {
  mode(value: ActivityMode) { mode = value; }, calls: () => [...calls], opened: () => [...opened],
  release() { release?.(); release = null; mode = 'value'; },
  open(url: string) { opened.push(url); },
};
const id = (n: number) => n.toString(16).padStart(64, '0');
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
export async function activityFetch(input: RequestInfo | URL): Promise<Response | null> {
  const url = String(input), network = (['bitcoin', 'syscoin'] as const).map(getUtxoNetwork).find(n => url.startsWith(n.endpoint + '/'));
  if (!network) return null;
  calls.push(url);
  const path = url.slice(network.endpoint.length);
  if (mode === 'error') return new Response('fixture unavailable', { status: 503 });
  if (mode === 'slow' && path.includes('/address/')) await new Promise<void>(resolve => { release = resolve; });
  if (path === '/api/') return json({ blockbook: { coin: network.blockbookCoin, network: network.symbol, decimals: 8, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 200 }, backend: { chain: 'main' } });
  if (path.includes('/block-index/')) return json({ blockHash: path.endsWith('/0') ? network.genesisHash : (path.endsWith('/200') ? 'a' : 'b').repeat(64) });
  const address = network.id === 'bitcoin' ? 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' : 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
  if (path.includes('/address/')) {
    const page = Number(new URL(url).searchParams.get('page')), count = mode === 'empty' ? 0 : 23;
    return json({ address, txs: count, unconfirmedTxs: 0, page, itemsOnPage: 20, totalPages: count ? 2 : 1,
      txids: Array.from({ length: Math.min(20, Math.max(0, count - (page - 1) * 20)) }, (_, i) => id((page - 1) * 20 + i + 1)) });
  }
  if (path.includes('/tx/')) return json({ txid: path.split('/').at(-1), blockHeight: 190, blockHash: 'b'.repeat(64), confirmations: 11, blockTime: 1700000000,
    valueIn: '1100000000', value: '1000000000', fees: '100000000', ...(mode === 'asset' ? { tokenType: 'SPT', memo: '<img src=hostile>', tokenTransfers: [{ value: '999999999' }] } : {}),
    vin: [{ n: 0, txid: id(900), addresses: [address], isAddress: true, value: '1100000000' }],
    vout: [{ n: 0, addresses: [address], isAddress: true, value: '100000000' }, { n: 1, addresses: ['1UnrelatedLegacyAddress'], isAddress: true, value: '900000000' }] });
  throw Error('Unexpected activity fixture path');
}
