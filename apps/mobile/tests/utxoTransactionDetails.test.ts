import assert from 'node:assert/strict';
import test from 'node:test';
import { utils as actualSjs } from 'syscoinjs-lib';
import { createUtxoActivityReader, UtxoActivity, type UtxoActivityPage } from '../src/core/utxoActivity.ts';
import { WatchOnlyAuthority, createEvmWatchAccount, type BalanceReader } from '../src/core/watchOnlyAuthority.ts';
import { createPublicAccountStorage, PUBLIC_ACCOUNTS_KEY } from '../src/core/publicAccountStorage.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { createUtxoTransactionDetailsCache } from '../../../source/shared/utxoTransactionDetailCache.ts';
import { XPUB, keyRecord, deferred, json, metadata } from './publicWatchFixtures.ts';
const H = 'ab'.repeat(32), BLOCK = 'cd'.repeat(32), OTHER = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const ID = (n: number) => n.toString(16).padStart(64, '0');
const signal = () => new AbortController().signal;
const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw Error('Global history transport is forbidden in this fixture'); }; });
test.after(() => { globalThis.fetch = originalFetch; });
function fixture(count = 1, networkId: 'bitcoin' | 'syscoin' = 'bitcoin') {
  const record = keyRecord('key', networkId), address = parseUtxoPublicIdentifier(XPUB, networkId).address;
  let raw = JSON.stringify({ version: 1, records: [record, { kind: 'address', ...createEvmWatchAccount('second', 'Second', '0x1111111111111111111111111111111111111111') }] });
  let full: Record<string, any> | null = null, failure = false, held: Promise<void> | undefined, accountHeld: Promise<void> | undefined, summaryRows: readonly Record<string, unknown>[] | undefined, summaryHeight = 100, rowShift = 0, memo = '';
  const entered = deferred<void>(), calls: string[] = [], signals: AbortSignal[] = [], writes: string[] = [];
  const summary = (txid = H) => ({ txid, ...(memo ? { memo } : {}), blockHeight: summaryHeight, blockHash: BLOCK, blockTime: 1700000000, confirmations: 2,
    fees: '100000000', addressValueIn: '1100000000', addressValueOut: '100000000',
    vin: [{ value: '1100000000', isOwn: true, addresses: [address] }],
    vout: [{ value: '100000000', isOwn: true, addresses: [address] }, { value: '900000000', isOwn: false, addresses: [OTHER] }] });
  const defaultFull = () => ({ ...summary(), blockHeight: 101, confirmations: 0, hex: 'PRIVATE-RAW-HEX',
    vin: [{ value: '1100000000', addresses: [address] }],
    vout: [{ value: '100000000', addresses: [address] }, { value: '900000000', addresses: [OTHER] }] });
  const reader = createUtxoActivityReader({ async fetch(url, init) {
    const endpoint = getUtxoNetwork(networkId).endpoint;
    assert.ok(url.startsWith(endpoint)); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const path = url.slice(endpoint.length); calls.push(path); signals.push(init.signal!);
    if (path === '/api/v2/') return json(metadata(networkId));
    if (path === '/api/v2/block-index/0') return json({ blockHash: getUtxoNetwork(networkId).genesisHash });
    if (path.startsWith('/api/v2/tx/')) { entered.resolve(); await held; if (failure) throw Error('Synthetic unavailable detail'); return json(full ?? { ...defaultFull(), txid: path.split('/').at(-1)! }); }
    assert.match(path, /^\/api\/v2\/(xpub|address)\//);
    const target = new URL(url), page = Number(target.searchParams.get('page')); await accountHeld;
    return json({ address: decodeURIComponent(target.pathname.split('/').at(-1)!), txs: count, unconfirmedTxs: 0, page, totalPages: Math.ceil(count / 20), itemsOnPage: 20,
      transactions: summaryRows ?? Array.from({ length: Math.min(20, Math.max(0, count - (page - 1) * 20)) }, (_, index) => summary(count === 1 && rowShift === 0 ? H : ID((page - 1) * 20 + index + 1 + rowShift))) });
  } });
  const repository = createPublicAccountStorage({ async get(key) { return key === PUBLIC_ACCOUNTS_KEY ? raw : null; }, async set(_key, value) { writes.push(value); raw = value; } }).records;
  const open = async (extraReader: Partial<BalanceReader> = {}, historyReader = reader) => { const owner = await WatchOnlyAuthority.openRecords({ repository, reader: { async readBalance() { throw Error('No EVM read'); }, ...extraReader }, historyReader, signal: signal() }); owner.unlock(); return owner; };
  return { set accountHold(value: Promise<void> | undefined) { accountHeld = value; }, set summaryRows(value: readonly Record<string, unknown>[] | undefined) { summaryRows = value; }, set returnedCount(value: number) { count = value; }, set rowShift(value: number) { rowShift = value; }, set memo(value: string) { memo = value; }, open, reader, summary, address, identifier: parseUtxoPublicIdentifier(XPUB, networkId).identifier, calls, signals, writes, entered, get raw() { return raw; }, set raw(value: string) { raw = value; }, set hold(value: Promise<void> | undefined) { held = value; },
    set full(value: Record<string, any> | null) { full = value; }, set failure(value: boolean) { failure = value; }, set summaryHeight(value: number) { summaryHeight = value; } };
}
async function settled(model: UtxoActivity) { for (let n = 0; n < 100 && ['loading', 'idle'].includes(model.getSnapshot().status); n++) await new Promise(resolve => setImmediate(resolve)); }

test('selected detail uses actual SJS raw transport/shared ownership and keeps DTO public/exact', async () => {
  const f = fixture(), owner = await f.open();
  try {
    const page = await owner.readUtxoActivityPage({ page: 1 }, signal());
    assert.equal(f.calls.length, 3); assert.equal(page.rows[0]?.transactionFeeUnits, '100000000');
    const result = await owner.readUtxoActivityDetail({ txid: H.toUpperCase() }, signal());
    assert.deepEqual(f.calls.slice(3), ['/api/v2/', '/api/v2/block-index/0', '/api/v2/tx/' + H]);
    assert.equal(result.row.nativeTransfer?.amount, '900000000'); assert.equal(result.row.netUnits, '-1000000000');
    assert.equal(result.row.transactionFeeUnits, '100000000'); assert.equal(result.row.block?.height, 101);
    assert.deepEqual(result.from, [f.address]); assert.deepEqual(result.to, [f.address, OTHER]);
    assert.deepEqual(Object.keys(result).sort(), ['from', 'row', 'to', 'txid']);
    assert.ok(!JSON.stringify(result).includes(XPUB) && !JSON.stringify(result).includes('PRIVATE-RAW-HEX'));
    assert.deepEqual(f.writes, []);
  } finally { owner.lock(); }
});

test('warm detail rechecks records and uses the newer account status with no raw refetch', async () => {
  const f = fixture(), owner = await f.open();
  try {
    await owner.readUtxoActivityPage({ page: 1 }, signal()); await owner.readUtxoActivityDetail({ txid: H }, signal());
    f.summaryHeight = 99; const fresh = await owner.readUtxoActivityPage({ page: 1 }, signal()); owner.retainUtxoActivityRows(fresh.rows);
    const before = f.calls.length, result = await owner.readUtxoActivityDetail({ txid: H }, signal());
    assert.equal(result.row.block?.height, 99); assert.equal(f.calls.length, before);
    f.raw = f.raw.replace('"name":"', '"name":"Changed ');
    await assert.rejects(owner.readUtxoActivityDetail({ txid: H }, signal())); assert.equal(f.calls.length, before);
  } finally { owner.lock(); }
});

for (const initiallyPending of [false, true]) test(`reopening uses the full observation over the unchanged ${initiallyPending ? 'pending' : 'confirmed'} summary`, async () => {
  const f = fixture(), owner = await f.open();
  const pending = { blockHeight: -1, blockHash: null, blockTime: 0, confirmations: 0 };
  try {
    f.summaryRows = [{ ...f.summary(), ...(initiallyPending ? pending : {}) }];
    f.full = { ...f.summary(), ...(!initiallyPending ? pending : {}) };
    await owner.readUtxoActivityPage({ page: 1 }, signal());
    const first = await owner.readUtxoActivityDetail({ txid: H }, signal());
    assert.equal(first.row.block?.height ?? null, initiallyPending ? 100 : null);
    const count = f.calls.length;
    const reopened = await owner.readUtxoActivityDetail({ txid: H }, signal());
    assert.deepEqual(reopened, first);
    assert.equal(f.calls.length, count);
  } finally { owner.lock(); }
});

for (const stage of ['external', 'lock', 'aba', 'records', 'release'] as const) test(`${stage} revokes a held selected detail and never admits its late body`, async () => {
  const f = fixture(), owner = await f.open(); await owner.readUtxoActivityPage({ page: 1 }, signal());
  const wait = deferred<void>(), abort = new AbortController(); f.hold = wait.promise;
  const pending = owner.readUtxoActivityDetail({ txid: H }, abort.signal); await f.entered.promise;
  if (stage === 'external') abort.abort();
  if (stage === 'lock') owner.lock();
  if (stage === 'aba') { owner.selectAccount('second'); owner.selectAccount('key'); }
  if (stage === 'records') f.raw = f.raw.replace('"name":"', '"name":"Changed ');
  if (stage === 'release') owner.releaseUtxoActivity();
  wait.resolve(); await assert.rejects(pending); assert.deepEqual(f.writes, []);
  assert.ok(f.signals.every(value => value.aborted));
  owner.lock();
});

test('reader row capabilities cannot be forged, reused by another source or forwarded after context change', async () => {
  const f = fixture(), parsed = parseUtxoPublicIdentifier(XPUB, 'bitcoin');
  const input = { context: { accountId: 'key', networkId: 'bitcoin' as const, address: parsed.address, generation: 1 }, identifier: parsed.identifier, isAccount: true };
  const page = await f.reader.readPage(input, { page: 1 }, signal()), row = page.rows[0]!, cache = createUtxoTransactionDetailsCache();
  try {
    const before = f.calls.length;
    for (const [source, candidate] of [[input, { ...row }], [{ ...input, context: { ...input.context, generation: 2 } }, row], [{ ...input, identifier: 'different' }, row]] as const) {
      await assert.rejects(f.reader.readDetail(source, { row: candidate, txid: H }, signal(), cache, () => undefined));
    }
    assert.equal(f.calls.length, before);
  } finally { cache.dispose(); }
});

for (const kind of ['wrong-hash', 'oversize', 'participant-work', 'identifier-reflection', 'unsafe-amount'] as const) test(`${kind} cannot turn a detail failure into invented native/account facts`, async () => {
  const f = fixture(), owner = await f.open();
  try {
    const page = await owner.readUtxoActivityPage({ page: 1 }, signal());
    const body = { ...f.summary(), hex: 'raw' } as Record<string, any>;
    if (kind === 'wrong-hash') body.txid = 'ff'.repeat(32);
    if (kind === 'oversize') body.padding = 'x'.repeat(1024 * 1024);
    if (kind === 'participant-work') body.vin = [{ value: '1', addresses: ['A'.repeat(40000)] }];
    if (kind === 'identifier-reflection') body.vin = [{ value: '1', addresses: [f.identifier] }];
    if (kind === 'unsafe-amount') body.fees = '9'.repeat(79);
    f.full = body;
    await assert.rejects(owner.readUtxoActivityDetail({ txid: H }, signal()));
    assert.equal(page.rows[0]?.netUnits, '-1000000000'); assert.deepEqual(f.writes, []);
  } finally { owner.lock(); }
});

test('screen selection is explicit, failed hydration preserves compact row, retry/clear/back remain cancellable', async () => {
  const f = fixture(), owner = await f.open(), model = new UtxoActivity(owner, () => true); model.activate(); await settled(model);
  try {
    assert.equal(model.getSnapshot().detail, null); assert.equal(f.calls.filter(path => path.startsWith('/api/v2/tx/')).length, 0);
    await model.selectDetail('ff'.repeat(32)); assert.equal(model.getSnapshot().detail, null);
    f.failure = true; await model.selectDetail(H);
    assert.equal(model.getSnapshot().detail?.status, 'unavailable'); assert.equal(model.getSnapshot().detail?.row.netUnits, '-1000000000');
    f.failure = false; await model.retryDetail(); assert.equal(model.getSnapshot().detail?.status, 'ready');
    const before = f.calls.length; model.clearDetail(); model.clearDetail(); assert.equal(model.getSnapshot().detail, null); assert.equal(f.calls.length, before);
  } finally { model.dispose(); owner.lock(); }
});

test('accepted five-page authority window is bounded, old rows cannot hydrate and list paging never fetches raw bodies', async () => {
  const f = fixture(140), owner = await f.open(), model = new UtxoActivity(owner, () => true); model.activate(); await settled(model);
  try {
    for (let n = 2; n <= 6; n++) await model.loadMore();
    assert.equal(model.getSnapshot().rows.length, 100); assert.equal(f.calls.some(path => path.startsWith('/api/v2/tx/')), false);
    await assert.rejects(owner.readUtxoActivityDetail({ txid: ID(1) }, signal()));
    await owner.readUtxoActivityDetail({ txid: ID(21) }, signal());
    await model.loadNewer(); assert.equal(model.getSnapshot().firstPage, 1);
    await assert.rejects(owner.readUtxoActivityDetail({ txid: ID(101) }, signal()));
    await owner.readUtxoActivityDetail({ txid: ID(1) }, signal());
  } finally { model.dispose(); owner.lock(); }
});


test('full Syscoin bridge amount uses shared operation scope/precision while native funding remains separate', async () => {
  const f = fixture(1, 'syscoin'), owner = await f.open();
  try {
    await owner.readUtxoActivityPage({ page: 1 }, signal());
    f.full = { ...f.summary(), tokenType: 'SPTAssetAllocationBurnToNEVM', tokenTransfers: [{ token: '123456', decimals: 8, symbol: 'EXACT' }],
      vout: [{ value: '0', addresses: ['OP_RETURN'], isAddress: false, hex: '6a', assetInfo: { assetGuid: '123456', value: '9007199254740993' } }] };
    const detail = await owner.readUtxoActivityDetail({ txid: H }, signal());
    assert.equal(detail.row.assetAmount?.amount, '90071992.54740993'); assert.equal(detail.row.assetAmount?.scope, 'transaction');
    assert.equal(detail.row.assetAmount?.assetGuid, '123456'); assert.equal(detail.row.assetAmount?.decimals, 8);
    assert.equal(detail.row.netUnits, '-1000000000'); assert.equal(detail.row.transactionFeeUnits, '100000000');
    assert.equal(detail.row.assetAmount?.direction, undefined); assert.deepEqual(detail.to, []);
  } finally { owner.lock(); }
});

test('summary refresh revokes a held selected detail and preserves its newly accepted compact page', async () => {
  const f = fixture(), owner = await f.open(), model = new UtxoActivity(owner, () => true); model.activate(); await settled(model);
  const wait = deferred<void>(); f.hold = wait.promise;
  try {
    const detail = model.selectDetail(H); await f.entered.promise;
    f.summaryHeight = 99; await model.refresh();
    assert.equal(model.getSnapshot().detail, null); assert.equal(model.getSnapshot().rows[0]?.block?.height, 99);
    wait.resolve(); await detail;
    assert.equal(model.getSnapshot().detail, null); assert.equal(model.getSnapshot().rows[0]?.block?.height, 99);
    f.hold = undefined; await model.selectDetail(H); assert.equal(model.getSnapshot().detail?.status, 'ready');
  } finally { wait.resolve(); model.dispose(); owner.lock(); }
});


test('one cancelled detail subscriber does not abort another live subscriber of the same raw read', async () => {
  const f = fixture(), owner = await f.open(); await owner.readUtxoActivityPage({ page: 1 }, signal());
  const wait = deferred<void>(), abort = new AbortController(); f.hold = wait.promise;
  try {
    const first = owner.readUtxoActivityDetail({ txid: H }, abort.signal);
    const second = owner.readUtxoActivityDetail({ txid: H }, signal());
    await f.entered.promise; await new Promise(resolve => setImmediate(resolve));
    abort.abort(); await assert.rejects(first);
    assert.equal(f.signals.at(-1)?.aborted, false, 'physical read still serves the other subscriber');
    wait.resolve(); assert.equal((await second).row.nativeTransfer?.amount, '900000000');
    assert.equal(f.calls.filter(path => path.startsWith('/api/v2/tx/')).length, 1);
  } finally { wait.resolve(); owner.lock(); }
});

test('a revived queued detail uses raw dispatch after the newly admitted summary', async () => {
  const f = fixture(3), owner = await f.open(), wait = deferred<void>(), abort = new AbortController();
  const original = await owner.readUtxoActivityPage({ page: 1 }, signal());
  f.hold = wait.promise;
  const rawCalls = () => f.calls.filter(path => path.startsWith('/api/v2/tx/'));
  try {
    const blockers = [ID(1), ID(2)].map(txid => owner.readUtxoActivityDetail({ txid }, signal()));
    await f.entered.promise; await new Promise(resolve => setImmediate(resolve));
    assert.equal(rawCalls().length, 2);
    const stale = owner.readUtxoActivityDetail({ txid: ID(3) }, abort.signal);
    const cancelled = assert.rejects(stale);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rawCalls().length, 2, 'the first target subscriber is queued');
    abort.abort(); await cancelled;

    f.summaryHeight = 99;
    const fresh = await owner.readUtxoActivityPage({ page: 1 }, signal());
    owner.retainUtxoActivityRows([original.rows[0]!, original.rows[1]!, fresh.rows[2]!]);
    const revived = owner.readUtxoActivityDetail({ txid: ID(3) }, signal());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rawCalls().length, 2, 'the new subscriber joins the queued target');
    wait.resolve();
    assert.equal((await revived).row.block?.height, 101);
    await Promise.all(blockers);
    assert.equal(rawCalls().filter(path => path.endsWith(ID(3))).length, 1);
  } finally { wait.resolve(); owner.lock(); }
});

test('detail cancellation remains independent from a simultaneous public balance operation', async () => {
  const f = fixture(), balance = deferred<void>(); let balanceSignal: AbortSignal | undefined;
  const owner = await f.open({ async readUtxoAccount(_network, _identifier, signal) { balanceSignal = signal; await balance.promise;
    return { networkId: 'bitcoin', kind: 'utxo', chainId: 0, genesisHash: getUtxoNetwork('bitcoin').genesisHash, confirmedUnits: '1', pendingDeltaUnits: '0', unconfirmedTransactions: 0, observedHeight: 100 }; } });
  const wait = deferred<void>(); f.hold = wait.promise;
  try {
    await owner.readUtxoActivityPage({ page: 1 }, signal());
    const refreshing = owner.refresh(), abort = new AbortController(), detail = owner.readUtxoActivityDetail({ txid: H }, abort.signal);
    await f.entered.promise; abort.abort(); await assert.rejects(detail); assert.equal(balanceSignal?.aborted, false);
    wait.resolve(); balance.resolve(); await refreshing; assert.equal(owner.getSnapshot().balance.status, 'available');
  } finally { wait.resolve(); balance.resolve(); owner.lock(); }
});

test('authority bounds transient row metadata without deleting returned display DTOs', async () => {
  const f = fixture(140), owner = await f.open();
  try {
    const retained = [];
    for (let page = 1; page <= 7; page++) retained.push(...(await owner.readUtxoActivityPage({ page }, signal())).rows);
    assert.equal(retained.length, 140); assert.equal(f.reader.summaryBytes(retained[0]!), null);
    assert.equal(retained.filter(row => f.reader.summaryBytes(row) !== null).length, 120);
    owner.retainUtxoActivityRows(retained.slice(-100));
    assert.equal(retained.filter(row => f.reader.summaryBytes(row) !== null).length, 100);
    await assert.rejects(owner.readUtxoActivityDetail({ txid: ID(21) }, signal()));
    await owner.readUtxoActivityDetail({ txid: ID(41) }, signal());
  } finally { owner.lock(); }
});

test('SJS read capabilities are captured when the reader is constructed before any held I/O', async () => {
  const f = fixture(), account = actualSjs.fetchBackendAccount, raw = actualSjs.fetchBackendRawTx;
  actualSjs.fetchBackendAccount = actualSjs.fetchBackendRawTx = async () => { throw Error('Replaced SJS read must not run'); };
  const owner = await f.open();
  try {
    await owner.readUtxoActivityPage({ page: 1 }, signal());
    assert.equal((await owner.readUtxoActivityDetail({ txid: H }, signal())).txid, H);
  } finally { actualSjs.fetchBackendAccount = account; actualSjs.fetchBackendRawTx = raw; owner.lock(); }
});


test('retained visible old rows keep their exact raw-summary capability after a partial same-page refresh', async () => {
  const f = fixture(20), owner = await f.open(), model = new UtxoActivity(owner, () => true); model.activate(); await settled(model);
  try {
    assert.equal(model.getSnapshot().rows.length, 20);
    const old = model.getSnapshot().rows.find(row => row.txid === ID(11))!;
    f.returnedCount = 10; await model.refresh();
    assert.equal(model.getSnapshot().rows.length, 20); assert.equal(model.getSnapshot().rows.find(row => row.txid === ID(11)), old);
    await model.selectDetail(ID(11)); assert.equal(model.getSnapshot().detail?.status, 'ready');
    assert.equal(f.calls.filter(path => path.startsWith('/api/v2/tx/')).length, 1);
    model.dispose(); assert.equal(f.reader.summaryBytes(old), null, 'forget is explicit even while caller holds public row');
  } finally { model.dispose(); owner.lock(); }
});

test('repeated partial refresh obeys the shared8MiB metadata bound and preserves compact rows on eviction', async () => {
  const f = fixture(1), owner = await f.open(), model = new UtxoActivity(owner, () => true);
  f.memo = 'M'.repeat(900000); f.rowShift = 1; model.activate(); await settled(model);
  try {
    const first = model.getSnapshot().rows[0]!;
    for (let shift = 2; shift <= 12; shift++) { f.rowShift = shift; await model.refresh(); }
    const rows = model.getSnapshot().rows;
    assert.equal(rows.length, 12); assert.equal(rows.find(row => row.txid === first.txid), first);
    assert.ok(rows.reduce((sum, row) => sum + (f.reader.summaryBytes(row) ?? 0), 0) <= 8 * 1024 * 1024);
    assert.equal(f.reader.summaryBytes(first), null); assert.equal(f.calls.some(path => path.startsWith('/api/v2/tx/')), false);
    const before = f.calls.length; await model.selectDetail(first.txid);
    assert.equal(model.getSnapshot().detail?.status, 'unavailable'); assert.equal(model.getSnapshot().detail?.row.netUnits, first.netUnits); assert.equal(f.calls.length, before);
    assert.ok(!JSON.stringify(rows).includes('MMMM'));
    model.dispose(); assert.ok(rows.every(row => f.reader.summaryBytes(row) === null));
  } finally { model.dispose(); owner.lock(); }
});

test('a cold authority admits new row capabilities without reviving a forgotten UI-held old row', async () => {
  const f = fixture(), first = await f.open(), page = await first.readUtxoActivityPage({ page: 1 }, signal()), old = page.rows[0]!;
  first.lock(); assert.equal(f.reader.summaryBytes(old), null);
  const next = await f.open();
  try {
    const fresh = await next.readUtxoActivityPage({ page: 1 }, signal()); assert.notEqual(fresh.rows[0], old);
    assert.equal((await next.readUtxoActivityDetail({ txid: H }, signal())).txid, H); assert.equal(f.reader.summaryBytes(old), null);
  } finally { next.lock(); }
});


for (const version of ['identical', 'earlier-better'] as const) test(`shared selected ${version} duplicate row keeps its own raw capability and attribution`, async () => {
  const f = fixture(2), owner = await f.open(), model = new UtxoActivity(owner, () => true);
  const first = f.summary();
  f.summaryRows = [first, version === 'identical' ? { ...first } : { ...first, blockHeight: 0, confirmations: 0, addressValueOut: '0', vout: [] }];
  model.activate(); await settled(model);
  try {
    assert.equal(model.getSnapshot().rows.length, 1);
    const chosen = model.getSnapshot().rows[0]!;
    assert.equal(chosen.block?.height, 100); assert.equal(chosen.netUnits, '-1000000000');
    await model.selectDetail(H);
    assert.equal(model.getSnapshot().detail?.status, 'ready');
    assert.equal(model.getSnapshot().detail?.row.netUnits, chosen.netUnits);
    assert.equal(model.getSnapshot().detail?.row.nativeTransfer?.amount, '900000000');
  } finally { model.dispose(); owner.lock(); }
});

test('dropping one row promptly settles only its held detail while another detail, balance and page remain live', async () => {
  const f = fixture(40), balance = deferred<void>(); let balanceSignal: AbortSignal | undefined;
  const owner = await f.open({ async readUtxoAccount(_network, _identifier, signal) { balanceSignal = signal; await balance.promise;
    return { networkId: 'bitcoin', kind: 'utxo', chainId: 0, genesisHash: getUtxoNetwork('bitcoin').genesisHash, confirmedUnits: '1', pendingDeltaUnits: '0', unconfirmedTransactions: 0, observedHeight: 100 }; } });
  const page = await owner.readUtxoActivityPage({ page: 1 }, signal()), wait = deferred<void>(), pageWait = deferred<void>();
  f.hold = wait.promise;
  const state = { first: 'pending', second: 'pending' };
  const first = owner.readUtxoActivityDetail({ txid: ID(1) }, signal()).then(() => { state.first = 'ready'; }, () => { state.first = 'rejected'; });
  const second = owner.readUtxoActivityDetail({ txid: ID(2) }, signal()).then(() => { state.second = 'ready'; }, () => { state.second = 'rejected'; });
  await f.entered.promise; await new Promise(resolve => setImmediate(resolve));
  f.accountHold = pageWait.promise;
  const paging = owner.readUtxoActivityPage({ page: 2 }, signal());
  const refreshing = owner.refresh(); await new Promise(resolve => setImmediate(resolve));
  try {
    owner.retainUtxoActivityRows([page.rows[1]!]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.first, 'rejected', 'invalidation settles without global/external abort or timeout');
    assert.equal(state.second, 'pending'); assert.equal(balanceSignal?.aborted, false);
    const firstIndex = f.calls.indexOf('/api/v2/tx/' + ID(1)), secondIndex = f.calls.indexOf('/api/v2/tx/' + ID(2));
    assert.equal(f.signals[firstIndex]?.aborted, true); assert.equal(f.signals[secondIndex]?.aborted, false);
    wait.resolve(); pageWait.resolve(); balance.resolve(); await Promise.all([first, second, paging, refreshing]);
    assert.equal(state.second, 'ready'); assert.equal(owner.getSnapshot().balance.status, 'available');
  } finally { owner.lock(); wait.resolve(); pageWait.resolve(); balance.resolve(); await Promise.allSettled([first, second, paging, refreshing]); }
});

test('metadata-cap eviction promptly aborts its held detail without requiring global release', async () => {
  const f = fixture(140), owner = await f.open(); await owner.readUtxoActivityPage({ page: 1 }, signal());
  const wait = deferred<void>(); f.hold = wait.promise; const state = { value: 'pending' };
  const detail = owner.readUtxoActivityDetail({ txid: ID(1) }, signal()).then(() => { state.value = 'ready'; }, () => { state.value = 'rejected'; });
  await f.entered.promise;
  try {
    for (let page = 2; page <= 7; page++) await owner.readUtxoActivityPage({ page }, signal());
    await new Promise(resolve => setImmediate(resolve)); assert.equal(state.value, 'rejected');
    assert.equal(f.signals[f.calls.indexOf('/api/v2/tx/' + ID(1))]?.aborted, true);
  } finally { owner.lock(); wait.resolve(); await detail; }
});


test('fresh same-hash replacement forgets the old row only on actual selection and promptly settles its held detail', async () => {
  const f = fixture(), owner = await f.open(), initial = await owner.readUtxoActivityPage({ page: 1 }, signal()), old = initial.rows[0]!;
  const wait = deferred<void>(); f.hold = wait.promise; const state = { value: 'pending' };
  const detail = owner.readUtxoActivityDetail({ txid: H }, signal()).then(() => { state.value = 'ready'; }, () => { state.value = 'rejected'; });
  await f.entered.promise;
  try {
    f.summaryHeight = 99; const fresh = await owner.readUtxoActivityPage({ page: 1 }, signal());
    assert.notEqual(fresh.rows[0], old); assert.notEqual(f.reader.summaryBytes(old), null);
    owner.retainUtxoActivityRows(fresh.rows); await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.value, 'rejected'); assert.equal(f.reader.summaryBytes(old), null);
    assert.equal(f.signals[f.calls.indexOf('/api/v2/tx/' + H)]?.aborted, true);
    wait.resolve(); f.hold = undefined; assert.equal((await owner.readUtxoActivityDetail({ txid: H }, signal())).txid, H);
    assert.equal(f.calls.filter(path => path === '/api/v2/tx/' + H).length, 2, 'aborted old body is not cached');
  } finally { owner.lock(); wait.resolve(); await detail; }
});

for (const revocation of ['lock', 'caller abort'] as const) test(`a synchronous ${revocation} during admission eviction discards the candidate page and its raw bindings`, async () => {
  const f = fixture();
  let issued: UtxoActivityPage | undefined;
  const owner = await f.open({}, {
    ...f.reader,
    async readPage(...args) {
      issued = await f.reader.readPage(...args);
      return issued;
    },
  });
  f.memo = 'M'.repeat(900000);
  for (let shift = 1; shift <= 9; shift++) {
    f.rowShift = shift;
    await owner.readUtxoActivityPage({ page: 1 }, signal());
  }
  const wait = deferred<void>();
  f.hold = wait.promise;
  const detail = owner.readUtxoActivityDetail({ txid: ID(2) }, signal());
  const rejectedDetail = assert.rejects(detail);
  await f.entered.promise;
  const transport = f.signals.at(-1)!;
  const pageRequest = new AbortController();
  transport.addEventListener('abort', () => {
    if (revocation === 'lock') owner.lock();
    else pageRequest.abort();
  }, { once: true });
  try {
    f.returnedCount = 2;
    f.summaryRows = [{ ...f.summary(ID(11)), memo: '' }, f.summary(ID(12))];
    const outcome = await owner.readUtxoActivityPage({ page: 1 }, pageRequest.signal).then(
      page => ({ page, error: null }),
      error => ({ page: null, error }),
    );
    assert.equal(owner.getSnapshot().status, revocation === 'lock' ? 'locked' : 'ready');
    assert.equal(transport.aborted, true);
    assert.deepEqual(issued?.rows.map(row => row.txid), [ID(11), ID(12)]);
    for (const row of issued!.rows) assert.equal(f.reader.summaryBytes(row), null);
    assert.equal(outcome.page, null);
    assert.match(String(outcome.error), /Account activity cancelled/);
    await rejectedDetail;

    f.hold = undefined;
    if (revocation === 'lock') owner.unlock();
    else assert.equal((await owner.readUtxoActivityDetail({ txid: ID(3) }, signal())).txid, ID(3));
    f.returnedCount = 1;
    f.summaryRows = [f.summary(ID(13))];
    const fresh = await owner.readUtxoActivityPage({ page: 1 }, signal());
    assert.notEqual(f.reader.summaryBytes(fresh.rows[0]!), null);
    for (const txid of [ID(11), ID(12)]) await assert.rejects(owner.readUtxoActivityDetail({ txid }, signal()));
    assert.equal((await owner.readUtxoActivityDetail({ txid: ID(13) }, signal())).txid, ID(13));
  } finally {
    owner.lock();
    wait.resolve();
    await rejectedDetail;
  }
});
