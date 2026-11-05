import assert from 'node:assert/strict';
import test from 'node:test';
import { createUtxoActivityReader } from '../src/core/utxoActivity.ts';
import { WatchOnlyAuthority, createEvmWatchAccount } from '../src/core/watchOnlyAuthority.ts';
import { createPublicAccountStorage } from '../src/core/publicAccountStorage.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { XPUB, keyRecord, deferred, json, metadata } from './publicWatchFixtures.ts';
import type { StoredWatchAccount } from '../src/core/watchAccountCodec.ts';
function fixture(records: readonly StoredWatchAccount[] = [keyRecord()]) {
  let raw = JSON.stringify({ version: 1, records }), fail = false, hold: Promise<void> | undefined;
  const calls: string[] = [], signals: AbortSignal[] = [], writes: string[] = [], entered = deferred<void>();
  const repository = createPublicAccountStorage({ async get() { if (fail) throw Error('storage'); return raw; }, async set(_key, value) { writes.push(value); raw=value; } }).records;
  const historyReader = createUtxoActivityReader({ async fetch(url, init) {
    calls.push(url); signals.push(init.signal!); const endpoint=getUtxoNetwork('bitcoin').endpoint, path=url.slice(endpoint.length);
    if(path==='/api/v2/')return json(metadata('bitcoin'));
    if(path==='/api/v2/block-index/0')return json({blockHash:getUtxoNetwork('bitcoin').genesisHash});
    assert.match(path,/^\/api\/v2\/(xpub|address)\//);entered.resolve();await hold;
    return json({address:decodeURIComponent(new URL(url).pathname.split('/').at(-1)!),page:Number(new URL(url).searchParams.get('page')),totalPages:1,txs:1,unconfirmedTxs:0,
      transactions:[{txid:'ab'.repeat(32),blockHeight:100,confirmations:1,addressValueIn:'0',addressValueOut:'9007199254740993',fees:'1'}]});
  } });
  const options={repository,historyReader,reader:{async readBalance(){throw Error('unexpected EVM read');}},signal:new AbortController().signal};
  return {options,calls,signals,writes,entered,get raw(){return raw;},set raw(v:string){raw=v;},set fail(v:boolean){fail=v;},set hold(v:Promise<void>|undefined){hold=v;}};
}
for(const identifier of [XPUB,`sh(wpkh(${XPUB}/0/*))`])test('authority reads canonical account/descriptor privately through actual SJS',async()=>{
  const f=fixture([keyRecord('key','bitcoin',identifier)]),owner=await WatchOnlyAuthority.openRecords(f.options);owner.unlock();
  assert.equal(f.calls.length,0);const page=await owner.readUtxoActivityPage({page:1},new AbortController().signal);
  const canonical=parseUtxoPublicIdentifier(identifier,'bitcoin').identifier;
  assert.equal(f.calls[2],`${getUtxoNetwork('bitcoin').endpoint}/api/v2/xpub/${encodeURIComponent(canonical)}?details=txsummary&page=1&pageSize=20`);
  assert.equal(page.rows[0]?.netUnits,'9007199254740993');assert.ok(!JSON.stringify(page).includes(canonical));assert.ok(!JSON.stringify(owner.getSnapshot()).includes(canonical));assert.equal(f.writes.length,0);
});
test('changed records before read reject without HTTP or writes',async()=>{
  const f=fixture(),owner=await WatchOnlyAuthority.openRecords(f.options);owner.unlock();f.raw=JSON.stringify({version:1,records:[keyRecord('key','bitcoin',`pkh(${XPUB}/0/*)`)]});
  await assert.rejects(owner.readUtxoActivityPage({page:1},new AbortController().signal));assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});
test('changed records during backend read reject the returned page',async()=>{
  const f=fixture(),pause=deferred<void>();f.hold=pause.promise;const owner=await WatchOnlyAuthority.openRecords(f.options);owner.unlock();
  const pending=owner.readUtxoActivityPage({page:1},new AbortController().signal);await f.entered.promise;f.raw=JSON.stringify({version:1,records:[keyRecord('key','bitcoin',`pkh(${XPUB}/0/*)`)]});pause.resolve();await assert.rejects(pending);assert.equal(f.writes.length,0);
});
for(const action of ['external','lock','aba'])test(`authority ${action} revokes an ignored late account response`,async()=>{
  const other=createEvmWatchAccount('other','Other','0x1111111111111111111111111111111111111111');
  const f=fixture([keyRecord(),{kind:'address',...other}]),pause=deferred<void>();f.hold=pause.promise;
  const owner=await WatchOnlyAuthority.openRecords(f.options);owner.unlock();const abort=new AbortController();const pending=owner.readUtxoActivityPage({page:1},abort.signal);await f.entered.promise;
  if(action==='external')abort.abort();else if(action==='lock')owner.lock();else{owner.selectAccount('other');owner.selectAccount('key');}
  await assert.rejects(pending);pause.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,3);assert.ok(f.signals.every(s=>s.aborted));assert.equal(f.writes.length,0);
});
test('history request page is captured before storage or transport awaits',async()=>{
  const f=fixture(),pause=deferred<void>();f.hold=pause.promise;const owner=await WatchOnlyAuthority.openRecords(f.options);owner.unlock();const input={page:1};
  const pending=owner.readUtxoActivityPage(input,new AbortController().signal);await f.entered.promise;input.page=6;pause.resolve();assert.equal((await pending).page,1);assert.ok(f.calls[2]!.includes('page=1'));
});
test('corrupt storage and locked accounts never begin history requests',async()=>{
  const f=fixture(),owner=await WatchOnlyAuthority.openRecords(f.options);await assert.rejects(owner.readUtxoActivityPage({page:1},new AbortController().signal));owner.unlock();f.fail=true;
  await assert.rejects(owner.readUtxoActivityPage({page:1},new AbortController().signal));assert.equal(f.calls.length,0);
});
test('history abort is independent from a concurrent public balance read',async()=>{
  const f=fixture(),pause=deferred<void>();f.hold=pause.promise;let balanceSignal:AbortSignal|undefined;const balance=deferred<void>();
  const owner=await WatchOnlyAuthority.openRecords({...f.options,reader:{...f.options.reader,async readUtxoAccount(_network, _identifier,signal){balanceSignal=signal;await balance.promise;return {networkId:'bitcoin',kind:'utxo' as const,chainId:0 as const,genesisHash:getUtxoNetwork('bitcoin').genesisHash,confirmedUnits:'1',pendingDeltaUnits:'0',unconfirmedTransactions:0,observedHeight:123};}}});owner.unlock();
  const refresh=owner.refresh(),abort=new AbortController(),history=owner.readUtxoActivityPage({page:1},abort.signal);await f.entered.promise;abort.abort();await assert.rejects(history);assert.equal(balanceSignal?.aborted,false);pause.resolve();balance.resolve();await refresh;assert.equal(owner.getSnapshot().balance.status,'available');
});
test('idle expiry during initial admission cancels without an unhandled rejection or any I/O',async()=>{
  const f=fixture();let checks=0;
  const owner=await WatchOnlyAuthority.openRecords({...f.options,idle:{begin(){},stop(){},check(){return ++checks<2;}}});owner.unlock();
  await assert.rejects(owner.readUtxoActivityPage({page:1},new AbortController().signal));await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,0);assert.equal(owner.getSnapshot().status,'locked');
});
test('cancelling a balance refresh does not cancel an independent active history read',async()=>{
  const f=fixture(),pause=deferred<void>();f.hold=pause.promise;const balance=deferred<void>();let balanceSignal:AbortSignal|undefined;
  const owner=await WatchOnlyAuthority.openRecords({...f.options,reader:{...f.options.reader,async readUtxoAccount(_network,_identifier,signal){balanceSignal=signal;await balance.promise;return {networkId:'bitcoin',kind:'utxo' as const,chainId:0 as const,genesisHash:getUtxoNetwork('bitcoin').genesisHash,confirmedUnits:'1',pendingDeltaUnits:'0',unconfirmedTransactions:0,observedHeight:123};}}});owner.unlock();
  const refreshing=owner.refresh(),history=owner.readUtxoActivityPage({page:1},new AbortController().signal);void history.catch(()=>undefined);await f.entered.promise;
  try {owner.cancelRefresh();assert.equal(balanceSignal?.aborted,true);assert.ok(f.signals.every(signal=>!signal.aborted));pause.resolve();assert.equal((await history).rows.length,1);}
  finally {pause.resolve();balance.resolve();await refreshing;await history.catch(()=>undefined);}
});
