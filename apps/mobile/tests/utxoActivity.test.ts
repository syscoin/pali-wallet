import assert from 'node:assert/strict';
import test from 'node:test';
import { createUtxoActivityReader, UtxoWatchActivity, type UtxoActivityContext, type UtxoActivitySource } from '../src/core/utxoActivity.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { BigNumber } from '../../../source/utils/ethersV6Compat.ts';
import { XPUB } from './publicWatchFixtures.ts';
const BTC = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', SYS = 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
const H = 'a'.repeat(64), BLOCK = 'b'.repeat(64), ID = (n: number) => n.toString(16).padStart(64, '0');
const owner: UtxoActivityContext = { accountId: 'watch', networkId: 'bitcoin', address: BTC, generation: 1 };
const source: UtxoActivitySource = { context: owner, identifier: BTC, isAccount: false };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const status = (network = getUtxoNetwork('bitcoin')) => ({ blockbook: { coin: network.blockbookCoin, network: network.symbol, decimals: 8, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 200 }, backend: { chain: 'main' } });
function tx(id = ID(1)) {
  return { txid: id, blockHeight: 190, blockHash: BLOCK, confirmations: 11, blockTime: 1700000000,
    addressValueIn: '1100000000', addressValueOut: '100000000', valueIn: '1100000000', value: '1000000000', fees: '100000000',
    vin: [{ value: '1100000000', isOwn: true }], vout: [{ value: '100000000', isOwn: true }, { value: '900000000', isOwn: false }] };
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(options: { count?: number; network?: 'bitcoin' | 'syscoin'; replace?: (path: string, value: any, calls: string[]) => unknown; hold?: (path: string) => Promise<void> } = {}) {
  const calls: string[] = [], signals: AbortSignal[] = [], network = getUtxoNetwork(options.network ?? 'bitcoin');
  const fetch = async (url: string, init: RequestInit) => {
    assert.ok(url.startsWith(network.endpoint)); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const path = url.slice(network.endpoint.length); calls.push(path); signals.push(init.signal!); await options.hold?.(path);
    let value: any;
    if (path === '/api/v2/') value = status(network);
    else if (path === '/api/v2/block-index/0') value = { blockHash: network.genesisHash };
    else if (/^\/api\/v2\/(?:address|xpub)\//.test(path)) {
      const query = new URL(url).searchParams, page = Number(query.get('page')), count = options.count ?? 23;
      assert.ok(['txsummary', 'txslight'].includes(query.get('details')!)); assert.equal(query.get('pageSize'), '20');
      const identifier = decodeURIComponent(new URL(url).pathname.split('/').at(-1)!);
      value = { address: identifier, txs: count, unconfirmedTxs: 0, page, totalPages: Math.max(1, Math.ceil(count / 20)), itemsOnPage: 20,
        transactions: Array.from({ length: Math.min(20, Math.max(0, count - (page - 1) * 20)) }, (_, i) => tx(ID((page - 1) * 20 + i + 1))) };
    } else throw Error('Unplanned URL');
    const replacement = options.replace?.(path, value, calls);
    return replacement instanceof Response ? replacement : json(replacement ?? value);
  };
  return { fetch, calls, signals };
}
const signal = () => new AbortController().signal;
const read = (f: ReturnType<typeof fixture>, page = 1, input = source) => createUtxoActivityReader(f).readPage(input, { page }, signal());
const tick = () => new Promise<void>(r => setImmediate(r));
async function settle(c: UtxoWatchActivity) { for (let i = 0; i < 100 && ['idle', 'loading'].includes(c.getSnapshot().status); i++) await tick(); }
function authority(f: ReturnType<typeof fixture>) {
  return new WatchOnlyAuthority([{ id: 'watch', name: 'First', addresses: { bitcoin: BTC } }, { id: 'other', name: 'Second', addresses: { syscoin: SYS } }],
    { async readBalance() { throw Error(); } }, undefined, undefined, createUtxoActivityReader(f));
}
test('actual SJS account read is bounded and does not fan out transactions or enforce an anchor', async () => {
  const f = fixture(), page = await read(f);
  assert.deepEqual(f.calls, ['/api/v2/', '/api/v2/block-index/0', `/api/v2/address/${BTC}?details=txsummary&page=1&pageSize=20`]);
  assert.equal(page.rows.length, 20); assert.equal(page.rows[0]?.netUnits, '-1000000000'); assert.equal(page.rows[0]?.nativeTransfer?.amount, '900000000');
  assert.equal(page.rows[0]?.observedConfirmations, 11); assert.equal(page.hasMore, true); assert.ok(f.signals.every(s => s.aborted));
  assert.ok(Object.isFrozen(page) && Object.isFrozen(page.rows) && Object.isFrozen(page.rows[0]?.block));
});
for (const identifier of [XPUB, `sh(wpkh(${XPUB}/0/*))`]) test('canonical public account/descriptor goes through actual SJS xpub route without public source output', async () => {
  const parsed = parseUtxoPublicIdentifier(identifier, 'bitcoin'), f = fixture();
  const input = { context: { ...owner, address: parsed.address }, identifier: parsed.identifier, isAccount: true };
  const page = await read(f, 1, input);
  assert.equal(f.calls[2], `/api/v2/xpub/${encodeURIComponent(parsed.identifier)}?details=txsummary&page=1&pageSize=20`);
  assert.ok(!JSON.stringify(page).includes(parsed.identifier)); assert.equal(page.context.address, parsed.address);
});
test('whole-account input/change ownership comes from shared Blockbook normalization', async () => {
  const f = fixture({ count: 1, replace(path, body) { if (path.includes('/address/')) { const row = body.transactions[0]; delete row.addressValueIn; delete row.addressValueOut; row.vin = [{ value: '1100000000', isOwn: true, addresses: ['unrendered-receive'] }]; row.vout[0].addresses = ['unrendered-change']; } return body; } });
  const [row] = (await read(f)).rows; assert.equal(row?.netUnits, '-1000000000'); assert.equal(row?.nativeTransfer?.amount, '900000000');
  assert.ok(!JSON.stringify(row).includes('unrendered'));
});
test('pending and missing block observations remain valid activity', async () => {
  const f = fixture({ count: 1, replace(path, body) { if (path.includes('/address/')) Object.assign(body.transactions[0], { blockHeight: -1, blockHash: undefined, blockTime: undefined, confirmations: 0 }); return body; } });
  const [row] = (await read(f)).rows; assert.equal(row?.block, null); assert.equal(row?.observedConfirmations, 0);
});
test('native exact quantities, fee, receipt, self and ambiguous collaborative intent share extension helpers', async () => {
  const large = '900719925474099300';
  for (const kind of ['large', 'receipt', 'self', 'collaborative', 'coinbase']) {
    const f = fixture({ count: 1, replace(path, body) { if (path.includes('/address/')) {
      const row = body.transactions[0];
      if (kind === 'large') Object.assign(row, { addressValueIn: large, addressValueOut: '0', fees: '1', vin: [{ value: large }], vout: [{ value: '900719925474099299' }] });
      if (kind === 'receipt' || kind === 'coinbase') Object.assign(row, { addressValueIn: '0', addressValueOut: large, ...(kind === 'coinbase' ? { vin: [{ coinbase: '0102' }], fees: '0' } : {}) });
      if (kind === 'self') Object.assign(row, { addressValueOut: '1000000000' });
      if (kind === 'collaborative') row.vin.push({ value: '2' });
    } return body; } });
    const row = (await read(f)).rows[0]!;
    if (kind === 'large') { assert.equal(row.nativeTransfer?.amount, '900719925474099299'); assert.equal(row.transactionFeeUnits, '1'); }
    if (kind === 'receipt' || kind === 'coinbase') { assert.equal(row.netUnits, large); assert.equal(row.nativeTransfer?.kind, 'received'); }
    if (kind === 'self') assert.equal(row.nativeTransfer?.kind, 'self');
    if (kind === 'collaborative') assert.equal(row.nativeTransfer, null);
  }
});
test('asset quantities and script metadata never leak or become native amounts', async () => {
  const f = fixture({ count: 1, replace(path, body) { if (path.includes('/address/')) Object.assign(body.transactions[0], { tokenType: 'SPTAssetAllocationSend', memo: '<img>', tokenTransfers: [{ value: '999999999999999999' }] }); return body; } });
  const page = await read(f); assert.equal(page.rows[0]?.hasAssetData, true); assert.equal(page.rows[0]?.nativeTransfer, null); assert.equal(page.rows[0]?.netUnits, '-1000000000');
  assert.ok(!JSON.stringify(page).includes('999999999') && !JSON.stringify(page).includes('<img>'));
});
test('unknown account totals remain null rather than zero or transaction-wide aliases', async () => {
  const f = fixture({ count: 1, replace(path, body) { if (path.includes('/address/')) { delete body.transactions[0].addressValueIn; delete body.transactions[0].addressValueOut; body.transactions[0].vin=[]; } return body; } });
  const row = (await read(f)).rows[0]!; assert.equal(row.netUnits, null); assert.equal(row.nativeTransfer, null);
});
test('explicit zero counts without transactions are empty; incomplete positive counts require fallback', async () => {
  const empty = fixture({ count: 0, replace(path, body) { if (path.includes('/address/')) delete body.transactions; return body; } });
  assert.equal((await read(empty)).rows.length, 0);
  const f = fixture({ count: 1, replace(path, body) { if (path.includes('details=txsummary')) delete body.transactions; return body; } });
  const reader = createUtxoActivityReader(f); assert.equal((await reader.readPage(source, { page: 1 }, signal())).rows.length, 1);
  assert.ok(f.calls[3]?.includes('details=txslight')); await reader.readPage(source, { page: 2 }, signal()); assert.ok(f.calls.at(-1)?.includes('details=txslight'));
});
test('bad local context, page or source rejects before I/O', async () => {
  const f = fixture(), reader = createUtxoActivityReader(f);
  for (const value of [{ ...source, context: { ...owner, address: SYS } }, { ...source, context: { ...owner, generation: -1 } }, { ...source, isAccount: true, identifier: 'not-public' }]) await assert.rejects(reader.readPage(value, { page: 1 }, signal()));
  for (const page of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(reader.readPage(source, { page }, signal()));
  assert.equal(f.calls.length, 0);
});
test('metadata, syncing and genesis mismatch fail before account disclosure', async () => {
  for (const kind of ['coin', 'sync', 'genesis']) {
    const f = fixture({ replace(path, body) { if (path === '/api/v2/' && kind === 'coin') body.blockbook.coin='other'; if (path === '/api/v2/' && kind === 'sync') body.blockbook.inSyncMempool=false; if (path.endsWith('/0') && kind === 'genesis') body.blockHash=H; return body; } });
    await assert.rejects(read(f)); assert.equal(f.calls.some(p => p.includes('/address/')), false);
  }
});
test('wrong identity, malformed pagination and oversized pages are never partial success', async () => {
  for (const change of [(v: any) => {v.address=SYS;}, (v: any) => {v.page=2;}, (v: any) => {v.itemsOnPage=19;}, (v: any) => {v.transactions.push(...Array(20).fill(tx()));}, (v: any) => {v.transactions[0].txid='bad';}, (v: any) => {v.transactions[0].confirmations=-1;}]) {
    const f = fixture({ count: 1, replace(path, body) { if (path.includes('/address/')) change(body); return body; } }); await assert.rejects(read(f));
  }
});
test('page six is a normal indexed request and unknown total is honest', async () => {
  const f = fixture({ count: 140, replace(path, body) { if (path.includes('/address/')) body.totalPages=-1; return body; } });
  const page = await read(f, 6); assert.equal(page.page,6); assert.equal(page.rows.length,20); assert.equal(page.hasMore,true); assert.ok(f.calls.at(-1)?.includes('page=6'));
});
test('body ceilings, invalid JSON and HTTP failure remain unavailable', async () => {
  for (const response of [new Response('x'.repeat(1024*1024+1), {headers:{'content-type':'application/json'}}), new Response('{bad'), new Response('not found', {status:404})]) {
    const f=fixture({replace(path){if(path.includes('/address/'))return response;}}); await assert.rejects(read(f)); assert.ok(f.signals.every(s=>s.aborted));
  }
});
test('request/source scalars detach before awaiting metadata', async () => {
  const entered=gate(), pause=gate(), f=fixture({count:1, async hold(path){if(path==='/api/v2/'){entered.resolve();await pause.promise;}}});
  const mutable={...source}, request={page:1};const pending=createUtxoActivityReader(f).readPage(mutable,request,signal()); await entered.promise;
  mutable.identifier=SYS;request.page=6;pause.resolve(); const page=await pending;assert.equal(page.page,1);assert.ok(f.calls[2]?.includes(BTC));
});
test('cancellation settles ignored transport and prevents all fallback/account calls', async () => {
  const entered=gate(), pause=gate(), abort=new AbortController(), f=fixture({async hold(path){if(path==='/api/v2/'){entered.resolve();await pause.promise;}}});
  const pending=createUtxoActivityReader(f).readPage(source,{page:1},abort.signal);await entered.promise;abort.abort();await assert.rejects(pending);pause.resolve();await tick();assert.equal(f.calls.length,1);
});
test('timeout and redirect rejection do not disclose the identifier', async () => {
  let finish!: (r:Response)=>void;const reader=createUtxoActivityReader({timeoutMs:5,fetch:()=>new Promise(r=>{finish=r;})});await assert.rejects(reader.readPage(source,{page:1},signal()));finish(json(status()));await tick();
  for(const changed of [{redirected:true},{url:'https://different.invalid/api/v2/'}]) {let calls=0;const reader=createUtxoActivityReader({async fetch(){calls++;return Object.assign({ok:true,headers:new Headers(),body:null,text:async()=>JSON.stringify(status()),redirected:false,url:''},changed) as Response;}});await assert.rejects(reader.readPage(source,{page:1},signal()));assert.equal(calls,1);}
});
for(const address of ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa','3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy']) test('Base58 request identity is preserved exactly',async()=>{
  const f=fixture({count:1});const result=await read(f,1,{context:{...owner,address},identifier:address,isAccount:false});assert.equal(result.context.address,address);assert.ok(f.calls[2]?.includes(address));
});
test('screen auto-loads only when current/foreground and coalesces duplicate loads', async()=>{
  const f=fixture(), a=authority(f);a.unlock();let foreground=false;const c=new UtxoWatchActivity(a,()=>foreground);c.activate();await c.load();assert.equal(f.calls.length,0);
  foreground=true;c.setFocused(true);await c.load();await settle(c);assert.equal(c.getSnapshot().rows.length,20);assert.equal(f.calls.filter(p=>p.includes('/address/')).length,1);c.dispose();
});
test('older/newer windows stay at most100 rows while loading beyond page five',async()=>{
  const f=fixture({count:160}),a=authority(f);a.unlock();const c=new UtxoWatchActivity(a,()=>true);c.activate();await settle(c);
  for(let n=2;n<=6;n++)await c.loadMore();assert.equal(c.getSnapshot().page,6);assert.equal(c.getSnapshot().firstPage,2);assert.equal(c.getSnapshot().rows.length,100);assert.equal(c.getSnapshot().hasNewer,true);
  await c.loadNewer();assert.equal(c.getSnapshot().firstPage,1);assert.equal(c.getSnapshot().page,5);assert.equal(c.getSnapshot().rows.length,100);c.dispose();
});
test('fresh reorg and pending observations replace prior same-txid rows',async()=>{
  let pending=false;const f=fixture({count:1,replace(path,body){if(pending&&path.includes('/address/'))Object.assign(body.transactions[0],{blockHeight:-1,blockHash:undefined,confirmations:0});return body;}}),a=authority(f);a.unlock();const c=new UtxoWatchActivity(a,()=>true);c.activate();await settle(c);pending=true;await c.refresh();assert.equal(c.getSnapshot().rows[0]?.block,null);c.dispose();
});
test('failed page keeps prior rows stale with no automatic retry',async()=>{
  let failing=false;const f=fixture({replace(path){if(failing&&path.includes('/address/'))return new Response('',{status:404});}}),a=authority(f);a.unlock();const c=new UtxoWatchActivity(a,()=>true);c.activate();await settle(c);failing=true;await c.loadMore();assert.equal(c.getSnapshot().status,'stale');assert.equal(c.getSnapshot().rows.length,20);const count=f.calls.length;await c.loadMore();await tick();assert.equal(f.calls.length,count);c.dispose();
});
test('lock and departing screen suppress ignored late reads and hidden reloads',async()=>{
  for(const action of ['lock','screen','focus']) {const entered=gate(),pause=gate(),f=fixture({async hold(path){if(path.includes('/address/')){entered.resolve();await pause.promise;}}}),a=authority(f);a.unlock();const c=new UtxoWatchActivity(a,()=>true);c.activate();await entered.promise;
    if(action==='lock')a.lock();else if(action==='screen')c.dispose();else c.setFocused(false);pause.resolve();await tick();await tick();assert.equal(c.getSnapshot().rows.length,0);assert.equal(f.calls.filter(p=>p.includes('/address/')).length,1);c.dispose();}
});
test('cancelled account response cannot dispatch the txsummary fallback',async()=>{
  const entered=gate(),pause=gate(),abort=new AbortController(),f=fixture({async hold(path){if(path.includes('/address/')){entered.resolve();await pause.promise;}},replace(path,body){if(path.includes('/address/'))delete body.transactions;return body;}});
  const pending=createUtxoActivityReader(f).readPage(source,{page:1},abort.signal);await entered.promise;abort.abort();await assert.rejects(pending);pause.resolve();await tick();assert.equal(f.calls.filter(p=>p.includes('/address/')).length,1);
});
test('concurrent reader operations keep their own source and abort lifetime',async()=>{
  const pause=gate(),entered=gate(),other='1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
  const f=fixture({async hold(path){if(path.includes(BTC)){entered.resolve();await pause.promise;}}}),reader=createUtxoActivityReader(f);
  const first=reader.readPage(source,{page:1},signal());await entered.promise;
  const second=await reader.readPage({context:{...owner,address:other},identifier:other,isAccount:false},{page:2},signal());assert.equal(second.context.address,other);pause.resolve();assert.equal((await first).context.address,BTC);
});
test('extension txslight fallback can follow an unavailable account read within the same bounded session',async()=>{
  const f=fixture({count:1,replace(path){if(path.includes('details=txsummary'))return new Response('',{status:503});}});
  const page=await read(f);assert.equal(page.rows.length,1);assert.equal(f.calls.filter(p=>p.includes('details=txsummary')).length,1);assert.equal(f.calls.filter(p=>p.includes('details=txslight')).length,1);
});
test('oversized native integer observations stay unavailable instead of crashing formatting',async()=>{
  const f=fixture({count:1,replace(path,body){if(path.includes('/address/')){body.transactions[0].addressValueIn='9'.repeat(78);body.transactions[0].addressValueOut='9'.repeat(79);}return body;}});
  await assert.rejects(read(f), { message: 'Account activity is unavailable' });
});
test('cross-page duplicates use the fresh observation and do not duplicate the list',async()=>{
  const f=fixture({count:40,replace(path,body){if(path.includes('page=2'))body.transactions[0]={...body.transactions[0],txid:ID(1),blockHeight:-1,blockHash:undefined,confirmations:0};return body;}}),a=authority(f);a.unlock();const c=new UtxoWatchActivity(a,()=>true);c.activate();await settle(c);await c.loadMore();
  const rows=c.getSnapshot().rows;assert.equal(rows.length,39);assert.equal(rows.filter(r=>r.txid===ID(1)).length,1);assert.equal(rows.find(r=>r.txid===ID(1))?.block,null);c.dispose();
});
test('fresh moved block placement replaces an earlier block even with fewer confirmations',async()=>{
  let moved=false;const f=fixture({count:1,replace(path,body){if(moved&&path.includes('/address/'))Object.assign(body.transactions[0],{blockHeight:191,blockHash:H,confirmations:10});return body;}}),a=authority(f);a.unlock();const c=new UtxoWatchActivity(a,()=>true);c.activate();await settle(c);moved=true;await c.refresh();assert.equal(c.getSnapshot().rows[0]?.block?.height,191);assert.equal(c.getSnapshot().rows[0]?.block?.hash,H);assert.equal(c.getSnapshot().rows[0]?.observedConfirmations,10);c.dispose();
});
test('zero summary counts with a nonempty accepted page do not erase retained rows',async()=>{
  let refresh=false;const f=fixture({replace(path,body){if(refresh&&path.includes('/address/')){body.txs=0;body.unconfirmedTxs=0;body.transactions=[body.transactions[0]];}return body;}}),a=authority(f);a.unlock();const c=new UtxoWatchActivity(a,()=>true);c.activate();await settle(c);assert.equal(c.getSnapshot().rows.length,20);refresh=true;await c.refresh();assert.equal(c.getSnapshot().rows.length,20);c.dispose();
});
test('an included block with zero confirmations remains an included observation',async()=>{
  const f=fixture({count:1,replace(path,body){if(path.includes('/address/'))body.transactions[0].confirmations=0;return body;}});
  const row=(await read(f)).rows[0]!;assert.equal(row.block?.height,190);assert.equal(row.observedConfirmations,0);
});
async function bigintWorkProbe(f: ReturnType<typeof fixture>) {
  const original = globalThis.BigInt;
  let calls = 0, oversized = 0, rejected = false;
  globalThis.BigInt = ((value: string | number | bigint | boolean) => {
    calls++; if (typeof value === 'string' && value.length > 78) oversized++;
    return original(value);
  }) as BigIntConstructor;
  try { await read(f); } catch { rejected = true; }
  finally { globalThis.BigInt = original; }
  return { calls, oversized, rejected };
}
test('oversized native integer text is rejected before shared BigInt normalization', async () => {
  const huge = '1' + '0'.repeat(78);
  const f = fixture({ count: 1, replace(path, body) { if (path.includes('/address/')) {
    delete body.transactions[0].addressValueIn; delete body.transactions[0].addressValueOut;
    Object.assign(body.transactions[0], { fees: '0', vin: [{ value: huge, isOwn: true }], vout: [{ value: huge, isOwn: true }] });
  } return body; } });
  const result = await bigintWorkProbe(f); assert.equal(result.oversized, 0); assert.equal(result.rejected, true);
});
test('more than the requested page rows is rejected before any shared integer normalization', async () => {
  const f = fixture({ count: 1, replace(path, body) { if (path.includes('/address/')) {
    body.transactions = Array.from({ length: 21 }, (_, index) => { const row = tx(ID(index + 1)); delete (row as any).addressValueIn; delete (row as any).addressValueOut; return row; });
  } return body; } });
  const result = await bigintWorkProbe(f); assert.equal(result.calls, 0); assert.equal(result.rejected, true);
});
test('a bounded body with very long native integer strings never reaches BigInt',async()=>{
  const huge='9'.repeat(400000);
  const f=fixture({count:1,replace(path,body){if(path.includes('/address/')){delete body.transactions[0].addressValueIn;delete body.transactions[0].addressValueOut;Object.assign(body.transactions[0],{fees:'0',vin:[{value:huge,isOwn:true}],vout:[{value:huge,isOwn:true}]});}return body;}});
  const result=await bigintWorkProbe(f);assert.equal(result.oversized,0);assert.equal(result.rejected,true);assert.equal(f.calls.filter(p=>p.includes('/address/')).length,1);
});
test('legitimate78-digit values still use shared exact ownership and transfer arithmetic',async()=>{
  const maximum=((1n<<256n)-1n).toString();assert.equal(maximum.length,78);
  const f=fixture({count:1,replace(path,body){if(path.includes('/address/')){delete body.transactions[0].addressValueIn;delete body.transactions[0].addressValueOut;Object.assign(body.transactions[0],{fees:'0',vin:[{value:maximum,isOwn:true}],vout:[{value:maximum,isOwn:true}]});}return body;}});
  const row=(await read(f)).rows[0]!;assert.equal(row.spentUnits,maximum);assert.equal(row.receivedUnits,maximum);assert.equal(row.netUnits,'0');assert.equal(row.nativeTransfer?.amount,maximum);
});
test('small invalid native values retain the existing unavailable-field semantics',async()=>{
  const f=fixture({count:1,replace(path,body){if(path.includes('/address/'))body.transactions[0].addressValueIn='bad';return body;}});
  const row=(await read(f)).rows[0]!;assert.equal(row.spentUnits,null);assert.equal(row.netUnits,null);assert.equal(row.nativeTransfer,null);
});
test('work-budget rejection does not poison the shared backend capability for a later healthy read',async()=>{
  let oversized=true;const f=fixture({count:1,replace(path,body){if(oversized&&path.includes('/address/'))body.transactions[0].fees='1'.repeat(79);return body;}}),reader=createUtxoActivityReader(f);
  await assert.rejects(reader.readPage(source,{page:1},signal()));oversized=false;const before=f.calls.length;const page=await reader.readPage(source,{page:1},signal());
  assert.equal(page.rows.length,1);assert.ok(f.calls.slice(before).at(-1)?.includes('details=txsummary'));assert.equal(f.calls.some(path=>path.includes('txslight')),false);
});

// Mirrors Blockbook worker.go accountAssetTransfersFromSummary: the amount is
// absolute, contract/assetGuid are the same decimal ID, and no asset direction
// is emitted. Native direction must not leak into the token quantity.
function compactAsset(value: unknown, decimals = 0, symbol: unknown = 'BIG') {
  const transfer = { type: 'SPT', standard: 'SPT', contract: '987654321', assetGuid: '987654321', symbol, decimals, value };
  return { ...tx(), vin: [], vout: [], direction: 'sent', tokenType: 'SPTAssetAllocationSend',
    accountAssetTransfers: [transfer], tokenTransfers: [transfer] };
}
async function readAsset(asset: unknown) {
  const f = fixture({ count: 1, network: 'syscoin', replace(path, body) { if (path.includes('/address/')) body.transactions = [asset]; return body; } });
  const input = { ...source, context: { ...owner, networkId: 'syscoin' as const, address: SYS }, identifier: SYS };
  const page = await read(f, 1, input);
  assert.deepEqual(f.calls, ['/api/v2/', '/api/v2/block-index/0', `/api/v2/address/${SYS}?details=txsummary&page=1&pageSize=20`]);
  return page.rows[0]!;
}
test('real compact account SPT fields retain exact quantity, unknown direction and independent native funding', async () => {
  const row = await readAsset(compactAsset('9007199254740993'));
  assert.deepEqual(row.assetAmount, { amount: '9007199254740993', assetGuid: '987654321', decimals: 0, symbol: 'BIG', scope: 'account' });
  assert.ok(Object.isFrozen(row.assetAmount));
  assert.equal(row.hasAssetData, true); assert.equal(row.nativeTransfer, null);
  assert.equal(row.netUnits, '-1000000000'); assert.equal(row.transactionFeeUnits, '100000000');
});
for (const decimals of Array.from({ length: 9 }, (_, i) => i)) test(`shared SPT decimal precision ${decimals} reaches the public account page`, async () => {
  const raw = decimals === 0 ? '123456789' : '1' + '0'.repeat(decimals - 1) + '1';
  const expected = decimals === 0 ? raw : '1.' + '0'.repeat(decimals - 1) + '1';
  const row = await readAsset(compactAsset(raw, decimals));
  assert.equal(row.assetAmount?.amount, expected); assert.equal(row.assetAmount?.decimals, decimals);
});
for (const [input, output, direction] of [['9007199254740992', '9007199254740993', 'received'], ['9007199254740993', '9007199254740992', 'sent']]) test(`owned SPT arrays retain one-atom ${direction} direction from the shared helper`, async () => {
  const asset = compactAsset('1'); delete (asset as any).accountAssetTransfers;
  Object.assign(asset, { vin: [{ isOwn: true, assetInfo: { assetGuid: '987654321', value: input } }],
    vout: [{ isOwn: true, assetInfo: { assetGuid: '987654321', value: output } }] });
  const row = await readAsset(asset);
  assert.equal(row.assetAmount?.amount, '1'); assert.equal(row.assetAmount?.direction, direction); assert.equal(row.assetAmount?.scope, 'account');
});
for (const change of [{ value: Number.MAX_SAFE_INTEGER + 1 }, { value: '9'.repeat(79) }, { value: '1e8' }, { decimals: 9 }, { decimals: -1 }]) test(`invalid SPT quantity stays unavailable without native substitution ${JSON.stringify(change)}`, async () => {
  const asset = compactAsset('1'); Object.assign(asset.accountAssetTransfers[0]!, change);
  const row = await readAsset(asset); assert.equal(row.assetAmount, null); assert.equal(row.hasAssetData, true);
  assert.equal(row.netUnits, '-1000000000'); assert.equal(row.nativeTransfer, null);
});
test('compact bridge page quantity stays explicitly account-scoped', async () => {
  const asset = compactAsset('9007199254740993'); asset.tokenType = 'SPTAssetAllocationBurnToNEVM';
  const row = await readAsset(asset); assert.equal(row.assetAmount?.scope, 'account'); assert.equal(row.assetAmount?.direction, undefined);
});
test('public asset metadata never exposes nested/provider/script fields or unsafe display text', async () => {
  const asset = compactAsset('9007199254740993', 0, 'BIG\u202eSPOOF');
  Object.assign(asset.accountAssetTransfers[0]!, { logo: 'https://untrusted.invalid/icon.svg', memo: 'private-memo', source: 'xpub-private-source' });
  const row = await readAsset(asset);
  assert.equal(row.assetAmount?.symbol, undefined); assert.equal(row.assetAmount?.amount, '9007199254740993');
  const encoded = JSON.stringify(row); assert.ok(!/SPOOF|untrusted|private-memo|xpub-private-source/.test(encoded));
});

test('all 78 exact SPT digits survive independently of the native uint256 parser', async () => {
  const value = '9'.repeat(78), row = await readAsset(compactAsset(value));
  assert.equal(row.assetAmount?.amount, value);
});
test('full uint64 asset identifiers survive while malformed metadata stays neutral', async () => {
  for (const guid of ['18446744073709551615', '18446744073709551616', 'asset-with-script']) {
    const asset = compactAsset('1', 0, 'S'.repeat(65));
    asset.accountAssetTransfers[0]!.assetGuid = guid;
    const row = await readAsset(asset);
    assert.equal(row.assetAmount?.amount, '1'); assert.equal(row.assetAmount?.symbol, undefined);
    assert.equal(row.assetAmount?.assetGuid, guid === '18446744073709551615' ? guid : undefined);
  }
});
test('ambiguous compact bridge assets remain unavailable without inventing a native quantity', async () => {
  const asset = compactAsset('1'); asset.tokenType = 'SPTAssetAllocationBurnToNEVM';
  asset.accountAssetTransfers.push({ ...asset.accountAssetTransfers[0]!, assetGuid: '123456', value: '2' });
  const row = await readAsset(asset); assert.equal(row.assetAmount, null); assert.equal(row.hasAssetData, true);
  assert.equal(row.netUnits, '-1000000000');
});
for (const valueStr of ['9007199254740993.12 BIG', '1.123 BIG', '9'.repeat(300), '1e3 BIG']) test(`preferred SPT value string uses shared exact parser ${valueStr.length}`, async () => {
  const asset = compactAsset('0', 2); delete (asset as any).accountAssetTransfers;
  Object.assign(asset, { vin: [{ isOwn: true, assetInfo: { assetGuid: '987654321', value: '0' } }],
    vout: [{ isOwn: true, assetInfo: { assetGuid: '987654321', value: '999', valueStr } }] });
  const row = await readAsset(asset);
  assert.equal(row.assetAmount?.amount ?? null, valueStr === '9007199254740993.12 BIG' ? '9007199254740993.12' : null);
  assert.equal(row.nativeTransfer, null);
});
test('oversized SPT text never reaches arbitrary-precision conversion', async () => {
  const original = BigNumber.from; const lengths: number[] = [];
  BigNumber.from = ((value: Parameters<typeof original>[0]) => { if (typeof value === 'string') lengths.push(value.length); return original(value); }) as typeof original;
  try {
    const row = await readAsset(compactAsset('9'.repeat(100000)));
    assert.equal(row.assetAmount, null); assert.ok(lengths.every(length => length <= 78));
  } finally { BigNumber.from = original; }
});
