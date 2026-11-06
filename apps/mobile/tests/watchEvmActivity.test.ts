import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityExplorerReader } from '../src/activity/explorerReader.ts';
import { ActivityReceiptReader } from '../src/activity/receiptReader.ts';
import { createWatchEvmActivity } from '../src/activity/watchActivity.ts';
import { WatchOnlyAuthority, createEvmWatchAccount } from '../src/core/watchOnlyAuthority.ts';
import { createPublicAccountStorage, PUBLIC_ACCOUNTS_KEY } from '../src/core/publicAccountStorage.ts';
import { NATIVE_NETWORKS, getNativeNetwork } from '../src/custody/networkContext.ts';
import { deferred, json } from './publicWatchFixtures.ts';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const HASH = '0x' + 'a'.repeat(64), OTHER_HASH = '0x' + 'b'.repeat(64), BLOCK = '0x' + 'c'.repeat(64);
const amount = '9007199254740993';
type Call = { url: string; method: string; params: unknown[]; signal: AbortSignal };
function fixture(accountCount = 2) {
  let raw = JSON.stringify({ version: 1, records: Array.from({ length: accountCount }, (_, index) => index === 0 ? OWNER : index === 1 ? OTHER : '0x' + (index + 1).toString(16).padStart(40, '0')).map((address, index) => ({ kind: 'address', ...createEvmWatchAccount('watch' + index, 'Watch ' + index, address) })) });
  let historyRows: ((feed: string, page: string | null) => readonly Record<string, unknown>[]) | undefined;
  let repositoryReads = 0, afterFetch: ((call: Call) => Promise<void>) | undefined, wrongChain = false, fail = false, empty = false;
  const calls: Call[] = [], writes: string[] = [];
  const repository = createPublicAccountStorage({ async get(key) { if (key !== PUBLIC_ACCOUNTS_KEY) return null; repositoryReads++; return raw; }, async set(_key, value) { writes.push(value); raw = value; } }).records;
  const fetcher = async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const target = new URL(url), method = body?.method ?? target.searchParams.get('action')!;
    const call = { url, method, params: body?.params ?? [], signal: init.signal! }; calls.push(call);
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    await afterFetch?.(call);
    if (fail) throw Error('offline fixture');
    if (!body) {
      const owner = target.searchParams.get('address')!, hash = owner.toLowerCase() === OWNER.toLowerCase() ? HASH : OTHER_HASH;
      assert.ok(method === 'txlist' || method === 'tokentx');
      return json({ status: '1', message: 'OK', result: historyRows ? historyRows(method, target.searchParams.get('page')) : empty ? [] : [{ hash, from: owner, to: owner === OWNER ? OTHER : OWNER, blockNumber: '10', timeStamp: '1700000000', value: amount,
        ...(method === 'tokentx' ? { contractAddress: '0x3333333333333333333333333333333333333333', tokenDecimal: '18', tokenSymbol: 'FIX' } : {}) }] });
    }
    const network = NATIVE_NETWORKS.find(row => row.rpcUrl === url); assert.ok(network);
    const hash = String(call.params[0]), owner = hash === OTHER_HASH ? OTHER : OWNER, to = owner === OWNER ? OTHER : OWNER;
    let result: unknown;
    if (method === 'eth_chainId') result = '0x' + BigInt(wrongChain ? 99 : network.chainId).toString(16);
    else if (method === 'eth_blockNumber') result = '0xa';
    else if (method === 'eth_getTransactionByHash') result = { hash, from: owner, to, value: '0x' + BigInt(amount).toString(16), nonce: '0x0', blockHash: BLOCK, blockNumber: '0xa', transactionIndex: '0x0' };
    else if (method === 'eth_getTransactionReceipt') result = { transactionHash: hash, from: owner, to, status: '0x1', blockHash: BLOCK, blockNumber: '0xa', transactionIndex: '0x0', logs: [], gasUsed: '0x5208', effectiveGasPrice: '0xa' };
    else if (method === 'eth_getBlockByNumber') result = { hash: BLOCK, number: '0xa', timestamp: '0x6553f100' };
    else assert.fail('Unexpected RPC method ' + method);
    return json({ jsonrpc: '2.0', id: body.id, result });
  };
  const readers = { explorer: new ActivityExplorerReader(fetcher), receipts: new ActivityReceiptReader({ fetch: fetcher }) };
  const open = async (idle?: { begin(): void; stop(): void; check(): boolean }) => {
    const authority = await WatchOnlyAuthority.openRecords({ repository, reader: { async readBalance(networkId) { return { chainId: Number(getNativeNetwork(networkId).chainId), units: '0' }; } }, evmActivityReaders: readers, signal: new AbortController().signal, idle });
    authority.unlock(); authority.selectNetwork('syscoin-nevm'); return authority;
  };
  return { open, calls, writes, readers, set historyRows(value: typeof historyRows) { historyRows = value; }, get raw() { return raw; }, set raw(value: string) { raw = value; }, get reads() { return repositoryReads; }, set afterFetch(value: ((call: Call) => Promise<void>) | undefined) { afterFetch = value; }, set wrongChain(value: boolean) { wrongChain = value; }, set fail(value: boolean) { fail = value; }, set empty(value: boolean) { empty = value; } };
}
async function until(check: () => boolean) { for (let n = 0; n < 250; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 0)); } assert.fail('Activity state did not settle'); }
const signal = () => new AbortController().signal;
const guard = () => undefined;

test('real public authority uses the same Activity model/readers for exact direct history and deduplicated feeds', async () => {
  const f = fixture(), authority = await f.open(), activity = createWatchEvmActivity(authority), stop = activity.connect();
  try {
    await until(() => activity.getSnapshot().rows[0]?.indexedStatus === 'confirmed');
    const snapshot = activity.getSnapshot(), row = snapshot.rows[0]!;
    assert.equal(snapshot.accountAddress, OWNER); assert.equal(snapshot.rows.length, 1); assert.equal(row.hash, HASH);
    assert.equal(row.indexed?.value, amount); assert.equal(row.display?.displayValue, '0.009007199254740993'); assert.equal(row.local, undefined);
    assert.deepEqual(f.writes, []); assert.equal('walletFingerprint' in await authority.loadEvmActivity(guard), false);
    assert.ok(f.calls.some(call => call.method === 'txlist')); assert.ok(f.calls.some(call => call.method === 'tokentx'));
    assert.deepEqual(f.calls.map(call => call.method).sort(), ['tokentx', 'txlist']);
    assert.equal(row.observation, undefined);
  } finally { stop(); authority.lock(); }
});
for (const stage of ['load', 'page', 'token-page', 'receipt'] as const) test(`record identity is rechecked around each ${stage} operation`, async () => {
  const f = fixture(), authority = await f.open(), scope = await authority.loadEvmActivity(guard);
  const mutate = () => { const value = JSON.parse(f.raw); value.records[0].name = 'Changed'; f.raw = JSON.stringify(value); };
  if (stage === 'load') { mutate(); await assert.rejects(authority.loadEvmActivity(guard)); assert.equal(f.calls.length, 0); authority.lock(); return; }
  const entered = deferred<void>(), release = deferred<void>();
  const method = stage === 'page' ? 'txlist' : stage === 'token-page' ? 'tokentx' : 'eth_getTransactionReceipt';
  f.afterFetch = async call => { if (call.method === method) { entered.resolve(); await release.promise; } };
  const operation = stage === 'page' || stage === 'token-page' ? authority.readEvmActivityPage(scope, stage === 'page' ? 'txlist' : 'tokentx', 1, signal(), guard) : authority.readEvmActivityTransaction(scope, HASH, signal(), guard);
  await entered.promise; mutate(); release.resolve(); await assert.rejects(operation); assert.deepEqual(f.writes, []); authority.lock();
});
for (const action of ['lock', 'account-aba', 'network-aba', 'external'] as const) test(`${action} cancels a held EVM read without publishing stale data`, async () => {
  const f = fixture(), authority = await f.open(), scope = await authority.loadEvmActivity(guard);
  const entered = deferred<void>(), release = deferred<void>(), abort = new AbortController();
  f.afterFetch = async call => { if (call.method === 'txlist') { entered.resolve(); await release.promise; } };
  const operation = authority.readEvmActivityPage(scope, 'txlist', 1, abort.signal, guard);
  await entered.promise;
  if (action === 'lock') authority.lock();
  else if (action === 'account-aba') { authority.selectAccount('watch1'); authority.selectAccount('watch0'); }
  else if (action === 'network-aba') { authority.selectNetwork('rollux'); authority.selectNetwork('syscoin-nevm'); }
  else abort.abort();
  await assert.rejects(operation); release.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.every(call => call.signal.aborted)); assert.deepEqual(f.writes, []); authority.lock();
});
test('missing explorer is an honest no-discovery state with no invented requests or saved transfers', async () => {
  const f = fixture(), authority = await f.open(); authority.selectNetwork('base');
  const activity = createWatchEvmActivity(authority), stop = activity.connect();
  try { await until(() => activity.getSnapshot().status === 'ready'); assert.equal(activity.getSnapshot().rows.length, 0); assert.equal(f.calls.length, 0); assert.match(activity.getSnapshot().coverage, /Activity discovery is unavailable for this network\./); assert.doesNotMatch(activity.getSnapshot().coverage, /Saved transfers only/); }
  finally { stop(); authority.lock(); }
});
test('explicit detail enrichment rejects a wrong connected chain before transaction or receipt requests', async () => {
  const f = fixture(), authority = await f.open(), scope = await authority.loadEvmActivity(guard); f.wrongChain = true;
  await assert.rejects(authority.readEvmActivityTransaction(scope, HASH, signal(), guard)); assert.deepEqual(f.calls.map(call => call.method), ['eth_chainId']); authority.lock();
});
test('public cache and filters remain source-scoped across reconnect and another account', async () => {
  const f = fixture(), authority = await f.open(), activity = createWatchEvmActivity(authority);
  let stop = activity.connect();
  try {
    await until(() => activity.getSnapshot().rows[0]?.indexedStatus === 'confirmed'); await until(() => !activity.getSnapshot().loadingMore);
    await activity.setView({ filter: 'sent', anchor: HASH, offset: 7 }); stop(); f.fail = true;
    stop = activity.connect(); await until(() => activity.getSnapshot().rows.some(row => row.hash === HASH));
    assert.equal(activity.getSnapshot().view.filter, 'sent'); assert.equal(activity.getSnapshot().view.offset, 7);
    authority.selectAccount('watch1'); await until(() => activity.getSnapshot().accountAddress === OTHER);
    assert.deepEqual(activity.getSnapshot().rows, []); assert.equal(activity.getSnapshot().view.filter, 'all');
  } finally { stop(); authority.lock(); }
});
test('idle expiry refuses public Activity admission before any network call', async () => {
  const f = fixture(); let active = true; const authority = await f.open({ begin() {}, stop() {}, check() { return active; } }); active = false;
  await assert.rejects(authority.loadEvmActivity(guard)); assert.equal(f.calls.length, 0); assert.equal(authority.getSnapshot().status, 'locked');
});

test('reader capabilities and expected scope scalars are captured before awaits', async () => {
  const f = fixture(), authority = await f.open(), scope = await authority.loadEvmActivity(guard);
  f.readers.explorer.page = async () => { throw Error('replacement reader must not run'); };
  assert.equal((await authority.readEvmActivityPage(scope, 'txlist', 1, signal(), guard)).length, 1);
  const before = f.calls.length, mutable = { ...scope, key: '0x' + '0'.repeat(64) };
  const request = authority.readEvmActivityPage(mutable, 'txlist', 1, signal(), guard); mutable.key = scope.key;
  await assert.rejects(request); assert.equal(f.calls.length, before); authority.lock();
});
test('unknown feed and asynchronous guard are rejected before history I/O', async () => {
  const f = fixture(), authority = await f.open(), scope = await authority.loadEvmActivity(guard), before = f.calls.length;
  await assert.rejects(authority.readEvmActivityPage(scope, 'sendRawTransaction' as 'txlist', 1, signal(), guard));
  const reads = f.reads; await assert.rejects(authority.loadEvmActivity((async () => undefined) as () => void));
  assert.equal(f.reads, reads); assert.equal(f.calls.length, before); authority.lock();
});

test('empty cache groups obey the same bounded session cache as populated groups', async () => {
  const f = fixture(13), authority = await f.open(); f.empty = true;
  const activity = createWatchEvmActivity(authority);
  try {
    for (let index = 0; index < 13; index++) {
      authority.selectAccount('watch' + index);
      for (const network of ['syscoin-nevm', 'rollux']) {
        authority.selectNetwork(network);
        await activity.refresh();
        assert.equal(activity.getSnapshot().status, 'ready'); assert.deepEqual(activity.getSnapshot().rows, []);
      }
    }
    assert.equal(activity.getSnapshot().truncated, true);
    assert.deepEqual(f.writes, []);
  } finally { authority.lock(); }
});


for (const mixed of [false, true]) test(`public authority actual indexed ${mixed ? 'mixed-case feed overlap' : 'token placeholders with repeated sender nonce'} keeps two transactions and a healthy session cache`, async () => {
  const f = fixture(), first = HASH, second = OTHER_HASH;
  const wireHash = (value: string) => mixed ? `0x${value.slice(2).toUpperCase()}` : value;
  const raw = (id: string, token: boolean) => ({ hash: wireHash(id), from: OTHER, to: OWNER, nonce: mixed && id === second ? '8' : '7',
    blockNumber: id === first ? '10' : '9', timeStamp: '1700000000', confirmations: '1', value: '1', input: '0x', isError: '0',
    ...(token ? { contractAddress: '0x3333333333333333333333333333333333333333', tokenDecimal: '0', tokenSymbol: 'TOK' } : {}) });
  f.historyRows = (feed, page) => feed === 'txlist' ? mixed ? [raw(first, false)] : []
    : mixed && page === '1' ? Array.from({ length: 20 }, (_, index) => raw(index % 2 ? second : first, true)) : [raw(first, true), raw(second, true)];
  const authority = await f.open(), activity = createWatchEvmActivity(authority);
  let stop = activity.connect();
  try {
    await until(() => activity.getSnapshot().status === 'ready' && !activity.getSnapshot().loadingMore);
    const snapshot = activity.getSnapshot();
    assert.equal(snapshot.error, null);
    assert.deepEqual(snapshot.rows.map(row => row.hash).sort(), [first, second]);
    assert(snapshot.rows.every(row => row.indexed && row.display));
    assert.deepEqual(f.calls.map(call => call.method).sort(), mixed ? ['tokentx', 'tokentx', 'txlist'] : ['tokentx', 'txlist']);
    assert.deepEqual(f.writes, [], 'public history must not mutate saved account records');
    stop(); f.fail = true; stop = activity.connect();
    await until(() => activity.getSnapshot().status === 'ready' && !activity.getSnapshot().loadingMore);
    assert.deepEqual(activity.getSnapshot().rows.map(row => row.hash).sort(), [first, second]);
    assert.match(activity.getSnapshot().error ?? '', /unavailable|could not be fully loaded/);
    assert(f.calls.every(call => call.method === 'txlist' || call.method === 'tokentx'));
    assert.deepEqual(f.writes, []);
  } finally { stop(); authority.lock(); }
});
