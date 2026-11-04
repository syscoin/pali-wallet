import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeActivity, type NativeActivityRuntime } from '../src/activity/nativeActivity.ts';
import { ActivityExplorerReader, type ActivityFeed } from '../src/activity/explorerReader.ts';
import { ActivityReceiptReader, type ActivityTransactionObservation } from '../src/activity/receiptReader.ts';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW, type ActivityCandidate, type ActivityScope, type ActivityViewState, type LocalActivityRecord, type TerminalActivityRecord } from '../src/activity/types.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const FP = 'a'.repeat(64);
const hash = (index: number) => `0x${index.toString(16).padStart(64, '0')}`;
const candidate = (index: number, block = 1000 - index, tokenHint = false): ActivityCandidate => ({ hash: hash(index), blockNumber: String(block), timestamp: 1700000000000 - index * 1000, tokenHint });
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
type PageCall = { scope: ActivityScope; feed: ActivityFeed; page: number; endblock: string; signal: AbortSignal };
class FakeExplorer extends ActivityExplorerReader {
  readonly pages: PageCall[] = [];
  readonly heads: ActivityScope[] = [];
  private readonly pageReply: (call: PageCall) => readonly ActivityCandidate[] | Promise<readonly ActivityCandidate[]>;
  private readonly headReply: (scope: ActivityScope) => string | Promise<string>;
  constructor(pageReply: (call: PageCall) => readonly ActivityCandidate[] | Promise<readonly ActivityCandidate[]> = () => [],
    headReply: (scope: ActivityScope) => string | Promise<string> = () => '1000') {
    super(async () => { throw Error('Unexpected real explorer fetch'); }); this.pageReply = pageReply; this.headReply = headReply;
  }
  override async head(scope: ActivityScope, _signal: AbortSignal, guard: () => void) { guard(); this.heads.push(scope); return this.headReply(scope); }
  override async page(scope: ActivityScope, feed: ActivityFeed, page: number, endblock: string, signal: AbortSignal, _guard: () => void) {
    const call = { scope, feed, page, endblock, signal }; this.pages.push(call); return this.pageReply(call);
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
  local?: LocalActivityRecord | null; cached?: ActivityCandidate[]; view?: ActivityViewState } = {}) {
  const state = source();
  let cached = options.cached ?? [];
  let cachedOwner = OWNER;
  const cacheWrites: { scope: ActivityScope; rows: readonly ActivityCandidate[] }[] = [];
  const viewWrites: { scope: ActivityScope; view: ActivityViewState }[] = [];
  const runtime: NativeActivityRuntime = {
    async load(check) {
      check(); const address = state.getSnapshot().account?.address ?? OWNER;
      const scope = createActivityScope(FP, address === OWNER ? 'hd:60:0' : 'hd:60:1', address, 'ethereum');
      return { scope, saved: { archived: options.archived ?? [], candidates: address === cachedOwner ? cached : [], view: options.view ?? DEFAULT_ACTIVITY_VIEW, truncated: false }, local: options.local ?? null };
    },
    async saveCache(scope, rows, check) { check(); cacheWrites.push({ scope, rows }); cached = [...rows]; cachedOwner = scope.address; },
    async saveView(scope, view, check) { check(); viewWrites.push({ scope, view }); },
  };
  const explorer = options.explorer ?? new FakeExplorer(); const receipts = options.receipts ?? new FakeReceipts();
  const controller = new NativeActivity(state, () => runtime, explorer, receipts);
  const scope = createActivityScope(FP, 'hd:60:0', OWNER, 'ethereum');
  const local = (index: number, phase: LocalActivityRecord['phase'] = 'confirmed'): LocalActivityRecord => ({ walletFingerprint: FP,
    accountId: scope.accountId, address: OWNER, networkId: 'ethereum', registrationHash: scope.network.registrationHash, chainId: '1',
    hash: hash(index), phase, nonce: index, createdAt: 1600000000000 + index, recipient: OTHER, amountUnits: '1', maximumFeeUnits: '21000' });
  return { controller, source: state, runtime, explorer, receipts, cacheWrites, viewWrites, local };
}

test('local journal/archive, cached candidates and duplicate ERC20 discovery merge by transaction hash', async () => {
  const base = fixture();
  const archived = base.local(1) as TerminalActivityRecord, local = base.local(2, 'submitted');
  const explorer = new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1), candidate(3)] : [candidate(3, 997, true)]);
  const receipts = new FakeReceipts((call) => ({ ...observation(call.hash, call.owner), events: call.hash === hash(3)
    ? [3, 4].map((logIndex) => ({ id: `${call.hash}:${logIndex}`, logIndex: String(logIndex), contractAddress: TOKEN, from: OTHER, to: OWNER, amountUnits: '10' })) : [] }));
  const f = fixture({ explorer, receipts, archived: [archived], local, cached: [candidate(1), candidate(3)] });
  await f.controller.refresh();
  await until(() => f.controller.getSnapshot().rows.every((row) => !!row.observation));
  const rows = f.controller.getSnapshot().rows;
  assert.equal(rows.length, 3); assert.equal(new Set(rows.map((row) => row.hash)).size, 3);
  assert.equal(rows.find((row) => row.hash === hash(1))?.local, archived);
  assert.equal(rows.find((row) => row.hash === hash(2))?.local?.phase, 'submitted');
  assert.equal(rows.find((row) => row.hash === hash(3))?.candidate?.tokenHint, true);
  assert.equal(rows.find((row) => row.hash === hash(3))?.observation?.events.length, 2);
  assert(f.cacheWrites.length > 0); assert.equal('sign' in f.runtime, false);
});

test('shared representative selection prefers the mined replacement while retaining the local attempt', async () => {
  const base = fixture();
  const explorer = new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1), candidate(2)] : []);
  const receipts = new FakeReceipts((call) => ({ ...observation(call.hash, call.owner), nonce: '7',
    block: call.hash === hash(1) ? null : { hash: hash(999), number: '1000' },
    status: call.hash === hash(1) ? 'pending' : 'confirmed' }));
  const f = fixture({ explorer, receipts, local: { ...base.local(1, 'submitted'), nonce: 7 } });
  await f.controller.refresh();
  await until(() => f.receipts.calls.length === 2 && f.controller.getSnapshot().rows.every((row) => !!row.observation));
  assert.deepEqual(new Set(f.controller.getSnapshot().rows.map((row) => row.hash)), new Set([hash(1), hash(2)]));
  assert.equal(f.controller.getSnapshot().rows.find((row) => row.hash === hash(1))?.local?.phase, 'submitted');
  const remoteOnly = fixture({ explorer, receipts });
  await remoteOnly.controller.refresh();
  await until(() => remoteOnly.receipts.calls.length >= 4 && remoteOnly.controller.getSnapshot().rows.length === 1);
  assert.equal(remoteOnly.controller.getSnapshot().rows[0]?.hash, hash(2));
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

test('load-more retries a failed head without overwriting cached history before recovery', async () => {
  let headReads = 0;
  const explorer = new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(9), candidate(10)] : [], () => {
    if (++headReads <= 2) throw Error('head unavailable');
    return '1000';
  });
  const f = fixture({ explorer, cached: [candidate(9)] });
  await f.controller.refresh();
  await f.controller.loadMore();
  assert.equal(headReads, 2);
  assert.equal(explorer.pages.length, 0);
  assert.equal(f.cacheWrites.length, 0);
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [hash(9)]);
  await f.controller.loadMore();
  assert.equal(headReads, 3);
  assert.equal(f.controller.getSnapshot().error, null);
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), [hash(9), hash(10)].sort());
  assert.equal(f.cacheWrites.length, 1);
  assert.deepEqual(f.cacheWrites[0]?.rows.map((row) => row.hash).sort(), [hash(9), hash(10)].sort());
});

test('refresh persists recent discoveries ahead of old cached hints for an offline reopen', async () => {
  let headReads = 0;
  const explorer = new FakeExplorer(({ feed }) => feed === 'txlist'
    ? Array.from({ length: 20 }, (_, index) => candidate(index + 1)) : [], () => {
    if (++headReads > 1) throw Error('offline');
    return '1000';
  });
  const f = fixture({ explorer, cached: Array.from({ length: 24 }, (_, index) => candidate(index + 100, 1)) });
  await f.controller.refresh();
  assert.deepEqual(f.cacheWrites.at(-1)?.rows.map((row) => row.hash).sort(), Array.from({ length: 20 }, (_, index) => hash(index + 1)));
  await f.controller.refresh();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), Array.from({ length: 20 }, (_, index) => hash(index + 1)));
  assert.match(f.controller.getSnapshot().error ?? '', /could not be fully loaded/);
});

test('cached fallback survives late hydration after refresh times out before a page frontier', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred<ActivityTransactionObservation | null>();
  const receipts = new FakeReceipts((call) => call.hash === hash(9) ? pending.promise : observation(call.hash));
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
  pending.resolve(observation(hash(9)));
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [hash(9)]);
  assert.equal(f.cacheWrites.length, 0);
  assert.match(f.controller.getSnapshot().error ?? '', /could not be fully loaded/);
  timedOut = true;
  await f.controller.loadMore();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), [hash(9), hash(10)].sort());
  assert.equal(f.controller.getSnapshot().error, null);
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

test('conflicting fresh block hints reject the whole page without replacing accepted rows', async () => {
  let pages = 0;
  const explorer = new FakeExplorer(() => ++pages === 1 ? [candidate(1, 101)] :
    [candidate(2, 100, true), candidate(1, 102, true)]);
  const f = fixture({ explorer, cached: [candidate(1, 99)] });
  await f.controller.refresh();
  assert.match(f.controller.getSnapshot().error ?? '', /feed.*unavailable/i);
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [hash(1)]);
  assert.equal(f.controller.getSnapshot().rows[0]?.candidate?.blockNumber, '101');
  assert.equal(f.controller.getSnapshot().rows[0]?.candidate?.tokenHint, false);
});

test('inspect refreshes an existing included observation without losing filter or anchor', async () => {
  let reads = 0;
  const receipts = new FakeReceipts((call) => observation(call.hash, call.owner, ++reads === 1 ? 'pending' : 'confirmed'));
  const view: ActivityViewState = { filter: 'sent', showZero: false, anchor: hash(1), offset: 10 };
  const f = fixture({ explorer: new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1)] : []), receipts, view });
  await f.controller.refresh(); await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === 'pending');
  f.controller.inspect(hash(1));
  await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === 'confirmed');
  assert.equal(reads, 2); assert.deepEqual(f.controller.getSnapshot().view, view);
});

test('a failed receipt lookup remains a visible unavailable row and can be retried from details', async () => {
  let reads = 0;
  const receipts = new FakeReceipts((call) => { if (++reads === 1) throw Error('receipt unavailable'); return observation(call.hash, call.owner); });
  const f = fixture({ explorer: new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1)] : []), receipts });
  await f.controller.refresh(); await until(() => f.controller.getSnapshot().rows[0]?.unavailable === true);
  assert.equal(f.controller.getSnapshot().rows[0]?.observation, undefined);
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
    await until(() => receipts.calls.some((call) => call.owner === OWNER));
    f.source.change({ account: { network: 'ethereum', address: OTHER } });
    await until(() => f.controller.getSnapshot().accountAddress === OTHER && f.controller.getSnapshot().rows.some((row) => row.hash === hash(2)));
    old.resolve(observation(hash(1), OWNER));
    await until(() => f.controller.getSnapshot().rows[0]?.observation?.from === OTHER);
    assert.equal(receipts.calls.find((call) => call.owner === OWNER)?.signal.aborted, true);
    assert.equal(f.controller.getSnapshot().rows.some((row) => row.hash === hash(1)), false);
  } finally { disconnect(); }
});

test('locking while an explorer page is pending clears the view and rejects its late cache write', async () => {
  const page = deferred<readonly ActivityCandidate[]>();
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
