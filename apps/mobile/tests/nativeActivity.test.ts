import assert from 'node:assert/strict';
import test from 'node:test';
import { activityRowKey, findActivityRow, NativeActivity, type NativeActivityRuntime } from '../src/activity/nativeActivity.ts';
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
  return { hash: hash(index), blockNumber: String(block), timestamp: 1700000000000 - index * 1000, tokenHint, indexed, ...(tokenHint ? { tokenEvent: raw } : {}) };
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
type PageCall = { scope: ActivityScope; feed: ActivityFeed; page: number; signal: AbortSignal; guard: () => void };
class FakeExplorer extends ActivityExplorerReader {
  readonly pages: PageCall[] = [];
  private readonly pageReply: (call: PageCall) => readonly DiscoveredActivityCandidate[] | Promise<readonly DiscoveredActivityCandidate[]>;
  constructor(pageReply: (call: PageCall) => readonly DiscoveredActivityCandidate[] | Promise<readonly DiscoveredActivityCandidate[]> = () => []) {
    super(async () => { throw Error('Unexpected real explorer fetch'); }); this.pageReply = pageReply;
  }
  override async page(scope: ActivityScope, feed: ActivityFeed, page: number, signal: AbortSignal, guard: () => void) {
    const call = { scope, feed, page, signal, guard }; this.pages.push(call); return this.pageReply(call);
  }
}
function boundedStalledExplorer() {
  const signals: AbortSignal[] = [];
  const reader = new ActivityExplorerReader(async (_url, init) => {
    signals.push(init.signal as AbortSignal);
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(Error('Transport cancelled')), { once: true });
    });
  });
  const explorer = new FakeExplorer(call => reader.page({ ...call.scope, apiUrl: 'https://explorer.example/api' }, call.feed, call.page, call.signal, call.guard));
  return { explorer, signals };
}
async function expireExplorerResponses(t: { mock: { timers: { tick(ms: number): void } } }) {
  // Each admitted feed owns its real 12-second response deadline.
  for (let feed = 0; feed < 2; feed++) {
    t.mock.timers.tick(12_000);
    for (let turn = 0; turn < 40; turn++) await Promise.resolve();
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
  network?: NonNullable<CustodySnapshot['account']>['network'];
  locals?: readonly LocalActivityRecord[]; local?: LocalActivityRecord | null; cached?: ActivityCandidate[]; view?: ActivityViewState; observeLocal?: (local: LocalActivityRecord) => Promise<EvmTransactionObservation>;
  loadSavedPending?: NativeActivityRuntime['loadSavedPending'];
  loadTarget?: NativeActivityRuntime['loadTarget'];
  smartAuthorizations?: Awaited<ReturnType<NativeActivityRuntime['load']>>['smartAuthorizations'];
  loadSmartAuthorizations?: NativeActivityRuntime['loadSmartAuthorizations'];
  observeSmartAuthorization?: NativeActivityRuntime['observeSmartAuthorization'];
} = {}) {
  const state = source();
  const network = options.network ?? 'ethereum';
  if (options.network) state.change({ account: { network, address: OWNER } });
  let cached = (options.cached ?? []).map(cachedCandidate);
  const localReads: LocalActivityRecord[] = [];
  let cachedOwner = OWNER;
  const cacheWrites: { scope: ActivityScope; rows: readonly ActivityCandidate[] }[] = [];
  const viewWrites: { scope: ActivityScope; view: ActivityViewState }[] = [];
  const runtime: NativeActivityRuntime = {
    loadSavedPending: options.loadSavedPending,
    loadTarget: options.loadTarget,
    loadSmartAuthorizations: options.loadSmartAuthorizations,
    observeSmartAuthorization: options.observeSmartAuthorization,
    async load(check) {
      check(); const address = state.getSnapshot().account?.address ?? OWNER;
      const scope = createActivityScope(FP, address === OWNER ? 'hd:60:0' : 'hd:60:1', address, network);
      return { scope, olderRetained: !!options.loadSavedPending, smartAuthorizations: options.smartAuthorizations, saved: { archived: options.archived ?? [], candidates: address === cachedOwner ? cached : [], view: options.view ?? DEFAULT_ACTIVITY_VIEW, truncated: false }, locals: options.locals ?? (options.local ? [options.local] : []) };
    },
    async observeLocal(local, check) { check(); localReads.push(local); return options.observeLocal ? options.observeLocal(local) : { status: 'missing', latestNonce: String(local.nonce) }; },
    async saveCache(scope, rows, check) { check(); cacheWrites.push({ scope, rows }); cached = [...rows]; cachedOwner = scope.address; },
    async saveView(scope, view, check) { check(); viewWrites.push({ scope, view }); },
  };
  const explorer = options.explorer ?? new FakeExplorer(); const receipts = options.receipts ?? new FakeReceipts();
  const controller = new NativeActivity(state, () => runtime, explorer, receipts);
  const scope = createActivityScope(FP, 'hd:60:0', OWNER, network);
  const local = (index: number, phase: LocalActivityRecord['phase'] = 'confirmed'): LocalActivityRecord => ({ walletFingerprint: FP,
    accountId: scope.accountId, address: OWNER, networkId: network, registrationHash: scope.network.registrationHash, chainId: scope.network.chainId,
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

test('same-scope refresh keeps the displayed token row until fresh pending history replaces it', async () => {
  const page = deferred<readonly DiscoveredActivityCandidate[]>();
  let refreshing = false, heldEntered = false;
  const f = fixture({
    explorer: new FakeExplorer(({ feed }) => {
      if (feed !== 'tokentx') return [];
      if (refreshing) { heldEntered = true; return page.promise; }
      return [candidate(1, 999, true)];
    }),
    receipts: new FakeReceipts(call => observation(call.hash, call.owner, refreshing ? 'pending' : 'confirmed')),
  });
  await f.controller.refresh();
  f.controller.inspect(hash(1));
  await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === 'confirmed');
  const before = f.controller.getSnapshot().rows[0]!;
  assert(before.display);
  refreshing = true;
  const pending = f.controller.refresh();
  assert.equal(f.controller.getSnapshot().status, 'loading');
  assert.equal(f.controller.getSnapshot().rows[0], before);
  await until(() => heldEntered);
  assert.equal(f.controller.getSnapshot().rows[0]?.display, before.display);
  assert.equal(f.controller.getSnapshot().rows[0]?.observation?.status, 'confirmed');
  page.resolve([candidate(1, 0, true)]);
  await pending;
  const after = f.controller.getSnapshot().rows[0]!;
  assert.equal(f.controller.getSnapshot().status, 'ready');
  assert.equal(after.indexedStatus, 'pending');
  assert.equal(after.observation, undefined, 'Old verified receipts are presentation-only and must not enter the fresh maps');
  f.controller.inspect(hash(1));
  await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === 'pending');
  f.controller.inspect(hash(1));
  await until(() => f.receipts.calls.length === 3 && f.controller.getSnapshot().rows[0]?.observation?.status === 'pending');
});

test('failed same-scope refresh discards its displayed receipt instead of treating it as fresh', async () => {
  let fail = false;
  const f = fixture({ explorer: new FakeExplorer(({ feed }) => {
    if (fail) throw Error('Offline');
    return feed === 'txlist' ? [candidate(1)] : [];
  }) });
  await f.controller.refresh();
  f.controller.inspect(hash(1));
  await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === 'confirmed');
  fail = true;
  await f.controller.refresh();
  const state = f.controller.getSnapshot();
  assert.equal(state.status, 'ready');
  assert.equal(state.error, 'feed-unavailable');
  assert.equal(state.rows[0]?.observation, undefined);
  assert.equal(state.rows[0]?.indexedStatus, undefined);
});

test('fresh failed receipt replaces the refresh presentation without reviving a confirmed receipt', async () => {
  const page = deferred<readonly DiscoveredActivityCandidate[]>();
  let refreshing = false, heldEntered = false;
  const f = fixture({
    explorer: new FakeExplorer(({ feed }) => {
      if (feed !== 'txlist') return [];
      if (refreshing) { heldEntered = true; return page.promise; }
      return [candidate(1)];
    }),
    receipts: new FakeReceipts(call => {
      if (refreshing) throw Error('Receipt unavailable');
      return observation(call.hash, call.owner);
    }),
  });
  await f.controller.refresh();
  f.controller.inspect(hash(1));
  await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === 'confirmed');
  refreshing = true;
  const pending = f.controller.refresh();
  await until(() => heldEntered);
  f.controller.inspect(hash(1));
  await until(() => f.controller.getSnapshot().rows[0]?.unavailable === true);
  assert.equal(f.controller.getSnapshot().rows[0]?.observation, undefined);
  page.resolve([candidate(1, 0)]);
  await pending;
  assert.equal(f.controller.getSnapshot().rows[0]?.indexedStatus, 'pending');
  assert.equal(f.controller.getSnapshot().rows[0]?.observation, undefined);
});

test('scope changes and lock discard displayed refresh rows before delayed reads return', async () => {
  for (const change of ['account', 'network', 'lock'] as const) {
    const load = deferred<void>();
    const f = fixture({ explorer: new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1)] : []) });
    const disconnect = f.controller.connect();
    try {
      await until(() => !!f.controller.getSnapshot().rows[0]?.display);
      const original = f.runtime.load.bind(f.runtime);
      f.runtime.load = async (...args) => { await load.promise; return original(...args); };
      const pending = f.controller.refresh();
      assert.equal(f.controller.getSnapshot().rows.length, 1);
      if (change === 'lock') f.source.change({ phase: 'locked', account: null });
      else f.source.change({ account: { network: change === 'network' ? 'base' : 'ethereum', address: change === 'account' ? OTHER : OWNER } });
      assert.deepEqual(f.controller.getSnapshot().rows, [], change);
      load.resolve();
      await pending;
      if (change === 'lock') {
        assert.equal(f.controller.getSnapshot().status, 'locked');
        assert.deepEqual(f.controller.getSnapshot().rows, []);
      }
    } finally { load.resolve(); disconnect(); }
  }
});

test('ordinary pagination reaches older hashes without polling them, and lock retires a held page', async () => {
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
  await f.controller.loadMore();
  await f.controller.loadMore();
  assert.deepEqual(cursors, [undefined, recent.hash]);
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [recent.hash, older.hash]);
  assert.equal(f.controller.getSnapshot().hasMore, false);
  assert.equal(f.explorer.pages.length, explorerReads);
  assert.equal(f.receipts.calls.length, 0);
  assert.equal(f.localReads.length, 0);

  f.controller.inspect(older.hash);
  await until(() => !!f.controller.getSnapshot().rows.find((row) => row.hash === older.hash)?.retainedObservation);
  assert.deepEqual(f.receipts.calls, []);
  assert.deepEqual(f.localReads.map((row) => row.hash), [older.hash]);

  await f.controller.refresh();
  const late = f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().loadingMore, true);
  f.controller.invalidate();
  held.resolve({ records: [older], nextCursor: null });
  await late;
  assert.equal(f.controller.getSnapshot().rows.length, 0);
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
  assert.equal(f.controller.getSnapshot().rows[0]?.indexedStatus, 'confirmed');
  await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().rows[0]?.indexed, undefined);
  assert.deepEqual(methods, []);
  f.controller.inspect(older.hash);
  await until(() => f.controller.getSnapshot().rows[0]?.retainedObservation?.status === 'missing');
  assert.deepEqual(f.receipts.calls, []);
  assert.deepEqual(methods, ['eth_chainId', 'eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_chainId']);
  assert.deepEqual(f.controller.getSnapshot().rows[0]?.retainedObservation, { status: 'missing', latestNonce: '2' });
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
  await f.controller.loadMore();
  f.controller.inspect(older.hash);
  await until(() => reads === 1);
  await f.controller.refresh();
  await f.controller.loadMore();
  f.controller.inspect(older.hash);
  await until(() => reads === 2);
  old.resolve({ status: 'mined', outcome: 'confirmed', block: { number: '2', hash: hash(2) } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(f.controller.getSnapshot().rows[0]?.retainedObservation, { status: 'missing', latestNonce: '2' });
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

for (const operation of ['speed-up', 'cancel'] as const)
  test(`current included local ${operation} settles ordinary and saved-pending original rows without explorer history`, async () => {
    const base = fixture();
    const original = { ...base.local(1, 'submitted'), nonce: 7, transactionType: 2 };
    const replacement = { ...base.local(2, 'submitted'), nonce: 7, transactionType: 2, operation, originalHash: original.hash };
    const f = fixture({ locals: [original, replacement],
      loadSavedPending: async () => ({ records: [original, replacement], nextCursor: null }),
      observeLocal: async local => local.hash === replacement.hash
        ? { status: 'mined', outcome: 'confirmed', block: { number: '42', hash: hash(42) }, transactionIndex: 0 }
        : { status: 'missing', latestNonce: '8' } });
    await f.controller.refresh();
    await until(() => f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus === 'replaced');
    await f.controller.loadMore();
    assert.equal(f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus, 'replaced');
    assert.equal(f.controller.getSnapshot().rows.find(row => row.hash === replacement.hash)?.replacementStatus, undefined);
    assert.equal(f.receipts.calls.length, 0, 'projection does not add reads');
    assert.equal(original.phase, 'submitted', 'projection does not mutate retained journals');
  });

test('a saved-only original uses a verified winner in ordinary rows without copying indexed status', async () => {
  const base = fixture();
  const original = { ...base.local(1, 'submitted'), nonce: 7, transactionType: 2 };
  const replacement = { ...base.local(2, 'submitted'), nonce: 7, transactionType: 2, operation: 'speed-up' as const, originalHash: original.hash };
  const f = fixture({ locals: [replacement],
    loadSavedPending: async () => ({ records: [original], nextCursor: null }),
    observeLocal: async () => ({ status: 'mined', outcome: 'confirmed',
      block: { number: '42', hash: hash(42) }, transactionIndex: 0 }) });
  await f.controller.refresh();
  await until(() => f.controller.getSnapshot().rows[0]?.retainedObservation?.status === 'mined');
  await f.controller.loadMore();
  const saved = f.controller.getSnapshot().rows.find(row => row.hash === original.hash);
  assert.equal(saved?.hash, original.hash);
  assert.equal(saved?.indexed, undefined);
  assert.equal(saved?.replacementStatus, 'replaced');
  assert.equal(f.controller.getSnapshot().rows.some(row => row.hash === original.hash), true);
  assert.equal(f.receipts.calls.length, 0);
});

for (const phase of ['confirmed', 'reverted'] as const)
  for (const originalPhase of ['submitted', 'nonce-consumed'] as const)
    test(`cold loaded ${phase} winner is reobserved only for its ${originalPhase} sibling`, async () => {
      const base = fixture();
      const original = { ...base.local(1, originalPhase), nonce: 7, transactionType: 2 };
      const replacement = { ...base.local(2, phase), nonce: 7, transactionType: 2,
        operation: 'speed-up' as const, originalHash: original.hash };
      const unrelated = { ...base.local(3, 'confirmed'), transactionType: 2 };
      for (let reopen = 0; reopen < 2; reopen++) {
        const f = fixture({ locals: [original, replacement, unrelated],
          loadSavedPending: async () => ({ records: [original], nextCursor: null }),
          observeLocal: async local => {
            assert.notEqual(local.hash, unrelated.hash, 'completed singleton is not polled');
            return local.hash === replacement.hash
              ? { status: 'mined', outcome: phase, block: { number: '42', hash: hash(42) }, transactionIndex: 0 }
              : { status: 'missing', latestNonce: '8' };
          } });
        await f.controller.refresh();
        await until(() => f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus === 'replaced');
        assert.deepEqual(f.localReads.map(row => row.hash).sort(),
          (originalPhase === 'submitted' ? [original.hash, replacement.hash] : [replacement.hash]).sort());
        await f.controller.loadMore();
        assert.equal(f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus, 'replaced');
      }
    });

test('a late saved-only sibling queues its terminal winner under the same two-reader cap', async () => {
  const base = fixture(), gate = deferred<void>();
  const original = { ...base.local(1, 'submitted'), nonce: 7, transactionType: 2 };
  const winner = { ...base.local(2, 'confirmed'), nonce: 7, transactionType: 2 };
  const unrelatedPending = [base.local(3, 'submitted'), base.local(4, 'submitted')];
  let active = 0, maximum = 0;
  const f = fixture({ locals: [winner, ...unrelatedPending],
    loadSavedPending: async () => ({ records: [original], nextCursor: null }),
    observeLocal: async local => {
      active++; maximum = Math.max(maximum, active); await gate.promise; active--;
      return local.hash === winner.hash
        ? { status: 'mined', outcome: 'confirmed', block: { number: '42', hash: hash(42) }, transactionIndex: 0 }
        : { status: 'missing', latestNonce: String(local.nonce) };
    } });
  await f.controller.refresh();
  assert.equal(f.localReads.length, 2);
  await f.controller.loadMore();
  assert.equal(f.localReads.length, 2, 'late winner waits for the current readers');
  gate.resolve();
  await until(() => f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus === 'replaced');
  assert.equal(f.localReads.length, 3);
  assert.equal(maximum, 2);
  assert.equal(f.localReads.some(row => row.hash === original.hash), false, 'paging does not poll every saved row');
});

test('completed singleton history creates no fresh observer work', async () => {
  const base = fixture();
  const f = fixture({ locals: [{ ...base.local(1, 'confirmed'), transactionType: 2 },
    { ...base.local(2, 'reverted'), transactionType: 2 }] });
  await f.controller.refresh();
  assert.equal(f.localReads.length, 0);
});

test('failed automatic reads mark retained submissions unavailable after refresh and cold reopen', async () => {
  const local = { ...fixture().local(1, 'submitted'), transactionType: 2 as const };
  let offline = false;
  const f = fixture({ locals: [local], observeLocal: async () => {
    if (offline) throw Error('RPC unavailable');
    return { status: 'mined', outcome: 'confirmed', block: { number: '42', hash: hash(42) }, transactionIndex: 0 };
  } });
  await f.controller.refresh();
  await until(() => f.controller.getSnapshot().rows[0]?.retainedObservation?.status === 'mined');
  offline = true;
  await f.controller.refresh();
  await until(() => f.controller.getSnapshot().rows[0]?.unavailable === true);
  assert.equal(f.controller.getSnapshot().rows[0]?.retainedObservation, undefined, 'prior proof is not reused as fresh evidence');
  assert.equal(local.phase, 'submitted', 'read failure does not fabricate a durable confirmation or mutate the journal');
  f.controller.invalidate();
  const reopened = fixture({ locals: [local], observeLocal: async () => { throw Error('RPC unavailable'); } });
  await reopened.controller.refresh();
  await until(() => reopened.controller.getSnapshot().rows[0]?.unavailable === true);
  assert.equal(reopened.controller.getSnapshot().rows[0]?.local?.phase, 'submitted');
});

test('explicit detail failure marks a previously missing retained submission unavailable', async () => {
  const local = fixture().local(1, 'submitted');
  const f = fixture({ locals: [local], receipts: new FakeReceipts(() => { throw Error('RPC unavailable'); }) });
  await f.controller.refresh();
  await until(() => f.controller.getSnapshot().rows[0]?.retainedObservation?.status === 'missing');
  f.controller.inspect(local.hash);
  await until(() => f.controller.getSnapshot().rows[0]?.unavailable === true);
  assert.equal(f.controller.getSnapshot().rows[0]?.retainedObservation?.status, 'missing');
});

for (const status of ['confirmed', 'reverted'] as const) test(`failed automatic read does not obscure a concurrent fresh ${status} receipt`, async () => {
  const pending = Promise.withResolvers<EvmTransactionObservation>();
  const local = fixture().local(1, 'submitted');
  const f = fixture({ locals: [local], observeLocal: () => pending.promise,
    receipts: new FakeReceipts(call => observation(call.hash, call.owner, status)) });
  await f.controller.refresh();
  await until(() => f.localReads.length === 1);
  f.controller.inspect(local.hash);
  await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === status);
  pending.reject(Error('Late automatic RPC failure')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.getSnapshot().rows[0]?.unavailable, false);
  assert.equal(f.controller.getSnapshot().rows[0]?.observation?.status, status);
});

for (const status of ['confirmed', 'reverted'] as const) test(`successful ${status} receipt clears an earlier automatic failure`, async () => {
  const automatic = Promise.withResolvers<EvmTransactionObservation>();
  const detail = Promise.withResolvers<ActivityTransactionObservation>();
  const local = fixture().local(1, 'submitted');
  const f = fixture({ locals: [local], observeLocal: () => automatic.promise,
    receipts: new FakeReceipts(() => detail.promise) });
  await f.controller.refresh();
  await until(() => f.localReads.length === 1);
  f.controller.inspect(local.hash);
  await until(() => f.receipts.calls.length === 1);
  automatic.reject(Error('Automatic RPC failure'));
  await until(() => f.controller.getSnapshot().rows[0]?.unavailable === true);
  detail.resolve(observation(local.hash, OWNER, status));
  await until(() => f.controller.getSnapshot().rows[0]?.observation?.status === status);
  assert.equal(f.controller.getSnapshot().rows[0]?.unavailable, false);
});

for (const outcome of ['confirmed', 'reverted', 'missing'] as const) test(`successful retained ${outcome} clears an earlier detail failure`, async () => {
  const automatic = Promise.withResolvers<EvmTransactionObservation>();
  const local = fixture().local(1, 'submitted');
  const f = fixture({ locals: [local], observeLocal: () => automatic.promise,
    receipts: new FakeReceipts(() => { throw Error('Detail RPC failure'); }) });
  await f.controller.refresh();
  await until(() => f.localReads.length === 1);
  f.controller.inspect(local.hash);
  await until(() => f.controller.getSnapshot().rows[0]?.unavailable === true);
  automatic.resolve(outcome === 'missing' ? { status: 'missing', latestNonce: '1' }
    : { status: 'mined', outcome, block: { number: '42', hash: hash(42) }, transactionIndex: 0 });
  await until(() => f.controller.getSnapshot().rows[0]?.retainedObservation !== undefined);
  assert.equal(f.controller.getSnapshot().rows[0]?.unavailable, false);
});

test('successful Smart detail observation clears an earlier automatic failure', async () => {
  const automatic = Promise.withResolvers<EvmTransactionObservation>();
  const detail = Promise.withResolvers<EvmTransactionObservation>();
  const local = { ...fixture().local(1, 'submitted'), smartAccount: {
    payer: OWNER, operations: [{ operationHash: hash(9), operationNonce: '0' }],
  } };
  let reads = 0;
  const f = fixture({ locals: [local], observeLocal: () => ++reads === 1 ? automatic.promise : detail.promise });
  await f.controller.refresh();
  await until(() => reads === 1);
  f.controller.inspect(local.hash);
  await until(() => reads === 2);
  automatic.reject(Error('Automatic RPC failure'));
  await until(() => f.controller.getSnapshot().rows[0]?.unavailable === true);
  detail.resolve({ status: 'missing', latestNonce: '1' });
  await until(() => f.controller.getSnapshot().rows[0]?.retainedObservation?.status === 'missing');
  assert.equal(f.controller.getSnapshot().rows[0]?.unavailable, false);
  assert.equal(f.receipts.calls.length, 0);
});

for (const boundary of ['refresh', 'lock'] as const) test(`retired automatic failure cannot mark the next ${boundary} scope unavailable`, async () => {
  const old = Promise.withResolvers<EvmTransactionObservation>();
  const local = fixture().local(1, 'submitted');
  let reads = 0;
  const f = fixture({ locals: [local], observeLocal: () => ++reads === 1 ? old.promise
    : Promise.resolve({ status: 'mined', outcome: 'confirmed', block: { number: '42', hash: hash(42) }, transactionIndex: 0 }) });
  const disconnect = f.controller.connect();
  try {
    await until(() => reads === 1);
    if (boundary === 'lock') {
      f.source.change({ phase: 'locked', account: null });
      old.reject(Error('Retired RPC failure')); await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.controller.getSnapshot().status, 'locked');
      assert.deepEqual(f.controller.getSnapshot().rows, []);
      f.source.change({ phase: 'ready', account: { network: 'ethereum', address: OWNER } });
    } else {
      await f.controller.refresh();
      old.reject(Error('Retired RPC failure'));
    }
    await until(() => f.controller.getSnapshot().rows[0]?.retainedObservation?.status === 'mined');
    assert.equal(f.controller.getSnapshot().rows[0]?.unavailable, false);
  } finally { disconnect(); }
});

test('a needed terminal sibling remains observable after only explorer work times out', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const base = fixture();
  const original = { ...base.local(1, 'submitted'), nonce: 7, transactionType: 2 };
  const winner = { ...base.local(2, 'confirmed'), nonce: 7, transactionType: 2 };
  const { explorer, signals } = boundedStalledExplorer();
  const f = fixture({ locals: [winner], explorer,
    loadSavedPending: async () => ({ records: [original], nextCursor: null }),
    observeLocal: async () => ({ status: 'mined', outcome: 'confirmed',
      block: { number: '42', hash: hash(42) }, transactionIndex: 0 }) });
  const refresh = f.controller.refresh();
  for (let turn = 0; turn < 20 && !explorer.pages.length; turn++) await Promise.resolve();
  await expireExplorerResponses(t); await refresh; t.mock.timers.reset();
  assert.equal(signals.length, 2); assert(signals.every(signal => signal.aborted));
  assert.equal(f.localReads.length, 0);
  await f.controller.loadMore();
  await until(() => f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus === 'replaced');
  assert.deepEqual(f.localReads.map(row => row.hash), [winner.hash]);
});

test('refresh and fresh missing winner reads retire prior replacement proof in ordinary and saved rows', async () => {
  const base = fixture();
  const original = { ...base.local(1, 'submitted'), nonce: 7, transactionType: 2 };
  const replacement = { ...base.local(2, 'submitted'), nonce: 7, transactionType: 2, operation: 'speed-up' as const, originalHash: original.hash };
  let included = true;
  const f = fixture({ locals: [original, replacement], receipts: new FakeReceipts(() => null),
    loadSavedPending: async () => ({ records: [original, replacement], nextCursor: null }),
    observeLocal: async local => included && local.hash === replacement.hash
      ? { status: 'mined', outcome: 'confirmed', block: { number: '42', hash: hash(42) }, transactionIndex: 0 }
      : { status: 'missing', latestNonce: '7' } });
  await f.controller.refresh();
  await until(() => f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus === 'replaced');
  await f.controller.loadMore();
  f.controller.inspect(replacement.hash);
  await until(() => f.controller.getSnapshot().rows.find(row => row.hash === replacement.hash)?.unavailable === true);
  assert.equal(f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus, undefined);
  assert.equal(f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus, undefined);
  // Restore the proof, then hold the next load to inspect the refresh boundary.
  await f.controller.refresh();
  await until(() => f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus === 'replaced');
  included = false;
  const gate = deferred<void>();
  const load = f.runtime.load.bind(f.runtime);
  f.runtime.load = async (...args) => { await gate.promise; return load(...args); };
  const refresh = f.controller.refresh();
  assert.equal(f.controller.getSnapshot().status, 'loading');
  assert.equal(f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus, undefined);
  gate.resolve(); await refresh;
  await until(() => f.localReads.length >= 6);
  assert.equal(f.controller.getSnapshot().rows.find(row => row.hash === original.hash)?.replacementStatus, undefined);
  assert.equal(f.receipts.calls.length, 1);
});

test('optional pending reads leave history usable, deduplicate mined and local rows and never persist pending rows', async () => {
  const network = 'syscoin-nevm';
  const seed = fixture({ network });
  const f = fixture({ network, local: seed.local(3) });
  const readyToSave = deferred<void>(), releaseCache = deferred<void>();
  const saveCache = f.runtime.saveCache.bind(f.runtime);
  f.runtime.saveCache = async (...args) => {
    readyToSave.resolve();
    await releaseCache.promise;
    return saveCache(...args);
  };
  const held = deferred<Response>();
  const calls: string[] = [];
  const raw = (index: number) => ({ hash: hash(index), from: OWNER, to: OTHER, nonce: '1', value: '1', input: '0x' });
  let pendingReply = held.promise;
  const reader = new ActivityExplorerReader(async (url, init) => {
    assert.equal(init.body, undefined);
    const target = new URL(url), action = target.searchParams.get('action')!;
    calls.push(action);
    assert.equal(target.origin, 'https://explorer.syscoin.org');
    assert.equal(target.searchParams.get('address'), OWNER);
    if (action === 'pendingtxlist') {
      assert.equal(target.searchParams.get('page'), '1');
      assert.equal(target.searchParams.get('offset'), '20');
      return pendingReply;
    }
    return Response.json({ status: '1', result: action === 'txlist'
      ? [{ ...raw(1), blockNumber: '100', confirmations: '1', txreceipt_status: '1' }] : [] });
  });
  const activity = new NativeActivity(f.source, () => f.runtime, reader, f.receipts);
  const refresh = activity.refresh();
  await readyToSave.promise;
  assert.deepEqual(calls.sort(), ['tokentx', 'txlist']);
  releaseCache.resolve();
  await refresh;
  assert.equal(activity.getSnapshot().status, 'ready');
  assert.deepEqual(activity.getSnapshot().rows.map(row => row.hash).sort(), [hash(1), hash(3)]);
  held.resolve(Response.json({ status: '1', result: [raw(1), raw(2), raw(3)] }));
  await until(() => activity.getSnapshot().rows.some(row => row.hash === hash(2)));
  const snapshot = activity.getSnapshot();
  assert.deepEqual(snapshot.rows.map(row => row.hash).sort(), [hash(1), hash(2), hash(3)]);
  assert.equal(snapshot.rows.find(row => row.hash === hash(1))?.indexedStatus, 'confirmed');
  assert.equal(snapshot.rows.find(row => row.hash === hash(3))?.local?.phase, 'confirmed');
  const pending = snapshot.rows.find(row => row.hash === hash(2))!;
  assert.equal(pending.indexedStatus, 'pending', 'an explorer nonce is not replacement evidence');
  assert.equal(pending.indexed?.historySource, 'explorer-pendingtxlist');
  assert.equal(pending.indexed?.blockNumber, undefined);
  assert.equal(pending.indexed?.timestamp, 0);
  assert.equal(pending.local, undefined);
  assert.equal(pending.candidate, undefined);
  assert.equal(pending.display?.actualRecipient, OTHER);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.hasMore, false);
  assert.equal(f.receipts.calls.length, 0);
  assert.deepEqual(calls.sort(), ['pendingtxlist', 'tokentx', 'txlist']);
  assert.deepEqual(f.cacheWrites.at(-1)?.rows.map(row => row.hash), [hash(1)]);

  pendingReply = Promise.resolve(Response.json({ status: '0', message: 'NOTOK', result: 'Unsupported action' }));
  const reopened = new NativeActivity(f.source, () => f.runtime, reader, f.receipts);
  await reopened.refresh();
  assert.deepEqual(reopened.getSnapshot().rows.map(row => row.hash).sort(), [hash(1), hash(3)]);
  assert.equal(reopened.getSnapshot().error, null);
  assert.equal(calls.filter(action => action === 'pendingtxlist').length, 2);

  const retired = deferred<Response>();
  pendingReply = retired.promise;
  await reopened.refresh();
  reopened.invalidate();
  const invalidated = reopened.getSnapshot();
  retired.resolve(Response.json({ status: '1', result: [raw(2)] }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reopened.getSnapshot(), invalidated);
});

test('a healthy feed remains visible when the other feed fails, with explicit partial coverage', async () => {
  const explorer = new FakeExplorer(({ feed }) => { if (feed === 'txlist') throw Error('offline'); return [candidate(1, 100, true)]; });
  const f = fixture({ explorer });
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().status, 'ready');
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [hash(1)]);
  assert.equal(f.controller.getSnapshot().error, 'feed-unavailable');
  assert.equal(f.controller.getSnapshot().coverage, 'explorer-transfers');
});

test('both failed feeds preserve cached and locally submitted history instead of saving an empty list', async () => {
  const base = fixture();
  const explorer = new FakeExplorer(() => { throw Error('offline'); });
  const f = fixture({ explorer, cached: [candidate(9)], archived: [base.local(1) as TerminalActivityRecord] });
  await f.controller.refresh();
  assert.deepEqual(new Set(f.controller.getSnapshot().rows.map((row) => row.hash)), new Set([hash(1), hash(9)]));
  assert.equal(f.controller.getSnapshot().error, 'feed-unavailable');
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
  assert.equal(f.controller.getSnapshot().error, 'feed-unavailable');
  assert(f.controller.getSnapshot().rows.every(row => row.indexed === undefined && row.display === undefined));
  assert.equal(f.receipts.calls.length, 0);
});

test('cached fallback survives a timed-out page without implicit RPC hydration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const receipts = new FakeReceipts();
  let timedOut = false;
  const stalled = boundedStalledExplorer();
  const explorer = new FakeExplorer(call => timedOut
    ? call.feed === 'txlist' ? [candidate(9), candidate(10)] : []
    : stalled.explorer.page(call.scope, call.feed, call.page, call.signal, call.guard));
  const f = fixture({ explorer, receipts, cached: [candidate(9)] });
  const refreshing = f.controller.refresh();
  for (let turn = 0; turn < 20 && explorer.pages.length === 0; turn++) await Promise.resolve();
  assert.equal(explorer.pages.length, 1);
  await expireExplorerResponses(t);
  await refreshing;
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [hash(9)]);
  assert.deepEqual(f.cacheWrites.at(-1)?.rows.map(row => row.hash), [hash(9)]);
  assert.equal(f.controller.getSnapshot().error, 'feed-unavailable');
  assert.equal(stalled.signals.length, 2); assert(stalled.signals.every(signal => signal.aborted));
  timedOut = true;
  await f.controller.loadMore();
  assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash).sort(), [hash(9), hash(10)].sort());
  assert.equal(f.controller.getSnapshot().error, null);
});

test('Saved pending still pages and inspects after explorer timeout, then retires on lock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const fixtureRecords = fixture();
  const first = fixtureRecords.local(2, 'submitted'), older = fixtureRecords.local(1, 'attempted');
  const { explorer, signals } = boundedStalledExplorer();
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
    await expireExplorerResponses(t);
    for (let turn = 0; turn < 20 && !f.controller.getSnapshot().error; turn++) await Promise.resolve();
    assert.equal(f.controller.getSnapshot().error, 'feed-unavailable');
    assert.equal(signals.length, 2); assert(signals.every(signal => signal.aborted));
    t.mock.timers.reset();

    await f.controller.loadMore();
    await f.controller.loadMore();
    assert.deepEqual(cursors, [undefined, first.hash]);
    assert.deepEqual(f.controller.getSnapshot().rows.map((row) => row.hash), [first.hash, older.hash]);
    assert.equal(f.localReads.length, 0);
    assert.equal(f.receipts.calls.length, 0);

    f.controller.inspect(older.hash);
    await until(() => f.controller.getSnapshot().rows[1]?.retainedObservation?.status === 'missing');
    assert.equal(detailSignal?.aborted, false);
    assert.notEqual(detailSignal, explorer.pages[0]?.signal);
    assert.equal(explorer.pages.length, 2);
    assert.equal(f.receipts.calls.length, 0);

    f.controller.inspect(older.hash);
    await until(() => f.localReads.length === 2);
    f.source.change({ phase: 'locked', account: null });
    assert.equal(detailSignal?.aborted, true);
    assert.equal(f.controller.getSnapshot().rows.length, 0);
    held.resolve({ status: 'missing', latestNonce: '9' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.controller.getSnapshot().rows.length, 0);
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
    ? Array.from({ length: 20 }, (_, index) => candidate(1, 100, true, { logIndex: String(page * 20 + index) })) : [candidate(2, 99, true)]);
  const f = fixture({ explorer });
  await f.controller.refresh();
  assert.deepEqual(new Set(f.controller.getSnapshot().rows.map((row) => row.hash)), new Set([hash(1), hash(2)]));
  assert(explorer.pages.length <= 6);
});

test('event-heavy token history can continue across more than ten bounded load actions', async () => {
  const explorer = new FakeExplorer(({ feed, page }) => feed === 'txlist' ? [] : page <= 80
    ? Array.from({ length: 20 }, (_, index) => candidate(Math.ceil(page / 20), 1000 - Math.ceil(page / 20), true, { logIndex: String(page * 20 + index) })) : []);
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
  assert.equal(f.controller.getSnapshot().error, 'feed-unavailable');
  await f.controller.loadMore();
  assert.deepEqual(explorer.pages.filter(call => call.feed === 'txlist').map(call => call.page), [1, 2, 2]);
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

test('Smart Activity inspects through the inner-operation observer and ignores outer indexed status', async () => {
  const base = fixture();
  const local: LocalActivityRecord = { ...base.local(1), smartAccount: { payer: OTHER, operations: [{ operationHash: hash(9), operationNonce: '0' }] }, inspectionOnly: true };
  const f = fixture({ local, explorer: new FakeExplorer(({ feed }) => feed === 'txlist' ? [candidate(1)] : []),
    async observeLocal() { return { status: 'mined', outcome: 'reverted', block: { hash: hash(999), number: '1000' } }; } });
  await f.controller.refresh();
  assert.equal(f.localReads.length, 0, 'archived terminal rows do not poll receipts on open');
  f.controller.inspect(local.hash);
  await until(() => f.controller.getSnapshot().rows.some(row => row.retainedObservation?.status === 'mined'));
  const row = f.controller.getSnapshot().rows.find(row => row.hash === local.hash)!;
  assert.equal(row.retainedObservation?.status === 'mined' && row.retainedObservation.outcome, 'reverted');
  assert.equal(row.indexed, undefined);
  assert.equal(row.display, undefined);
  assert.equal(row.local?.amountUnits, '1');
  assert.equal(f.receipts.calls.length, 0);
  assert.equal(f.localReads.length, 1);
});

test('overlapping automatic and explicit local Activity reads share one receipt graph', async () => {
  const base = fixture(), local = base.local(1, 'submitted');
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const methods: string[] = [];
  const blockHash = hash(555);
  const receipts = new ActivityReceiptReader({ fetch: async (_url, init) => {
    const request = JSON.parse(String(init.body)); methods.push(request.method);
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getTransactionReceipt') {
      started.resolve(); await held.promise;
      result = { transactionHash: local.hash, from: OWNER, to: OTHER, status: '0x0', blockNumber: '0x50', blockHash, transactionIndex: '0x0', logs: [] };
    } else if (request.method === 'eth_getTransactionByHash') result = { hash: local.hash, from: OWNER, to: OTHER, value: '0x1', nonce: '0x1', blockHash, blockNumber: '0x50', transactionIndex: '0x0' };
    else if (request.method === 'eth_getBlockByNumber') result = { number: '0x50', hash: blockHash, timestamp: '0x6553f100', gasLimit: '0x1c9c380' };
    else throw Error(request.method);
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  } });
  const state = source(), scope = createActivityScope(FP, 'hd:60:0', OWNER, 'ethereum');
  let persisted = 0;
  const runtime: NativeActivityRuntime = {
    async load() { return { scope, locals: [local], saved: { archived: [], candidates: [], view: DEFAULT_ACTIVITY_VIEW, truncated: false } }; },
    async observeLocal(record, check, signal, observe) {
      assert(observe); const result = await observe({ chainId: '1', from: OWNER, to: OTHER, hash: record.hash, nonce: String(record.nonce) });
      check(); if (signal.aborted) throw Error('CANCELLED'); persisted++; return result;
    },
    async saveCache() {}, async saveView() {},
  };
  const model = new NativeActivity(state, () => runtime, new FakeExplorer(), receipts);
  try {
    await model.refresh(); await started.promise; model.inspect(local.hash);
    await until(() => methods.includes('eth_getTransactionByHash'));
    held.resolve();
    await until(() => !!model.getSnapshot().rows[0]?.observation);
    assert.equal(model.getSnapshot().rows[0]?.retainedObservation?.status, 'mined');
    assert.equal(model.getSnapshot().rows[0]?.observation?.status, 'reverted');
    assert.equal(persisted, 1);
    assert.equal(methods.length, 5); assert.equal(methods.filter(method => method === 'eth_getTransactionReceipt').length, 1);
  } finally { held.resolve(); model.connect()(); }
});

for (const mode of ['mined', 'missing', 'reorg', 'wrong hash', 'scalar', 'wrong chain', 'cancelled'] as const)
  test(`paired retained Activity reads share verified RPC work (${mode})`, async () => {
    const base = fixture(), locals = [base.local(1, 'submitted'), base.local(2, 'submitted')];
    const scope = createActivityScope(FP, 'hd:60:0', OWNER, 'ethereum');
    const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
    const batches: string[][] = [];
    let receiptSignal: AbortSignal | null | undefined;
    const blockHash = hash(555);
    const receipts = new ActivityReceiptReader({ fetch: async (_url, init) => {
      const input = JSON.parse(String(init.body));
      const requests = Array.isArray(input) ? input : [input];
      batches.push(requests.map(request => request.method));
      if (mode === 'scalar' && Array.isArray(input))
        return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch unsupported' } });
      if (mode === 'cancelled' && requests.some(request => request.method === 'eth_getTransactionReceipt')) {
        receiptSignal = init.signal;
        started.resolve();
        await held.promise;
      }
      const rows = requests.map(request => {
        let result: unknown;
        switch (request.method) {
          case 'eth_chainId': result = mode === 'wrong chain' ? '0x2' : '0x1'; break;
          case 'eth_getTransactionCount': result = '0x0'; break;
          case 'eth_getBlockByNumber':
            result = { number: '0x50', hash: blockHash, gasLimit: '0x1c9c380' };
            break;
          case 'eth_getTransactionReceipt':
            result = mode === 'missing' ? null : {
              transactionHash: mode === 'wrong hash' && request.params[0] === locals[1]!.hash
                ? locals[0]!.hash : request.params[0],
              from: OWNER, to: OTHER, status: '0x1', blockNumber: '0x50',
              blockHash: mode === 'reorg' && request.params[0] === locals[1]!.hash ? hash(777) : blockHash,
            };
            break;
          default: assert.fail(request.method);
        }
        return { jsonrpc: '2.0', id: request.id, result };
      });
      return Response.json(Array.isArray(input) ? rows.reverse() : rows[0]);
    } });
    const runtime: NativeActivityRuntime = {
      async load() { return { scope, locals, saved: { archived: [], candidates: [], view: DEFAULT_ACTIVITY_VIEW, truncated: false } }; },
      async observeLocal(record, check, _signal, observe) {
        check(); assert(observe);
        return observe({ chainId: '1', from: OWNER, to: OTHER, hash: record.hash, nonce: String(record.nonce) });
      },
      async saveCache() {}, async saveView() {},
    };
    const model = new NativeActivity(source(), () => runtime, new FakeExplorer(), receipts);
    try {
      await model.refresh();
      if (mode === 'cancelled') {
        await started.promise; model.invalidate(); held.resolve();
        assert.equal(receiptSignal?.aborted, true);
        assert.equal(model.getSnapshot().rows.length, 0);
        assert.deepEqual(batches, [['eth_chainId'], ['eth_getTransactionReceipt', 'eth_getTransactionReceipt']]);
        return;
      }
      await until(() => model.getSnapshot().rows.length === 2 &&
        model.getSnapshot().rows.every(row => row.retainedObservation || row.unavailable));
      const rows = model.getSnapshot().rows;
      if (mode === 'wrong chain') {
        assert(rows.every(row => row.unavailable));
        assert.deepEqual(batches, [['eth_chainId']]);
        return;
      }
      assert.equal(rows.find(row => row.hash === locals[0]!.hash)?.retainedObservation?.status, mode === 'missing' ? 'missing' : 'mined');
      const sibling = rows.find(row => row.hash === locals[1]!.hash);
      if (mode === 'reorg' || mode === 'wrong hash') assert.equal(sibling?.unavailable, true);
      else assert.equal(sibling?.retainedObservation?.status, mode === 'missing' ? 'missing' : 'mined');
      const expected = [
        ['eth_chainId'], ['eth_getTransactionReceipt', 'eth_getTransactionReceipt'],
        [mode === 'missing' ? 'eth_getTransactionCount' : 'eth_getBlockByNumber'], ['eth_chainId'],
      ];
      if (mode === 'scalar') expected.splice(2, 0, ['eth_getTransactionReceipt'], ['eth_getTransactionReceipt']);
      assert.deepEqual(batches, expected);
      if (mode === 'mined' || mode === 'scalar') {
        await model.refresh();
        await until(() => model.getSnapshot().rows.every(row => row.retainedObservation?.status === 'mined'));
        const second = mode === 'scalar' ? expected.filter(group => group.length === 1) : expected;
        assert.deepEqual(batches, [...expected, ...second]);
      }
    } finally { held.resolve(); model.invalidate(); }
  });

test('a successful full Activity preference write clears only its recovered save warning', async () => {
  const f = fixture();
  await f.controller.refresh();
  let fail = true, saved = DEFAULT_ACTIVITY_VIEW;
  f.runtime.saveView = async (_scope, view, check) => { check(); if (fail) { fail = false; throw Error('Temporary public preference failure'); } saved = view; };
  await f.controller.setView({ filter: 'sent', anchor: hash(8), offset: 12 });
  assert.equal(f.controller.getSnapshot().error, 'position-not-saved');
  await f.controller.setView({ filter: 'received' });
  assert.deepEqual(saved, { ...DEFAULT_ACTIVITY_VIEW, filter: 'received', anchor: hash(8), offset: 12 });
  assert.equal(f.controller.getSnapshot().error, null);
});

for (const error of ['feed-unavailable', 'older-unavailable'] as const) test(`Activity save recovery restores its independent ${error} warning`, async () => {
  const f = fixture({ explorer: error === 'feed-unavailable' ? new FakeExplorer(() => { throw Error('Public feed unavailable'); }) : undefined });
  await f.controller.refresh();
  if (error === 'older-unavailable') { f.runtime.saveCache = async () => { throw Error('Older cache unavailable'); }; await f.controller.loadMore(); }
  assert.equal(f.controller.getSnapshot().error, error);
  let fail = true;
  f.runtime.saveView = async (_scope, _view, check) => { check(); if (fail) { fail = false; throw Error('Temporary preference failure'); } };
  await f.controller.setView({ filter: 'sent' });
  assert.equal(f.controller.getSnapshot().error, 'position-not-saved');
  await f.controller.setView({ filter: 'received' });
  assert.equal(f.controller.getSnapshot().error, error);
});

test('a healthy Activity preference write preserves an independent feed warning', async () => {
  const f = fixture({ explorer: new FakeExplorer(() => { throw Error('Public feed unavailable'); }) });
  await f.controller.refresh();
  await f.controller.setView({ filter: 'received' });
  assert.equal(f.controller.getSnapshot().error, 'feed-unavailable');
});

for (const olderFails of [false, true]) test(`only the newest Activity full-view write owns save feedback (older failure ${olderFails})`, async () => {
  const f = fixture(), held = deferred<void>();
  await f.controller.refresh();
  let writes = 0;
  f.runtime.saveView = async (_scope, _view, check) => { check(); if (++writes === 1) { await held.promise; if (olderFails) throw Error('Old preference failure'); } else if (!olderFails) throw Error('New preference failure'); };
  const older = f.controller.setView({ filter: 'sent' });
  await f.controller.setView({ filter: 'received' });
  held.resolve(); await older;
  assert.equal(f.controller.getSnapshot().view.filter, 'received');
  assert.equal(f.controller.getSnapshot().error, olderFails ? null : 'position-not-saved');
});

test('a late Activity preference acknowledgement cannot retire a new account save warning', async () => {
  const f = fixture(), held = deferred<void>();
  const disconnect = f.controller.connect();
  try {
    await until(() => f.controller.getSnapshot().status === 'ready');
    f.runtime.saveView = async (scope, _view, check) => { check(); if (scope.address === OWNER) await held.promise; else throw Error('New account preference failure'); };
    const old = f.controller.setView({ filter: 'sent' });
    f.source.change({ account: { network: 'ethereum', address: OTHER } });
    await until(() => f.controller.getSnapshot().status === 'ready' && f.controller.getSnapshot().accountAddress === OTHER);
    await f.controller.setView({ filter: 'received' });
    const current = f.controller.getSnapshot();
    held.resolve(); await old;
    assert.equal(f.controller.getSnapshot(), current);
    assert.equal(current.error, 'position-not-saved');
  } finally { held.resolve(); disconnect(); }
});

test('Activity preference success preserves an older-page warning arriving during that write', async () => {
  const f = fixture(), held = deferred<void>();
  await f.controller.refresh();
  f.runtime.saveView = async (_scope, _view, check) => { check(); await held.promise; };
  const writing = f.controller.setView({ filter: 'received' });
  f.runtime.saveCache = async () => { throw Error('Older page save unavailable'); };
  await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().error, 'older-unavailable');
  held.resolve(); await writing;
  assert.equal(f.controller.getSnapshot().error, 'older-unavailable');
});

test('Activity save recovery does not restore a feed warning whose own retry already recovered', async () => {
  let feedFails = true;
  const f = fixture({ explorer: new FakeExplorer(() => { if (feedFails) throw Error('Public feed unavailable'); return []; }) });
  await f.controller.refresh();
  f.runtime.saveView = async () => { throw Error('Temporary preference failure'); };
  await f.controller.setView({ filter: 'sent' });
  assert.equal(f.controller.getSnapshot().error, 'position-not-saved');
  feedFails = false;
  await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().error, 'position-not-saved');
  f.runtime.saveView = async (_scope, _view, check) => { check(); };
  await f.controller.setView({ filter: 'received' });
  assert.equal(f.controller.getSnapshot().error, null);
});

const smartInstruction = (index: number) => ({
  account: OWNER, chainId: '1', createdAt: 1700000000000 + index,
  operationHash: hash(index), operationNonce: (2n ** 190n + BigInt(index)).toString(),
  payer: OTHER, observedAt: { hash: hash(90), number: '90' },
});

test('Activity shows an original instruction without an outer once, even with a signed revocation', async () => {
  const first = smartInstruction(41), second = smartInstruction(42), olderOuter = smartInstruction(43);
  const revocation = { ...smartInstruction(44), replacesOperationHash: second.operationHash };
  const outer = { ...fixture().local(50), smartAccount: {
    payer: OTHER, operations: [{ operationHash: first.operationHash, operationNonce: first.operationNonce }],
  } };
  const cursors: string[] = [];
  const f = fixture({
    locals: [outer], smartAuthorizations: { entries: [first], nextCursor: first.operationHash },
    async loadSmartAuthorizations(_scope, cursor) {
      cursors.push(cursor);
      return { entries: [first, second, olderOuter, revocation], nextCursor: null,
        withOuterOperationHashes: [first.operationHash, olderOuter.operationHash] };
    },
    async loadTarget(_scope, target) {
      return target === second.operationHash ? { authorization: second } : null;
    },
  });
  await f.controller.refresh();
  assert.deepEqual(f.controller.getSnapshot().rows.map(row => row.hash), [outer.hash]);
  assert.equal(f.controller.getSnapshot().rows[0]!.smartAuthorizations?.[0]?.instruction.operationNonce, first.operationNonce);
  await f.controller.loadMore();
  assert.deepEqual(cursors, [first.operationHash]);
  const rows = f.controller.getSnapshot().rows;
  const operationKey = `operation:${second.operationHash}`;
  assert.deepEqual(rows.map(activityRowKey), [operationKey, outer.hash]);
  assert.equal(findActivityRow(rows, outer.hash)?.smartAuthorizations?.length, 1);
  assert.equal(findActivityRow(rows, operationKey)?.smartAuthorizations?.[0]?.instruction, second);
  await f.controller.loadTarget(second.operationHash);
  assert.deepEqual(f.controller.getSnapshot().rows.map(activityRowKey), [operationKey, outer.hash]);
  f.controller.inspect(second.operationHash);
  f.controller.inspect(operationKey);
  assert.equal(f.receipts.calls.length, 0, 'An operation hash is never queried as a transaction hash');
});

test('an observed transaction replaces its operation-only row and keeps the operation target reachable', async () => {
  const instruction = smartInstruction(42), outer = candidate(50);
  const f = fixture({
    explorer: new FakeExplorer(call => call.feed === 'txlist' ? [outer] : []),
    smartAuthorizations: { entries: [instruction], nextCursor: null },
    async observeSmartAuthorization(_scope, operationHash, guard) {
      guard();
      return { kind: 'observed', operationHash, currentNonce: (BigInt(instruction.operationNonce) + 1n).toString(),
        anchor: instruction.observedAt, block: instruction.observedAt, success: true, transactionHash: outer.hash };
    },
  });
  await f.controller.refresh();
  const target = `operation:${instruction.operationHash}`;
  assert.equal(findActivityRow(f.controller.getSnapshot().rows, target)?.authorizationOnly, true);
  await f.controller.inspectSmartAuthorization(instruction.operationHash, () => {}, new AbortController().signal);
  const { rows } = f.controller.getSnapshot();
  assert.deepEqual(rows.map(activityRowKey), [outer.hash]);
  assert.equal(findActivityRow(rows, target), rows[0]);
});

test('the authorization-only cursor is browseable and needs no explorer or cache work to reach the last page', async () => {
  const newest = Array.from({ length: 20 }, (_, i) => smartInstruction(100 + i));
  const older = smartInstruction(21), cursor = newest.at(-1)!.operationHash;
  const outer = { ...fixture().local(50), smartAccount: { payer: OTHER, operations: [older] } };
  const reads: string[] = [];
  let fail = true;
  const f = fixture({
    locals: [outer], smartAuthorizations: { entries: newest, nextCursor: cursor },
    async loadSmartAuthorizations(_scope, before, guard) {
      guard(); reads.push(before);
      if (fail) { fail = false; throw Error('Offline'); }
      return { entries: [older], nextCursor: null };
    },
  });
  await f.controller.refresh();
  const initial = f.controller.getSnapshot();
  assert.equal(initial.hasMore, true);
  assert.equal(findActivityRow(initial.rows, outer.hash)?.mayHaveOlderAuthorization, true);
  const explorerReads = f.explorer.pages.length, cacheWrites = f.cacheWrites.length;
  await f.controller.loadMore();
  assert.equal(f.controller.getSnapshot().error, 'older-unavailable');
  assert.equal(f.controller.getSnapshot().hasMore, true);
  await f.controller.loadMore();
  const last = f.controller.getSnapshot();
  assert.deepEqual(reads, [cursor, cursor]);
  assert.equal(last.error, null);
  assert.equal(last.hasMore, false);
  assert.equal(last.rows.length, newest.length + 1);
  assert.equal(findActivityRow(last.rows, outer.hash)?.smartAuthorizations?.[0]?.instruction.operationHash, older.operationHash);
  assert.equal(f.explorer.pages.length, explorerReads);
  assert.equal(f.cacheWrites.length, cacheWrites);
});

for (const hasRecord of [true, false]) test(`opening an older outer checks its exact operation without enumerating pages (record=${hasRecord})`, async () => {
  const older = smartInstruction(21);
  const outer = { ...fixture().local(50), smartAccount: { payer: OTHER, operations: [older] } };
  const replacement = { ...outer, hash: hash(51), createdAt: outer.createdAt + 1 };
  const exact: string[] = [], observations: string[] = [];
  const f = fixture({
    locals: [outer, replacement], smartAuthorizations: { entries: [], nextCursor: hash(30) },
    async loadSmartAuthorizations() { assert.fail('Opening details must not enumerate pages'); },
    async loadTarget(_scope, target, check) { check(); exact.push(target); return hasRecord ? { authorization: older } : null; },
    async observeSmartAuthorization(_scope, target, check) {
      check(); observations.push(target);
      return { kind: 'nonce-consumed', currentNonce: (BigInt(older.operationNonce) + 1n).toString(), operationHash: target, anchor: older.observedAt };
    },
  });
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().rows[0]!.mayHaveOlderAuthorization, true);
  await f.controller.inspectSmartAuthorization(older.operationHash, () => {}, new AbortController().signal);
  assert.deepEqual(exact, [older.operationHash]);
  assert.deepEqual(observations, hasRecord ? [older.operationHash] : []);
  for (const row of f.controller.getSnapshot().rows) {
    assert.equal(row.mayHaveOlderAuthorization, undefined);
    assert.equal(row.smartAuthorizations?.[0]?.observation?.kind, hasRecord ? 'nonce-consumed' : undefined);
  }
});

test('Activity discards a Smart authorization status when the details are retired, then accepts fresh operation proof', async () => {
  const instruction = smartInstruction(43);
  const outer = { ...fixture().local(50), smartAccount: { payer: OTHER, operations: [instruction] } };
  const delayed = deferred<Awaited<ReturnType<NonNullable<NativeActivityRuntime['observeSmartAuthorization']>>>>();
  let signal: AbortSignal | undefined, reads = 0;
  const observed = { kind: 'nonce-consumed' as const, operationHash: instruction.operationHash,
    currentNonce: (BigInt(instruction.operationNonce) + 1n).toString(), anchor: instruction.observedAt };
  const f = fixture({
    locals: [outer], smartAuthorizations: { entries: [instruction], nextCursor: null },
    async observeSmartAuthorization(_scope, hash, guard, nextSignal) {
      guard();
      assert.equal(hash, instruction.operationHash);
      signal = nextSignal;
      return ++reads === 1 ? delayed.promise : observed;
    },
  });
  await f.controller.refresh();
  const view = new AbortController();
  const pending = f.controller.inspectSmartAuthorization(instruction.operationHash, () => {}, view.signal);
  assert.equal(f.controller.getSnapshot().rows[0]!.smartAuthorizations?.[0]?.checking, true);
  view.abort();
  assert.equal(signal?.aborted, true);
  delayed.resolve(observed);
  await pending;
  assert.equal(f.controller.getSnapshot().rows[0]!.smartAuthorizations?.[0]?.observation, undefined);
  await f.controller.inspectSmartAuthorization(instruction.operationHash, () => {}, new AbortController().signal);
  assert.deepEqual(f.controller.getSnapshot().rows[0]!.smartAuthorizations?.[0]?.observation, observed);
});

test('an exact older Activity target enters ordinary rows and cannot publish across a scope change', async () => {
  const older = fixture().local(80, 'attempted');
  const held = deferred<{ local: LocalActivityRecord }>();
  const seen: string[] = [];
  const f = fixture({ async loadTarget(scope, target, guard) {
    assert.equal(scope.address, OWNER);
    guard();
    seen.push(target);
    return seen.length === 1 ? { local: older } : held.promise;
  } });
  const close = f.controller.connect();
  try {
    await until(() => f.controller.getSnapshot().status === 'ready');
    await f.controller.loadTarget(older.hash);
    assert.equal(f.controller.getSnapshot().rows[0]?.local, older);
    const late = f.controller.loadTarget(hash(81));
    assert.deepEqual(seen, [older.hash, hash(81)]);
    f.source.change({ phase: 'locked', account: null });
    held.resolve({ local: { ...older, hash: hash(81) } });
    await assert.rejects(late, /CANCELLED/);
    assert.deepEqual(f.controller.getSnapshot().rows, []);
  } finally { close(); }
});
