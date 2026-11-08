import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeActivity, type NativeActivityRuntime } from '../src/activity/nativeActivity.ts';
import { ActivityExplorerReader, type ActivityFeed, type DiscoveredActivityCandidate } from '../src/activity/explorerReader.ts';
import { ActivityReceiptReader, type ActivityTransactionObservation } from '../src/activity/receiptReader.ts';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW, type ActivityCandidate, type EvmActivityReadScope as ActivityScope, type ActivityViewState, type LocalActivityRecord, type TerminalActivityRecord } from '../src/activity/types.ts';
import { mapEvmExplorerTransaction, mapEvmExplorerTokenTransfer, getEvmHistoryDirection } from '../../../source/shared/evmHistory.ts';
import { observeEvmTransaction, type EvmTransactionObservation } from '../../../source/shared/evmTransactionObservation.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const FP = 'a'.repeat(64);
const hash = (index: number) => `0x${index.toString(16).padStart(64, '0')}`;
const candidate = (index: number, block = 1000 - index, tokenHint = false, fields: Record<string, unknown> = {}): DiscoveredActivityCandidate => {
  const raw = { hash: hash(index), from: OWNER, to: OTHER, value: '1', blockNumber: String(block), confirmations: block > 0 ? '1' : '0', timeStamp: String(1700000000 - index), nonce: String(index), isError: '0', input: '0x', ...fields };
  const indexed = tokenHint ? mapEvmExplorerTokenTransfer({ ...raw, contractAddress: TOKEN, tokenSymbol: 'FIX', tokenDecimal: '18' }, 1) : mapEvmExplorerTransaction(raw, 1);
  return { hash: hash(index), blockNumber: String(block), timestamp: 1700000000000 - index * 1000, tokenHint, indexed };
};
const cachedCandidate = (row: ActivityCandidate): ActivityCandidate => ({ hash: row.hash, blockNumber: row.blockNumber, timestamp: row.timestamp, tokenHint: row.tokenHint });
const observation = (id: string, owner = OWNER, status: ActivityTransactionObservation['status'] = 'confirmed'): ActivityTransactionObservation => ({
  hash: id, from: owner, to: OTHER, valueUnits: '1', nonce: BigInt(id).toString(), timestamp: 1700000000000,
  block: { hash: hash(999), number: '1000' }, status, events: [], feeUnits: '21000',
});
const source = () => {
  let state: CustodySnapshot = { phase: 'ready', revision: 1, presence: 'existing', backup: 'confirmed', account: { network: 'ethereum', address: OWNER }, error: null };
  const listeners = new Set<(state: CustodySnapshot) => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: (state: CustodySnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    change(update: Partial<CustodySnapshot>) { state = { ...state, ...update, revision: state.revision + 1 }; for (const listener of listeners) listener(state); },
  };
};
type PageCall = { scope: ActivityScope; feed: ActivityFeed; page: number; signal: AbortSignal };
class FakeExplorer extends ActivityExplorerReader {
  readonly pages: PageCall[] = [];
  private readonly pageReply: (call: PageCall) => readonly DiscoveredActivityCandidate[] | Promise<readonly DiscoveredActivityCandidate[]>;
  constructor(pageReply: (call: PageCall) => readonly DiscoveredActivityCandidate[] | Promise<readonly DiscoveredActivityCandidate[]> = () => []) {
    super(async () => { throw Error('Unexpected real explorer fetch'); }); this.pageReply = pageReply;
  }
  override async page(scope: ActivityScope, feed: ActivityFeed, page: number, signal: AbortSignal, _guard: () => void) {
    const call = { scope, feed, page, signal }; this.pages.push(call); return this.pageReply(call);
  }
}
type ReceiptCall = { hash: string; owner: string; signal: AbortSignal; guard: () => void };
class FakeReceipts extends ActivityReceiptReader {
  readonly calls: ReceiptCall[] = [];
  private readonly reply: (call: ReceiptCall) => ActivityTransactionObservation | null | Promise<ActivityTransactionObservation | null>;
  constructor(reply: (call: ReceiptCall) => ActivityTransactionObservation | null | Promise<ActivityTransactionObservation | null> = (call) => observation(call.hash, call.owner)) {
    super({ fetch: async () => { throw Error('Unexpected real receipt fetch'); } }); this.reply = reply;
  }
  override async read(hash: string, owner: string, signal: AbortSignal, guard: () => void) {
    const call = { hash, owner, signal, guard }; this.calls.push(call); return this.reply(call);
  }
}
async function until(predicate: () => boolean, message = 'expected asynchronous Activity state') {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 0)); }
  assert.fail(message);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(options: { explorer?: FakeExplorer; receipts?: FakeReceipts; archived?: TerminalActivityRecord[];
  locals?: readonly LocalActivityRecord[]; local?: LocalActivityRecord | null; cached?: ActivityCandidate[]; view?: ActivityViewState; observeLocal?: (local: LocalActivityRecord) => Promise<EvmTransactionObservation>;
  loadSavedPending?: NativeActivityRuntime['loadSavedPending'] } = {}) {
  const state = source();
  let cached = (options.cached ?? []).map(cachedCandidate);
  const localReads: LocalActivityRecord[] = [];
  let cachedOwner = OWNER;
  const cacheWrites: { scope: ActivityScope; rows: readonly ActivityCandidate[] }[] = [];
  const viewWrites: { scope: ActivityScope; view: ActivityViewState }[] = [];
  const runtime: NativeActivityRuntime = {
    loadSavedPending: options.loadSavedPending,
    async load(check) {
      check(); const address = state.getSnapshot().account?.address ?? OWNER;
      const scope = createActivityScope(FP, address === OWNER ? 'hd:60:0' : 'hd:60:1', address, 'ethereum');
      return { scope, saved: { archived: options.archived ?? [], candidates: address === cachedOwner ? cached : [], view: options.view ?? DEFAULT_ACTIVITY_VIEW, truncated: false }, locals: options.locals ?? (options.local ? [options.local] : []) };
    },
    async observeLocal(local, check) { check(); localReads.push(local); return options.observeLocal ? options.observeLocal(local) : { status: 'missing', latestNonce: String(local.nonce) }; },
    async saveCache(scope, rows, check) { check(); cacheWrites.push({ scope, rows }); cached = [...rows]; cachedOwner = scope.address; },
    async saveView(scope, view, check) { check(); viewWrites.push({ scope, view }); },
  };
  const explorer = options.explorer ?? new FakeExplorer(); const receipts = options.receipts ?? new FakeReceipts();
  const controller = new NativeActivity(state, () => runtime, explorer, receipts);
  const scope = createActivityScope(FP, 'hd:60:0', OWNER, 'ethereum');
  const local = (index: number, phase: LocalActivityRecord['phase'] = 'confirmed'): LocalActivityRecord => ({ walletFingerprint: FP,
    accountId: scope.accountId, address: OWNER, networkId: 'ethereum', registrationHash: scope.network.registrationHash, chainId: '1',
    hash: hash(index), phase, nonce: index, createdAt: 1600000000000 + index, recipient: OTHER, amountUnits: '1', maximumFeeUnits: '21000' });
  return { controller, source: state, runtime, explorer, receipts, cacheWrites, viewWrites, localReads, local };
}

test('activity invalidation retires delayed observers before clearing the visible rows', async () => {
  const held = deferred<EvmTransactionObservation>();
  const seed = fixture();
  const f = fixture({ local: seed.local(1, 'submitted'), observeLocal: () => held.promise });
  const disconnect = f.controller.connect();
  try {
    await until(() => f.localReads.length === 1);
    f.controller.invalidate();
    const cleared = f.controller.getSnapshot();
    held.resolve({ status: 'missing', latestNonce: '0' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.controller.getSnapshot(), cleared);
    assert.equal(f.controller.getSnapshot().rows.length, 0);
  } finally { disconnect(); }
});

test('saved pending pages reach older hashes without polling them, and Back retires an in-flight page', async () => {
  const base = fixture();
  const recent = base.local(3, 'submitted'), older = base.local(1, 'attempted');
  const held = deferred<{ records: readonly LocalActivityRecord[]; nextCursor: null }>();
  const cursors: (string | undefined)[] = [];
  const f = fixture({ receipts: new FakeReceipts(() => null), async loadSavedPending(scope, beforeHash, guard) {
    guard(); assert.equal(scope.address, OWNER);
    cursors.push(beforeHash);
    if (cursors.length > 2) return held.promise;
    return beforeHash === undefined ? { records: [recent], nextCursor: recent.hash } : { records: [older], nextCursor: null };
  } });
  await f.controller.refresh();
  const explorerReads = f.explorer.pages.length;
  await f.controller.loadSavedPending();
  await f.controller.loadSavedPending();
  assert.deepEqual(cursors, [undefined, recent.hash]);
  assert.deepEqual(f.controller.getSnapshot().savedPending?.rows.map((row) => row.hash), [recent.hash, older.hash]);
  assert.equal(f.controller.getSnapshot().savedPending?.hasMore, false);
  assert.equal(f.explorer.pages.length, explorerReads);
  assert.equal(f.receipts.calls.length, 0);
  assert.equal(f.localReads.length, 0);

  f.controller.inspect(older.hash);
  await until(() => !!f.controller.getSnapshot().savedPending?.rows.find((row) => row.hash === older.hash)?.retainedObservation);
  assert.deepEqual(f.receipts.calls, []);
  assert.deepEqual(f.localReads.map((row) => row.hash), [older.hash]);

  f.controller.closeSavedPending();
  const late = f.controller.loadSavedPending();
  assert.equal(f.controller.getSnapshot().savedPending?.status, 'loading');
  f.controller.closeSavedPending();
  held.resolve({ records: [older], nextCursor: null });
  await late;
  assert.equal(f.controller.getSnapshot().savedPending, undefined);
});

test('older saved detail uses one owned observation even when explorer history still says confirmed', async () => {
  const older = fixture().local(1, 'submitted');
  const methods: string[] = [];
  const f = fixture({
    explorer: new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1)] : []),
    receipts: new FakeReceipts(() => null),
    async loadSavedPending() { return { records: [older], nextCursor: null }; },
    observeLocal: (local) => observeEvmTransaction({
      chainId: local.chainId, hash: local.hash, from: local.address, to: local.recipient, nonce: String(local.nonce),
    }, async (method, params) => {
      methods.push(method);
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getTransactionReceipt') {
        assert.deepEqual(params, [older.hash]);
        return null;
      }
      assert.equal(method, 'eth_getTransactionCount');
      assert.deepEqual(params, [OWNER, 'latest']);
      return '0x2';
    }, () => undefined),
  });
  await f.controller.refresh();
  await f.controller.loadSavedPending();
  assert.equal(f.controller.getSnapshot().rows[0]?.indexedStatus, 'confirmed');
  assert.equal(f.controller.getSnapshot().savedPending?.rows[0]?.indexed, undefined);
  assert.deepEqual(methods, []);
  f.controller.inspect(older.hash);
  await until(() => f.controller.getSnapshot().savedPending?.rows[0]?.retainedObservation?.status === 'missing');
  assert.deepEqual(f.receipts.calls, []);
  assert.deepEqual(methods, ['eth_chainId', 'eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_chainId']);
  assert.deepEqual(f.controller.getSnapshot().savedPending?.rows[0]?.retainedObservation, { status: 'missing', latestNonce: '2' });
});

test('an old saved-detail read cannot overwrite a new page for the same hash', async () => {
  const older = fixture().local(1, 'submitted');
  const old = deferred<EvmTransactionObservation>();
  let reads = 0;
  const f = fixture({
    receipts: new FakeReceipts(() => null),
    async loadSavedPending() { return { records: [older], nextCursor: null }; },
    observeLocal: async () => ++reads === 1 ? old.promise : { status: 'missing', latestNonce: '2' },
  });
  await f.controller.refresh();
  await f.controller.loadSavedPending();
  f.controller.inspect(older.hash);
  await until(() => reads === 1);
  f.controller.closeSavedPending();
  await f.controller.loadSavedPending();
  f.controller.inspect(older.hash);
  await until(() => reads === 2);
  old.resolve({ status: 'mined', outcome: 'confirmed', block: { number: '2', hash: hash(2) } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(f.controller.getSnapshot().savedPending?.rows[0]?.retainedObservation, { status: 'missing', latestNonce: '2' });
  assert.deepEqual(f.receipts.calls, []);
});

test('local journal/archive, cached candidates and duplicate ERC20 discovery merge by transaction hash', async () => {
  const base = fixture();
  const archived = base.local(1) as TerminalActivityRecord, local = base.local(2, 'submitted');
  const explorer = new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1), candidate(3)] : [candidate(3, 997, true)]);
  const f = fixture({ explorer, archived: [archived], local, cached: [candidate(1), candidate(3)] });
  await f.controller.refresh();
  await until(() => !!f.controller.getSnapshot().rows.find(row => row.hash === hash(3))?.display);
  const rows = f.controller.getSnapshot().rows;
  assert.equal(rows.length, 3); assert.equal(new Set(rows.map((row) => row.hash)).size, 3);
  assert.equal(rows.find((row) => row.hash === hash(1))?.local, archived);
  assert.equal(rows.find((row) => row.hash === hash(2))?.local?.phase, 'submitted');
  assert.equal(rows.find((row) => row.hash === hash(3))?.candidate?.tokenHint, false, 'cache summary describes the preferred transaction body');
  assert.equal(rows.find((row) => row.hash === hash(3))?.indexed?.historySource, 'explorer-txlist');
  assert.equal(f.receipts.calls.length, 0);
  assert.deepEqual(f.localReads.map(row => row.hash), [hash(2)]);
  assert(f.cacheWrites.length > 0); assert.equal('sign' in f.runtime, false);
  assert(f.cacheWrites.every(write => write.rows.every(row => Object.keys(row).sort().join(',') === 'blockNumber,hash,timestamp,tokenHint')));
});

test('shared representative selection prefers the mined replacement while retaining the local attempt', async () => {
  const base = fixture();
  const explorer = new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1, 0, false, { nonce: '7' }), candidate(2, 998, false, { nonce: '7' })] : []);
  const f = fixture({ explorer, local: { ...base.local(1, 'submitted'), nonce: 7 } });
  await f.controller.refresh();
  assert.deepEqual(new Set(f.controller.getSnapshot().rows.map((row) => row.hash)), new Set([hash(1), hash(2)]));
  assert.equal(f.controller.getSnapshot().rows.find((row) => row.hash === hash(1))?.local?.phase, 'submitted');
  assert.equal(f.receipts.calls.length, 0);
  const remoteOnly = fixture({ explorer });
  await remoteOnly.controller.refresh();
  assert.equal(remoteOnly.controller.getSnapshot().rows.length, 1);
  assert.equal(remoteOnly.controller.getSnapshot().rows[0]?.hash, hash(2));
  assert.equal(remoteOnly.receipts.calls.length, 0);
});

test('a healthy feed remains visible when the other feed fails, with explicit partial coverage', async () => {
  const explorer = new FakeExplorer(({ feed }) => { if (feed === 'txlist') throw Error('offline'); return [candidate(1, 100, true)]; });
  const f = fixture({ explorer });
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().status, 'ready');
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [hash(1)]);
  assert.match(f.controller.getSnapshot().error ?? '', /feed.*unavailable/i);
  assert.match(f.controller.getSnapshot().coverage, /Internal transfers are not included/);
});

test('both failed feeds preserve cached and locally submitted history instead of saving an empty list', async () => {
  const base = fixture();
  const explorer = new FakeExplorer(() => { throw Error('offline'); });
  const f = fixture({ explorer, cached: [candidate(9)], archived: [base.local(1) as TerminalActivityRecord] });
  await f.controller.refresh();
  assert.deepEqual(new Set(f.controller.getSnapshot().rows.map((row) => row.hash)), new Set([hash(1), hash(9)]));
  assert.match(f.controller.getSnapshot().error ?? '', /unavailable/i);
  assert(f.cacheWrites.every((write) => write.rows.some((row) => row.hash === hash(9))));
});

test('load-more retries failed feeds without overwriting cached history before recovery', async () => {
  let failing = true;
  const explorer = new FakeExplorer(({ feed }) => {
    if (failing) throw Error('feed unavailable');
    return feed === 'txlist' ? [candidate(9), candidate(10)] : [];
  });
  const f = fixture({ explorer, cached: [candidate(9)] });
  await f.controller.refresh(); await f.controller.loadMore();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [hash(9)]);
  assert(f.cacheWrites.every(write => write.rows.some(row => row.hash === hash(9))));
  failing = false;
  await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().error, null);
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), [hash(9), hash(10)].sort());
  assert.deepEqual(f.cacheWrites.at(-1)?.rows.map((row) => row.hash).sort(), [hash(9), hash(10)].sort());
});

test('refresh persists recent discoveries ahead of old cached hints for an offline reopen', async () => {
  let offline = false;
  const explorer = new FakeExplorer(({ feed }) => {
    if (offline) throw Error('offline');
    return feed === 'txlist' ? Array.from({ length: 20 }, (_, index) => candidate(index + 1)) : [];
  });
  const f = fixture({ explorer, cached: Array.from({ length: 24 }, (_, index) => candidate(index + 100, 1)) });
  await f.controller.refresh();
  assert.deepEqual(f.cacheWrites.at(-1)?.rows.map((row) => row.hash).sort(), Array.from({ length: 20 }, (_, index) => hash(index + 1)));
  offline = true; await f.controller.refresh();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), Array.from({ length: 20 }, (_, index) => hash(index + 1)));
  assert.match(f.controller.getSnapshot().error ?? '', /unavailable/);
  assert(f.controller.getSnapshot().rows.every(row => row.indexed === undefined && row.display === undefined));
  assert.equal(f.receipts.calls.length, 0);
});

test('cached fallback survives a timed-out page without implicit RPC hydration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receipts = new FakeReceipts();
  let timedOut = false;
  const explorer = new FakeExplorer(({ feed, signal }) => timedOut
    ? feed === 'txlist' ? [candidate(9), candidate(10)] : []
    : new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Error('timeout')), { once: true });
    }));
  const f = fixture({ explorer, receipts, cached: [candidate(9)] });
  const refreshing = f.controller.refresh();
  for (let turn = 0; turn < 20 && explorer.pages.length === 0; turn++) await Promise.resolve();
  assert.equal(explorer.pages.length, 1);
  t.mock.timers.tick(30000);
  await refreshing;
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [hash(9)]);
  assert.equal(f.cacheWrites.length, 0);
  assert.match(f.controller.getSnapshot().error ?? '', /could not be fully loaded/);
  timedOut = true;
  await f.controller.loadMore();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), [hash(9), hash(10)].sort());
  assert.equal(f.controller.getSnapshot().error, null);
});

test('Saved pending still pages and inspects after explorer timeout, then retires on lock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixtureRecords = fixture();
  const first = fixtureRecords.local(2, 'submitted'), older = fixtureRecords.local(1, 'attempted');
  const explorer = new FakeExplorer(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Error('timeout')), { once: true });
  }));
  const cursors: (string | undefined)[] = [];
  const held = deferred<EvmTransactionObservation>();
  let ownedChecks = 0;
  const f = fixture({
    explorer,
    async loadSavedPending(_scope, beforeHash, guard) {
      guard();
      cursors.push(beforeHash);
      return beforeHash === undefined ? { records: [first], nextCursor: first.hash }
        : { records: [older], nextCursor: null };
    },
    observeLocal: (local) => ++ownedChecks === 1
      ? Promise.resolve({ status: 'missing', latestNonce: String(local.nonce + 1) })
      : held.promise,
  });
  let detailSignal: AbortSignal | undefined;
  const observe = f.runtime.observeLocal!;
  f.runtime.observeLocal = (record, guard, signal) => {
    detailSignal = signal;
    return observe(record, guard, signal);
  };
  const disconnect = f.controller.connect();
  try {
    for (let turn = 0; turn < 20 && explorer.pages.length === 0; turn++) await Promise.resolve();
    assert.equal(explorer.pages.length, 1);
    t.mock.timers.tick(30000);
    for (let turn = 0; turn < 20 && !f.controller.getSnapshot().error; turn++) await Promise.resolve();
    assert.match(f.controller.getSnapshot().error ?? '', /could not be fully loaded/);
    assert.equal(explorer.pages[0]?.signal.aborted, true);
    t.mock.timers.reset();

    await f.controller.loadSavedPending();
    await f.controller.loadSavedPending();
    assert.deepEqual(cursors, [undefined, first.hash]);
    assert.deepEqual(f.controller.getSnapshot().savedPending?.rows.map((row) => row.hash), [first.hash, older.hash]);
    assert.equal(f.localReads.length, 0);
    assert.equal(f.receipts.calls.length, 0);

    f.controller.inspect(older.hash);
    await until(() => f.controller.getSnapshot().savedPending?.rows[1]?.retainedObservation?.status === 'missing');
    assert.equal(detailSignal?.aborted, false);
    assert.notEqual(detailSignal, explorer.pages[0]?.signal);
    assert.equal(explorer.pages.length, 1);
    assert.equal(f.receipts.calls.length, 0);

    f.controller.inspect(older.hash);
    await until(() => f.localReads.length === 2);
    f.source.change({ phase: 'locked', account: null });
    assert.equal(detailSignal?.aborted, true);
    assert.equal(f.controller.getSnapshot().canViewSavedPending, false);
    assert.equal(f.controller.getSnapshot().savedPending, undefined);
    held.resolve({ status: 'missing', latestNonce: '9' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.controller.getSnapshot().savedPending, undefined);
    assert.equal(f.controller.getSnapshot().status, 'locked');
  } finally {
    disconnect();
  }
});

test('load-more preserves cursors, deduplicates boundary rows and keeps the saved list position', async () => {
  const explorer = new FakeExplorer(({ feed, page }) => feed === 'tokentx' ? [] : page === 1
    ? Array.from({ length: 20 }, (_, index) => candidate(index + 1)) : [candidate(20), candidate(21)]);
  const view: ActivityViewState = { filter: 'received', showZero: true, anchor: hash(5), offset: 37 };
  const f = fixture({ explorer, view });
  await f.controller.refresh(); assert.equal(f.controller.getSnapshot().rows.length, 20);
  await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().rows.length, 21);
  assert.equal(f.controller.getSnapshot().rows.filter((row) => row.hash === hash(20)).length, 1);
  assert.deepEqual(explorer.pages.filter((call) => call.feed === 'txlist').map((call) => call.page), [1, 2]);
  assert.deepEqual(f.controller.getSnapshot().view, view);
  f.controller.setView({ anchor: hash(21), offset: 4 });
  await until(() => f.viewWrites.length === 1);
  assert.equal(f.viewWrites[0]?.view.filter, 'received'); assert.equal(f.viewWrites[0]?.view.anchor, hash(21));
});

test('duplicate-only ERC20 pages can advance to older transactions within the bounded request budget', async () => {
  const explorer = new FakeExplorer(({ feed, page }) => feed === 'txlist' ? [] : page <= 2
    ? Array.from({ length: 20 }, () => candidate(1, 100, true)) : [candidate(2, 99, true)]);
  const f = fixture({ explorer });
  await f.controller.refresh();
  assert.deepEqual(new Set(f.controller.getSnapshot().rows.map((row) => row.hash)), new Set([hash(1), hash(2)]));
  assert(explorer.pages.length <= 6);
});

test('event-heavy token history can continue across more than ten bounded load actions', async () => {
  const explorer = new FakeExplorer(({ feed, page }) => feed === 'txlist' ? [] : page <= 80
    ? Array.from({ length: 20 }, () => candidate(Math.ceil(page / 20), 1000 - Math.ceil(page / 20), true)) : []);
  const f = fixture({ explorer });
  await f.controller.refresh();
  let actions = 0;
  while (f.controller.getSnapshot().hasMore && actions++ < 20) {
    const before = explorer.pages.length;
    await f.controller.loadMore();
    assert(explorer.pages.length - before <= 6);
  }
  assert(actions > 10);
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), [1, 2, 3, 4].map(hash));
  assert.equal(explorer.pages.filter((call) => call.feed === 'tokentx').at(-1)?.page, 81);
  assert.equal(f.controller.getSnapshot().hasMore, false);
  assert.equal(f.controller.getSnapshot().truncated, false);
  assert.equal(f.controller.getSnapshot().error, null);
});

test('finished feeds retain navigation to already loaded rows and report the display cap', async () => {
  const finite = fixture({ explorer: new FakeExplorer(({ feed }) => Array.from({ length: 15 }, (_, index) =>
    candidate(index + (feed === 'txlist' ? 1 : 16)))) });
  await finite.controller.refresh();
  assert.equal(finite.controller.getSnapshot().rows.length, 20);
  assert.equal(finite.controller.getSnapshot().hasMore, true);
  const requests = finite.explorer.pages.length;
  await finite.controller.loadMore();
  assert.equal(finite.controller.getSnapshot().rows.length, 30);
  assert.equal(finite.explorer.pages.length, requests);
  assert.equal(finite.controller.getSnapshot().hasMore, false);
  assert.equal(finite.controller.getSnapshot().truncated, false);

  const capped = fixture({ explorer: new FakeExplorer(({ feed, page }) => feed === 'tokentx' ? [] :
    Array.from({ length: 20 }, (_, index) => candidate((page - 1) * 20 + index + 1))) });
  await capped.controller.refresh();
  for (let action = 0; action < 9; action++) await capped.controller.loadMore();
  assert.equal(capped.controller.getSnapshot().rows.length, 200);
  assert.equal(capped.controller.getSnapshot().hasMore, false);
  assert.equal(capped.controller.getSnapshot().truncated, true);
  const cappedRequests = capped.explorer.pages.length;
  await capped.controller.loadMore();
  assert.equal(capped.explorer.pages.length, cappedRequests);
});

test('repeated full ordinary pages remain bounded and never imply completed history', async () => {
  const repeated = Array.from({ length: 20 }, (_, index) => candidate(index + 1));
  const explorer = new FakeExplorer(({ feed }) => feed === 'tokentx' ? [] : repeated);
  const f = fixture({ explorer });
  await f.controller.refresh(); await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().rows.length, 20);
  assert.equal(f.controller.getSnapshot().hasMore, true);
  assert(explorer.pages.length <= 8, 'each action has at most six page requests');
});

test('a failed older page is retried at the same cursor and retains the current list', async () => {
  let failures = 0;
  const explorer = new FakeExplorer(({ feed, page }) => {
    if (feed === 'tokentx') return [];
    if (page === 1) return Array.from({ length: 20 }, (_, index) => candidate(index + 1));
    if (failures++ === 0) throw Error('temporary page failure');
    return [candidate(21)];
  });
  const f = fixture({ explorer });
  await f.controller.refresh(); await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().rows.length, 20);
  await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().rows.length, 21);
  assert.deepEqual(explorer.pages.filter((call) => call.feed === 'txlist').map((call) => call.page), [1, 2, 2]);
});

test('repeated older-page failures do not spend the remaining history display capacity', async () => {
  let unavailable = true;
  const explorer = new FakeExplorer(({ feed, page }) => {
    if (feed === 'tokentx') return [];
    if (page === 1) return Array.from({ length: 20 }, (_, index) => candidate(index + 1));
    if (unavailable) throw Error('temporary page failure');
    return [candidate(21)];
  });
  const f = fixture({ explorer });
  await f.controller.refresh();
  for (let attempt = 0; attempt < 12; attempt++) {
    await f.controller.loadMore();
    assert.equal(f.controller.getSnapshot().hasMore, true);
    assert.equal(f.controller.getSnapshot().rows.length, 20);
  }
  unavailable = false;
  await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().rows.length, 21);
  assert.equal(f.controller.getSnapshot().hasMore, false);
  assert.equal(f.controller.getSnapshot().truncated, false);
  assert.equal(f.controller.getSnapshot().error, null);
  assert.deepEqual(explorer.pages.filter((call) => call.feed === 'txlist').map((call) => call.page), [1, ...Array(13).fill(2)]);
});

test('a refresh replaces stale cached block hints after a transaction is re-included', async () => {
  const explorer = new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1, 101), candidate(2, 100)] : []);
  const f = fixture({ explorer, cached: [candidate(1, 99)] });
  for (let refresh = 0; refresh < 2; refresh++) {
    await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().error, null);
    assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), [hash(1), hash(2)]);
    assert.equal(f.controller.getSnapshot().rows.find((row) => row.hash === hash(1))?.candidate?.blockNumber, '101');
    assert.equal(f.cacheWrites.at(-1)?.rows.find((row) => row.hash === hash(1))?.blockNumber, '101');
  }
});

test('shared source precedence keeps the transaction body when a token page repeats its hash with another block hint', async () => {
  let pages = 0;
  const explorer = new FakeExplorer(() => ++pages === 1 ? [candidate(1, 101)] :
    [candidate(2, 100, true), candidate(1, 102, true)]);
  const f = fixture({ explorer, cached: [candidate(1, 99)] });
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().error, null);
  assert.deepEqual(new Set(f.controller.getSnapshot().rows.map((row) => row.hash)), new Set([hash(1), hash(2)]));
  const preferred = f.controller.getSnapshot().rows.find(row => row.hash === hash(1))!;
  assert.equal(preferred.candidate?.blockNumber, '101');
  assert.equal(preferred.candidate?.tokenHint, false);
  assert.equal(preferred.indexed?.blockNumber, 101);
  assert.equal(preferred.indexed?.historySource, 'explorer-txlist');
  assert.equal(f.cacheWrites.at(-1)?.rows.find(row => row.hash === hash(1))?.blockNumber, '101');
  assert.equal(f.receipts.calls.length, 0);
});

test('inspect explicitly enriches only the selected row without losing indexed facts, filter or anchor', async () => {
  let reads = 0;
  const receipts = new FakeReceipts((call) => observation(call.hash, call.owner, ++reads === 1 ? 'pending' : 'confirmed'));
  const view: ActivityViewState = { filter: 'sent', showZero: false, anchor: hash(1), offset: 10 };
  const f = fixture({ explorer: new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1), candidate(2)] : []), receipts, view });
  await f.controller.refresh();
  assert.equal(reads, 0); assert.equal(f.controller.getSnapshot().rows[0]?.indexedStatus, 'confirmed');
  f.controller.inspect(hash(1));
  await until(() => f.controller.getSnapshot().rows.find(row => row.hash === hash(1))?.observation?.status === 'pending');
  assert.equal(f.controller.getSnapshot().rows.find(row => row.hash === hash(1))?.indexedStatus, 'confirmed');
  f.controller.inspect(hash(1));
  await until(() => f.controller.getSnapshot().rows.find(row => row.hash === hash(1))?.observation?.status === 'confirmed');
  assert.equal(reads, 2); assert.deepEqual(f.controller.getSnapshot().view, view);
  assert(f.receipts.calls.every(call => call.hash === hash(1)));
});

test('failed detail enrichment preserves indexed amount, recipient and status and can be explicitly retried', async () => {
  let reads = 0;
  const receipts = new FakeReceipts((call) => { if (++reads === 1) throw Error('receipt unavailable'); return observation(call.hash, call.owner); });
  const f = fixture({ explorer: new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1)] : []), receipts });
  await f.controller.refresh();
  const before = f.controller.getSnapshot().rows[0]!;
  assert.equal(reads, 0);
  f.controller.inspect(hash(1)); await until(() => f.controller.getSnapshot().rows[0]?.unavailable === true);
  const after = f.controller.getSnapshot().rows[0]!;
  assert.equal(after.observation, undefined); assert.deepEqual(after.indexed, before.indexed);
  assert.deepEqual(after.display, before.display); assert.equal(after.indexedStatus, 'confirmed');
  f.controller.inspect(hash(1)); await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === 'confirmed');
  assert.equal(reads, 2);
});

test('late receipt results from the old account cannot populate the next account', async () => {
  const old = deferred<ActivityTransactionObservation | null>();
  const receipts = new FakeReceipts((call) => call.owner === OWNER ? old.promise : observation(call.hash, call.owner));
  const explorer = new FakeExplorer(({ scope, feed }) => feed === 'txlist' ? [candidate(scope.address === OWNER ? 1 : 2)] : []);
  const f = fixture({ explorer, receipts });
  const disconnect = f.controller.connect();
  try {
    await until(() => f.controller.getSnapshot().rows.some(row => row.hash === hash(1)));
    f.controller.inspect(hash(1));
    await until(() => receipts.calls.some((call) => call.owner === OWNER));
    f.source.change({ account: { network: 'ethereum', address: OTHER } });
    await until(() => f.controller.getSnapshot().accountAddress === OTHER && f.controller.getSnapshot().rows.some((row) => row.hash === hash(2)));
    old.resolve(observation(hash(1), OWNER));
    f.controller.inspect(hash(2));
    await until(() => f.controller.getSnapshot().rows[0]?.observation?.from === OTHER);
    assert.equal(receipts.calls.find((call) => call.owner === OWNER)?.signal.aborted, true);
    assert.equal(f.controller.getSnapshot().rows.some((row) => row.hash === hash(1)), false);
  } finally { disconnect(); }
});

test('locking while an explorer page is pending clears the view and rejects its late cache write', async () => {
  const page = deferred<readonly DiscoveredActivityCandidate[]>();
  const explorer = new FakeExplorer(() => page.promise);
  const f = fixture({ explorer }); const disconnect = f.controller.connect();
  try {
    await until(() => explorer.pages.length > 0);
    f.source.change({ phase: 'locked', account: null });
    page.resolve([candidate(1)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.controller.getSnapshot().status, 'locked'); assert.deepEqual(f.controller.getSnapshot().rows, []);
    assert.equal(f.cacheWrites.length, 0);
  } finally { disconnect(); }
});


test('multiple retained local sends survive offline refresh and deduplicate indexed hashes', async () => {
  const base=fixture(), first=base.local(1),second=base.local(2,'submitted');
  let offline=true;
  const explorer=new FakeExplorer(({feed})=>{if(offline)throw Error('offline');return feed==='txlist'?[candidate(1),candidate(2)]:[];});
  const f=fixture({explorer,locals:[first,second]});
  await f.controller.refresh();
  assert.deepEqual(new Set(f.controller.getSnapshot().rows.map(row=>row.hash)),new Set([first.hash,second.hash]));
  offline=false;await f.controller.refresh();
  await until(()=>f.controller.getSnapshot().rows.every(row=>!!row.display));
  assert.equal(f.receipts.calls.length,0);
  assert.equal(f.controller.getSnapshot().rows.length,2);
  assert.equal(f.controller.getSnapshot().rows.every(row=>!!row.local),true);
});

for (const token of [false, true]) test(`real ${token ? 'ERC20' : 'native'} indexed page renders twenty exact rows with two feed reads and zero history RPC`, async () => {
  const calls: string[] = [];
  const units = '9007199254740993';
  const explorer = new ActivityExplorerReader(async (url, init) => {
    assert.equal(init.body, undefined, 'history must not issue a JSON-RPC request');
    assert.equal(init.method === undefined || init.method === 'GET', true);
    const target = new URL(url), action = target.searchParams.get('action')!;
    calls.push(action);
    assert.equal(target.searchParams.get('address'), OWNER);
    assert.equal(target.searchParams.get('offset'), '20');
    assert.equal(target.searchParams.has('endblock'), false);
    const matches = token ? action === 'tokentx' : action === 'txlist';
    return new Response(JSON.stringify({ status: '1', message: 'OK', result: matches ? Array.from({ length: 20 }, (_, index) => ({
      hash: hash(index + 1), from: OTHER, to: OWNER, blockNumber: String(1000 - index), timeStamp: String(1700000000 - index),
      confirmations: '0', nonce: String(index), value: units, input: '0x', txreceipt_status: '1',
      ...(token ? { contractAddress: TOKEN, tokenDecimal: '0', tokenSymbol: 'EXACT' } : {}),
    })) : [] }));
  });
  const f = fixture();
  const model = new NativeActivity(f.source, () => f.runtime, explorer, f.receipts);
  await model.refresh();
  assert.equal(model.getSnapshot().rows.length, 20);
  assert.deepEqual(calls.sort(), ['tokentx', 'txlist']);
  for (const row of model.getSnapshot().rows) {
    assert.equal(row.indexedStatus, 'confirmed', 'positive indexed block is included even with zero confirmations');
    assert.equal(row.display?.displayValue, token ? units : '0.009007199254740993');
    assert.equal(row.display?.displaySymbol, token ? 'EXACT' : 'ETH');
    assert.equal(row.display?.actualRecipient, OWNER);
    assert.equal(row.observation, undefined);
  }
  assert.equal(f.receipts.calls.length, 0);
  await model.setView({ filter: 'received', showZero: true });
  assert.deepEqual(calls.sort(), ['tokentx', 'txlist']);
  assert.equal(f.receipts.calls.length, 0);
  assert(f.cacheWrites.every(write => write.rows.every(row => Object.keys(row).sort().join(',') === 'blockNumber,hash,timestamp,tokenHint')));
});

test('unresolved local observation is independently guarded and never routes through indexed detail hydration', async () => {
  const base = fixture(), pending = deferred<EvmTransactionObservation>();
  const f = fixture({ local: base.local(1, 'submitted'), observeLocal: () => pending.promise });
  const disconnect = f.controller.connect();
  try {
    await until(() => f.localReads.length === 1);
    f.source.change({ phase: 'locked', account: null });
    pending.resolve({ status: 'mined', outcome: 'confirmed', block: { hash: hash(99), number: '1' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.controller.getSnapshot().status, 'locked');
    assert.deepEqual(f.controller.getSnapshot().rows, []);
    assert.equal(f.receipts.calls.length, 0);
  } finally { disconnect(); }
});

test('actual shared feed merge keeps the indexed self-token recipient without any RPC', async () => {
  const rpc: string[] = [];
  const explorer = new ActivityExplorerReader(async (url, init) => {
    if (init.body) { rpc.push(String(init.body)); throw Error('No list RPC'); }
    const token = new URL(url).searchParams.get('action') === 'tokentx';
    const raw = { hash: hash(41), from: OWNER, to: token ? OWNER : TOKEN, value: '0',
      blockNumber: '100', confirmations:'0', timeStamp:'1700000000', nonce:'0', input:'0x', isError:'0',
      ...(token ? { contractAddress:TOKEN, tokenDecimal:'18', tokenSymbol:'SELF' } : {}) };
    return new Response(JSON.stringify({status:'1',message:'OK',result:[raw]}));
  });
  const state = source(), receipts = new FakeReceipts();
  const controller = new NativeActivity(state, () => ({
    async load(){return {scope:createActivityScope(FP,'hd:60:0',OWNER,'ethereum'),locals:[],saved:{archived:[],candidates:[],view:DEFAULT_ACTIVITY_VIEW,truncated:false}};},
    async saveCache(){},async saveView(){}
  }), explorer, receipts);
  await controller.refresh();
  const row = controller.getSnapshot().rows[0]!;
  assert.equal(row.indexed?.tokenRecipient, OWNER);
  assert.equal(getEvmHistoryDirection(row.indexed!, OWNER),'self');
  assert.equal(row.indexedStatus,'confirmed');
  assert.equal(receipts.calls.length,0); assert.deepEqual(rpc,[]);
});

test('only unresolved retained local records are observed, with at most two in flight', async () => {
  const base = fixture(), wait = deferred<EvmTransactionObservation>();
  let active=0, maximum=0;
  const records=[1,2,3,4].map(n=>base.local(n,'submitted'));
  const f=fixture({locals:[...records,base.local(5,'confirmed'),base.local(6,'reverted'),base.local(7,'nonce-consumed')],observeLocal:async()=>{
    active++;maximum=Math.max(maximum,active);const result=await wait.promise;active--;return result;
  }});
  await f.controller.refresh();
  assert.equal(f.localReads.length,2); assert.equal(maximum,2);
  wait.resolve({status:'missing',latestNonce:'0'});
  await until(()=>f.localReads.length===4 && active===0);
  assert.deepEqual(f.localReads.map(row=>row.hash).sort(),records.map(row=>row.hash).sort());
  assert.equal(maximum,2); assert.equal(f.receipts.calls.length,0);
});


for (const mixed of [false, true]) test(`actual explorer ${mixed ? 'mixed-case body/token overlap' : 'token-only same event sender and outer nonce'} preserves both hashes through rendering and cache`, async () => {
  const calls: string[] = [];
  const first = hash(0xabc), second = hash(0xdef);
  const wireHash = (value: string) => mixed ? `0x${value.slice(2).toUpperCase()}` : value;
  const raw = (id: string, token: boolean) => ({ hash: wireHash(id), from: OTHER, to: OWNER, nonce: mixed && id === second ? '8' : '7',
    blockNumber: id === first ? '100' : '99', confirmations: '2', timeStamp: '1700000000', value: '1', input: '0x', isError: '0',
    ...(token ? { contractAddress: TOKEN, tokenDecimal: '0', tokenSymbol: 'TOK' } : {}) });
  const explorer = new ActivityExplorerReader(async (url, init) => {
    assert.equal(init.body, undefined, 'ordinary history must not issue RPC');
    const target = new URL(url), action = target.searchParams.get('action')!; calls.push(action);
    return new Response(JSON.stringify({ status: '1', message: 'OK', result: action === 'txlist'
      ? mixed ? [raw(first, false)] : [] : mixed && target.searchParams.get('page') === '1'
        ? Array.from({ length: 20 }, (_, index) => raw(index % 2 ? second : first, true)) : [raw(first, true), raw(second, true)] }));
  });
  const f = fixture(), controller = new NativeActivity(f.source, () => f.runtime, explorer, f.receipts);
  await controller.refresh();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, 'ready'); assert.equal(snapshot.error, null); assert.equal(snapshot.loadingMore, false);
  assert.deepEqual(snapshot.rows.map(row => row.hash).sort(), [first, second]);
  assert(snapshot.rows.every(row => row.indexed && row.display));
  assert.equal(snapshot.rows.find(row => row.hash === first)?.indexed?.historySource, mixed ? 'explorer-txlist' : 'explorer-tokentx');
  assert.equal(snapshot.rows.find(row => row.hash === second)?.display?.displayValue, '1');
  assert.deepEqual(calls.sort(), mixed ? ['tokentx', 'tokentx', 'txlist'] : ['tokentx', 'txlist']); assert.equal(f.receipts.calls.length, 0);
  assert.deepEqual(f.cacheWrites.at(-1)?.rows.map(row => row.hash).sort(), [first, second]);
  assert(f.cacheWrites.every(write => write.rows.every(row => Object.keys(row).sort().join(',') === 'blockNumber,hash,timestamp,tokenHint')));
  await controller.loadMore();
  assert.deepEqual(controller.getSnapshot().rows.map(row => row.hash).sort(), [first, second]);
  assert.equal(controller.getSnapshot().error, null);
});
