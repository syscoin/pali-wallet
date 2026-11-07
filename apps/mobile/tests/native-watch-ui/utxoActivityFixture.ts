// Public synthetic account-history data. The real authority, shared SJS reader
// and WatchSession remain in use; no signing or live endpoint is available.
import { utils } from 'syscoinjs-lib';
import { getUtxoNetwork, UTXO_NETWORKS } from '../../src/core/utxoNetworks';
import { UTXO_ADDRESSES } from '../publicWatchFixtures';
import { SENTRY_TX_HEX, SENTRY_TXID, sentryNodeResponse } from '../sentryNodeFixtures';
export type ActivityMode = 'value' | 'empty' | 'error' | 'slow' | 'asset' | 'pending' | 'included' | 'unknown' | 'window' | 'asset-exact' | 'asset-owned' | 'asset-bridge' | 'asset-invalid' | 'asset-hostile' | 'asset-max' | 'late' | 'sentry';
const modes: readonly string[] = ['value', 'empty', 'error', 'slow', 'asset', 'pending', 'included', 'unknown', 'window', 'asset-exact', 'asset-owned', 'asset-bridge', 'asset-invalid', 'asset-hostile', 'asset-max', 'late', 'sentry'];
const initial = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('activity-mode');
let mode: ActivityMode = modes.includes(initial ?? '') ? initial as ActivityMode : 'value';
let release: (() => void) | null = null;
let cancelled = 0;
let lateResponses = 0;
type DetailMode = 'value' | 'error' | 'slow' | 'wrong' | 'reorg';
let detailMode: DetailMode = 'value';
let releaseDetail: (() => void) | null = null;
const calls: string[] = [], opened: string[] = [];
export const activityFixture = {
  mode(value: ActivityMode) { mode = value; }, cancelled: () => cancelled, calls: () => [...calls], opened: () => [...opened],
  lateResponses: () => lateResponses,
  release() { release?.(); release = null; mode = 'value'; },
  open(url: string) { opened.push(url); },
  detail(value: DetailMode) { detailMode = value; },
  releaseDetail() { releaseDetail?.(); releaseDetail = null; detailMode = 'value'; },
};
const id = (n: number) => n.toString(16).padStart(64, '0');
// Account-page SPT shape follows Blockbook accountAssetTransfersFromSummary:
// decimal uint64 identity and absolute atomic value, without asset direction.
function assetData() {
  if (!mode.startsWith('asset-')) return {};
  const guid = mode === 'asset-hostile' ? 'xpub-provider-metadata' : '987654321';
  const decimals = mode === 'asset-owned' ? 8 : 0;
  const symbol = mode === 'asset-hostile' ? 'BIG\u202eSPOOF' : mode === 'asset-owned' ? 'ATOM' : 'BIG';
  const transfer = { type: 'SPT', standard: 'SPT', contract: guid, assetGuid: guid, decimals, symbol,
    value: mode === 'asset-invalid' ? '9'.repeat(79) : mode === 'asset-max' ? '9'.repeat(78) : '9007199254740993' };
  return { tokenType: mode === 'asset-bridge' ? 'SPTAssetAllocationBurnToNEVM' : 'SPTAssetAllocationSend',
    tokenTransfers: [transfer], ...(mode === 'asset-owned' ? {
      vin: [{ isOwn: true, value: '1100000000', assetInfo: { assetGuid: guid, value: '9007199254740992' } }],
      vout: [{ isOwn: true, value: '100000000', assetInfo: { assetGuid: guid, value: '9007199254740993' } }],
    } : { accountAssetTransfers: [transfer], vin: [], vout: [] }) };
}
function transaction(n: number, network: ReturnType<typeof getUtxoNetwork>): Record<string, any> {
  const address = UTXO_ADDRESSES[network.id as keyof typeof UTXO_ADDRESSES];
  const recipient = utils.bitcoinjs.payments.p2pkh({
    hash: new Uint8Array(20).fill(17),
    network: network.addressNetwork,
  }).address!;
  const pending = mode === 'pending' && n === 1;
    return { txid: mode === 'sentry' && n === 1 ? SENTRY_TXID : id(n + (mode.startsWith('asset') ? (modes.indexOf(mode) + 1) * 1000 : 0)), blockHeight: pending ? -1 : 190, blockHash: pending ? undefined : 'b'.repeat(64), confirmations: pending || mode === 'included' ? 0 : 11, blockTime: pending ? 0 : 1700000000,
      valueIn: '1100000000', value: '1000000000', fees: '100000000',
      ...(mode === 'unknown' ? {} : { addressValueIn: '1100000000', addressValueOut: '100000000' }),
      ...(mode === 'asset' ? { tokenType: 'SPT', memo: '<img src=hostile>', tokenTransfers: [{ value: '999999999' }] } : {}),
      vin: [{ n: 0, txid: id(900), addresses: [address], isAddress: true, ...(mode === 'unknown' ? {} : { isOwn: true }), value: '1100000000' }],
      vout: [{ n: 0, addresses: [address], isAddress: true, ...(mode === 'unknown' ? {} : { isOwn: true }), value: '100000000' }, { n: 1, addresses: [recipient], isAddress: true, ...(mode === 'unknown' ? {} : { isOwn: false }), value: '900000000' }], ...assetData() };
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
export async function activityFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const url = String(input);
  if (mode === 'sentry' && url === `https://sysnode.info/api/sentry/v1/context?network=mainnet&proTxHash=${SENTRY_TXID}`) {
    if (init?.method !== 'GET' || init.credentials !== 'omit' || init.redirect !== 'error' || init.body)
      throw Error('Unexpected Sentry wire request');
    calls.push(url);
    return json(sentryNodeResponse(getUtxoNetwork('syscoin').genesisHash));
  }
  const network = UTXO_NETWORKS.find(n => url.startsWith(n.endpoint + '/'));
  if (!network) return null;
  calls.push(url);
  const parsed = new URL(url), path = parsed.pathname;
  if (mode === 'error') return new Response('fixture unavailable', { status: 503 });
  if (path === '/api/v2/') return json({ blockbook: { coin: network.blockbookCoin, network: network.symbol, decimals: network.decimals, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 200 }, backend: { chain: network.backendChain } });
  if (path.endsWith('/block-index/0')) return json({ blockHash: network.genesisHash });
  if (path.startsWith('/api/v2/tx/')) {
    const observedMode = detailMode;
    if (observedMode === 'error') return new Response('detail unavailable', { status: 503 });
    if (observedMode === 'slow') await new Promise<void>((resolve, reject) => {
      const signal = init?.signal;
      const clear = () => { signal?.removeEventListener('abort', abort); if (releaseDetail === resume) releaseDetail = null; };
      const resume = () => { clear(); resolve(); };
      const abort = () => { cancelled++; clear(); reject(new DOMException('Fixture detail cancelled', 'AbortError')); };
      releaseDetail = resume; signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    const txid = path.slice('/api/v2/tx/'.length), sentry = mode === 'sentry' && txid === SENTRY_TXID;
    const n = sentry ? 1 : Number.parseInt(txid, 16);
    const summary = transaction(n, network);
    const { addressValueIn: _in, addressValueOut: _out, accountAssetTransfers: _assets, ...body } = summary;
    const withoutOwnership = (entry: Record<string, unknown>) => { const { isOwn: _own, ...value } = entry; return value; };
    const full = { ...body, txid: observedMode === 'wrong' ? id(n + 1) : txid,
      vin: summary.vin.map(withoutOwnership), vout: summary.vout.map(withoutOwnership) };
    if (sentry) Object.assign(full, { version: 80, hex: SENTRY_TX_HEX });
    if (mode === 'asset-bridge') full.vout.push({ n: 2, addresses: ['OP_RETURN synthetic'], isAddress: false, hex: '6a', value: '0', assetInfo: { assetGuid: '987654321', value: '9007199254740994' } });
    if (observedMode === 'reorg') Object.assign(full, { blockHeight: -1, blockHash: undefined, blockTime: 0, confirmations: 0 });
    return json(full);
  }
  const marker = path.includes('/xpub/') ? '/xpub/' : path.includes('/address/') ? '/address/' : null;
  if (!marker) throw Error('Unexpected account-history fixture path');
  if (init?.signal?.aborted) throw new DOMException('Fixture request cancelled', 'AbortError');
  const late = mode === 'late';
  if (mode === 'slow' || late) await new Promise<void>((resolve, reject) => {
    // Model an indexer response arriving after its request owner was revoked.
    const signal = late ? undefined : init?.signal;
    const clear = () => { signal?.removeEventListener('abort', abort); if (release === resume) release = null; };
    const resume = () => { clear(); resolve(); };
    const abort = () => { cancelled++; clear(); reject(new DOMException('Fixture request cancelled', 'AbortError')); };
    release = resume; signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  const identifier = decodeURIComponent(path.slice(path.indexOf(marker) + marker.length));
  const page = Number(parsed.searchParams.get('page') ?? 1), pageSize = Number(parsed.searchParams.get('pageSize') ?? 20);
  const count = mode === 'empty' ? 0 : mode === 'window' ? 123 : 23;
  const rows = Array.from({ length: Math.min(pageSize, Math.max(0, count - (page - 1) * pageSize)) }, (_, offset) => transaction((page - 1) * pageSize + offset + 1, network));
  if (late) lateResponses++;
  return json({ address: identifier, balance: '100000000', unconfirmedBalance: '0', txs: count, unconfirmedTxs: mode === 'pending' ? 1 : 0,
    page, itemsOnPage: pageSize, totalPages: Math.max(1, Math.ceil(count / (pageSize || 20))), transactions: rows });
}
