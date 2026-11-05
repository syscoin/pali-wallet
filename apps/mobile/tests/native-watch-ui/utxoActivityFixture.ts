// Public synthetic account-history data. The real authority, shared SJS reader
// and WatchSession remain in use; no signing or live endpoint is available.
import { getUtxoNetwork } from '../../src/core/utxoNetworks';
export type ActivityMode = 'value' | 'empty' | 'error' | 'slow' | 'asset' | 'pending' | 'included' | 'unknown' | 'window';
const modes: readonly string[] = ['value', 'empty', 'error', 'slow', 'asset', 'pending', 'included', 'unknown', 'window'];
const initial = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('activity-mode');
let mode: ActivityMode = modes.includes(initial ?? '') ? initial as ActivityMode : 'value';
let release: (() => void) | null = null;
let cancelled = 0;
const calls: string[] = [], opened: string[] = [];
export const activityFixture = {
  mode(value: ActivityMode) { mode = value; }, cancelled: () => cancelled, calls: () => [...calls], opened: () => [...opened],
  release() { release?.(); release = null; mode = 'value'; },
  open(url: string) { opened.push(url); },
};
const id = (n: number) => n.toString(16).padStart(64, '0');
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
export async function activityFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const url = String(input), network = (['bitcoin', 'syscoin'] as const).map(getUtxoNetwork).find(n => url.startsWith(n.endpoint + '/'));
  if (!network) return null;
  calls.push(url);
  const parsed = new URL(url), path = parsed.pathname;
  if (mode === 'error') return new Response('fixture unavailable', { status: 503 });
  if (path === '/api/') return json({ blockbook: { coin: network.blockbookCoin, network: network.symbol, decimals: 8, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 200 }, backend: { chain: 'main' } });
  if (path.endsWith('/block-index/0')) return json({ blockHash: network.genesisHash });
  const marker = path.includes('/xpub/') ? '/xpub/' : path.includes('/address/') ? '/address/' : null;
  if (!marker) throw Error('Unexpected account-history fixture path');
  if (init?.signal?.aborted) throw new DOMException('Fixture request cancelled', 'AbortError');
  if (mode === 'slow') await new Promise<void>((resolve, reject) => {
    const signal = init?.signal;
    const clear = () => { signal?.removeEventListener('abort', abort); if (release === resume) release = null; };
    const resume = () => { clear(); resolve(); };
    const abort = () => { cancelled++; clear(); reject(new DOMException('Fixture request cancelled', 'AbortError')); };
    release = resume; signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  const identifier = decodeURIComponent(path.slice(path.indexOf(marker) + marker.length));
  const page = Number(parsed.searchParams.get('page') ?? 1), pageSize = Number(parsed.searchParams.get('pageSize') ?? 20);
  const count = mode === 'empty' ? 0 : mode === 'window' ? 123 : 23;
  const address = network.id === 'bitcoin' ? 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' : 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
  const rows = Array.from({ length: Math.min(pageSize, Math.max(0, count - (page - 1) * pageSize)) }, (_, offset) => {
    const n = (page - 1) * pageSize + offset + 1, pending = mode === 'pending' && n === 1;
    return { txid: id(n), blockHeight: pending ? -1 : 190, blockHash: pending ? undefined : 'b'.repeat(64), confirmations: pending || mode === 'included' ? 0 : 11, blockTime: pending ? 0 : 1700000000,
      valueIn: '1100000000', value: '1000000000', fees: '100000000',
      ...(mode === 'unknown' ? {} : { addressValueIn: '1100000000', addressValueOut: '100000000' }),
      ...(mode === 'asset' ? { tokenType: 'SPT', memo: '<img src=hostile>', tokenTransfers: [{ value: '999999999' }] } : {}),
      vin: [{ n: 0, txid: id(900), addresses: [address], isAddress: true, ...(mode === 'unknown' ? {} : { isOwn: true }), value: '1100000000' }],
      vout: [{ n: 0, addresses: [address], isAddress: true, ...(mode === 'unknown' ? {} : { isOwn: true }), value: '100000000' }, { n: 1, addresses: ['1UnrelatedLegacyAddress'], isAddress: true, ...(mode === 'unknown' ? {} : { isOwn: false }), value: '900000000' }] };
  });
  return json({ address: identifier, balance: '100000000', unconfirmedBalance: '0', txs: count, unconfirmedTxs: mode === 'pending' ? 1 : 0,
    page, itemsOnPage: pageSize, totalPages: Math.max(1, Math.ceil(count / (pageSize || 20))), transactions: rows });
}
