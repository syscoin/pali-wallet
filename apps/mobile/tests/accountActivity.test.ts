import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountActivityController } from '../src/activity/accountActivity.ts';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW } from '../src/activity/types.ts';
import { decodeActivityPage } from '../src/activity/explorerReader.ts';
import { createNativeNetwork, getNativeNetwork, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import type { NotificationChoice } from '../src/notifications/choices.ts';

const owner = '0x1111111111111111111111111111111111111111';
const outsider = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'a'.repeat(64);
const networks = [getNativeNetwork('ethereum'), getNativeNetwork('rollux')];
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => setImmediate(resolve)); };

function fixture(initialFilter: string | Promise<string> | (() => Promise<string>) = 'all', direction: 'received' | 'self' = 'received', olderRetained = false) {
  let currentId = 'hd:60:0', revision = 1;
  const listeners = new Set<(snapshot: any) => void>();
  const calls: { id: string; account: string; signal: AbortSignal }[] = [], loads: string[] = [], savedLoads: string[] = [];
  let held: Promise<void> | undefined, saveHeld: Promise<void> | undefined, failedNetwork: string | undefined;
  const choices: NotificationChoice[] = Array.from({ length: 15 }, (_, index) => networks.map(network => ({
    label: `Account ${index + 1}`, networkName: network.name, symbol: network.symbol,
    scope: { id: `native:hd:60:${index}:${network.id}`, accountId: `hd:60:${index}`, accountType: 'HDAccount',
      accountAddress: index === 0 ? owner : '0x' + (index + 2).toString(16).padStart(2, '0').repeat(20), network, guardian: false },
  }))).flat();
  const address = () => choices.find(choice => choice.scope.accountId === currentId)!.scope.accountAddress;
  const source = {
    getSnapshot: () => ({ phase: 'ready', revision, account: { address: address(), network: 'ethereum' } }) as any,
    getCatalogue: () => ({ active: { accountId: currentId, networkId: 'ethereum' }, revision }) as any,
    subscribe: (listener: (snapshot: any) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  let selected = typeof initialFilter === 'string' ? initialFilter : 'all';
  let filterReads = 0, filterLoad = initialFilter;
  const model = new AccountActivityController({ source, choices: () => choices,
    filter: { load: () => { filterReads++; return typeof filterLoad === 'function' ? filterLoad() : Promise.resolve(filterLoad); }, save: async value => { await saveHeld; selected = value; } },
    runtime: (scope, guard) => ({
      async load(check) {
        guard(); check(); loads.push(scope.accountId + ':' + scope.network.id);
        return { scope: createActivityScope('b'.repeat(64), scope.accountId, scope.accountAddress, scope.network as typeof networks[number]),
          saved: { archived: [], candidates: [], truncated: false, view: DEFAULT_ACTIVITY_VIEW }, locals: [], olderRetained };
      },
      async saveCache(_scope, _rows, check) { guard(); check(); },
      async saveView(_scope, _view, check) { guard(); check(); },
      async loadSavedPending(_scope, _cursor, check) {
        guard(); check(); savedLoads.push(scope.accountId + ':' + scope.network.id);
        const network = scope.network as NativeNetworkRegistration;
        return { records: [{ walletFingerprint: 'b'.repeat(64), accountId: scope.accountId, address: scope.accountAddress,
          networkId: network.id, registrationHash: network.registrationHash, chainId: network.chainId,
          hash: '0x' + 'c'.repeat(64), phase: 'submitted' as const, nonce: 9, createdAt: 1000,
          recipient: outsider, amountUnits: '1', maximumFeeUnits: '21000' }], nextCursor: null };
      },
    }),
    explorer: { async page(scope, feed, _page, signal, guard) {
      calls.push({ id: scope.network.id, account: scope.address, signal });
      if (held) await held;
      guard();
      if (scope.network.id === failedNetwork) throw Error('Explorer unavailable');
      if (feed === 'tokentx') return [];
      return decodeActivityPage({ status: '1', result: [{ hash, from: direction === 'self' ? scope.address : outsider, to: scope.address, value: '1',
        timeStamp: '1700000000', blockNumber: '10', confirmations: '1', nonce: '0', txreceipt_status: '1' }] }, feed, scope.address, Number(scope.network.chainId));
    } },
    receipts: { async read() { throw Error('List rendering must not request receipts'); } },
  });
  return { model, calls, loads, savedLoads, selected: () => selected,
    filterReads: () => filterReads, setFilterLoad(value: typeof initialFilter) { filterLoad = value; },
    hold(value: Promise<void> | undefined) { held = value; },
    holdSave(value: Promise<void> | undefined) { saveHeld = value; },
    failNetwork(value: string | undefined) { failedNetwork = value; },
    refreshSource() { revision++; for (const listener of listeners) listener(source.getSnapshot()); },
    changeAccount(id: string, beforeListeners?: () => void) {
      currentId = id; revision++; beforeListeners?.();
      for (const listener of listeners) listener(source.getSnapshot());
    },
  };
}

test('restores the concrete filter before reading, and fifteen saved accounts cause only selected-account requests', async () => {
  let release!: (filter: string) => void;
  const f = fixture(new Promise(resolve => { release = resolve; }));
  const stop = f.model.connect();
  await tick(); assert.equal(f.calls.length, 0); assert.equal(f.loads.length, 0);
  release('ethereum'); await tick();
  assert.deepEqual(f.loads, ['hd:60:0:ethereum']);
  assert(f.calls.every(call => call.id === 'ethereum' && call.account === owner));
  assert.equal(f.model.getSnapshot().rows.length, 1);
  await f.model.selectFilter('rollux'); await tick();
  assert.equal(f.selected(), 'rollux');
  assert.equal(f.model.getSnapshot().rows[0]!.choice.scope.network.id, 'rollux');
  stop();
});

test('healthy all-network loading and refresh never publish an unavailable-history warning', async () => {
  const f = fixture();
  const unavailable: boolean[] = [];
  const unsubscribe = f.model.subscribe(() => unavailable.push(f.model.getSnapshot().partial));
  const stop = f.model.connect();
  try {
    await tick();
    assert.equal(unavailable.includes(true), false);
    assert.equal(f.model.getSnapshot().hasMore, false);
    unavailable.length = 0;
    await f.model.refresh();
    await tick();
    assert.equal(unavailable.includes(true), false);
    assert.equal(f.model.getSnapshot().hasMore, false);
  } finally { stop(); unsubscribe(); }
});

test('an actual failed network remains partial only when that network is visible', async () => {
  const f = fixture();
  f.failNetwork('rollux');
  const stop = f.model.connect();
  try {
    await tick();
    assert.equal(f.model.getSnapshot().partial, true);
    await f.model.selectFilter('ethereum');
    await tick();
    assert.equal(f.model.getSnapshot().partial, false);
    await f.model.selectFilter('all');
    await tick();
    assert.equal(f.model.getSnapshot().partial, true);
    f.failNetwork(undefined);
    await f.model.refresh();
    assert.equal(f.model.getSnapshot().partial, false);
  } finally { stop(); }
});

test('all-network rows retain distinct identities for an identical hash and share direction/privacy filters', async () => {
  const f = fixture(); const stop = f.model.connect(); await tick();
  const all = f.model.getSnapshot();
  assert.equal(all.rows.length, 2);
  assert.equal(new Set(all.rows.map(row => row.key)).size, 2);
  assert.deepEqual(new Set(all.rows.map(row => row.choice.networkName)), new Set(networks.map(network => network.name)));
  assert(all.rows.every(row => row.row.hash === hash));
  await f.model.setView({ filter: 'sent', showZero: true });
  assert.equal(f.model.getSnapshot().rows.length, 0);
  assert.equal(f.model.findRow('ethereum', hash)?.choice.scope.network.id, 'ethereum');
  assert.equal(f.model.findRow('rollux', hash)?.choice.scope.network.id, 'rollux');
  await f.model.setView({ filter: 'received' });
  assert.equal(f.model.getSnapshot().rows.length, 2);
  stop(); const stopAgain = f.model.connect(); await tick();
  assert.equal(f.model.getSnapshot().view.filter, 'received');
  assert.equal(f.model.getSnapshot().view.showZero, true);
  stopAgain();
});

test('self transfers remain in both Sent and Received across all networks', async () => {
  const f = fixture('all', 'self'), stop = f.model.connect();
  try {
    await tick();
    const initial = f.model.getSnapshot().rows.map(row => row.key);
    assert.equal(initial.length, 2);
    const reads = f.calls.length;
    for (const filter of ['sent', 'received'] as const) {
      await f.model.setView({ filter });
      assert.deepEqual(f.model.getSnapshot().rows.map(row => row.key), initial);
    }
    assert.equal(f.calls.length, reads);
  } finally { stop(); }
});

test('ordinary Activity pagination includes earlier journal rows only for visible account and network scopes', async () => {
  const f = fixture('ethereum', 'received', true), stop = f.model.connect(); await tick();
  assert.equal(f.model.getNetwork('rollux'), undefined);
  assert.equal(f.model.getNetwork('missing'), undefined);
  const ethereum = f.model.getNetwork('ethereum')!;
  assert(ethereum.controller.getSnapshot().hasMore);
  assert(!f.model.getSnapshot().rows.some(row => row.row.hash === '0x' + 'c'.repeat(64)));
  await ethereum.controller.loadMore();
  assert.deepEqual(f.savedLoads, ['hd:60:0:ethereum']);
  assert.equal(ethereum.controller.getSnapshot().rows.find(row => row.hash === '0x' + 'c'.repeat(64))?.hash, '0x' + 'c'.repeat(64));
  await f.model.selectFilter('all'); await tick();
  const other = f.model.getNetwork('rollux')!;
  await other.controller.loadMore();
  assert.deepEqual(f.savedLoads, ['hd:60:0:ethereum', 'hd:60:0:rollux']);
  assert.equal(other.controller.getSnapshot().rows.find(row => row.hash === '0x' + 'c'.repeat(64))?.local?.networkId, 'rollux');
  assert.notEqual(other.controller, ethereum.controller);
  f.changeAccount('hd:60:1'); await tick();
  assert.equal(f.model.getNetwork('rollux')?.choice.scope.accountId, 'hd:60:1');
  assert.equal(ethereum.controller.getSnapshot().rows.length, 0);
  stop(); assert.equal(f.model.getNetwork('ethereum'), undefined);
});

test('filter and account changes abort old reads and cannot publish late rows from the previous scope', async () => {
  let release!: () => void;
  const f = fixture(); f.hold(new Promise(resolve => { release = resolve; }));
  const stop = f.model.connect(); await tick();
  const old = [...f.calls];
  await f.model.selectFilter('rollux');
  assert(old.every(call => call.signal.aborted));
  f.changeAccount('hd:60:1');
  f.hold(undefined); release(); await tick();
  assert(f.model.getSnapshot().rows.every(row => row.choice.scope.accountId === 'hd:60:1' && row.choice.scope.network.id === 'rollux'));
  assert(f.calls.slice(old.length).every(call => call.id === 'rollux'));
  stop();
});

test('a source refresh while a concrete filter is saving cannot restart the old all-network reads', async () => {
  const f = fixture(); const stop = f.model.connect(); await tick();
  let finish!: () => void;
  f.holdSave(new Promise(resolve => { finish = resolve; }));
  const priorLoads = f.loads.length, priorCalls = f.calls.length;
  const selected = f.model.selectFilter('ethereum');
  f.refreshSource(); await tick();
  assert.equal(f.loads.length, priorLoads); assert.equal(f.calls.length, priorCalls);
  assert.equal(f.model.getSnapshot().rows.length, 0);
  finish(); await selected; await tick();
  assert.equal(f.selected(), 'ethereum'); assert.equal(f.model.getSnapshot().filter, 'ethereum');
  assert(f.calls.slice(priorCalls).every(call => call.id === 'ethereum'));
  stop();
});

test('snapshot access during owner change cannot expose the previous account before source listeners run', async () => {
  const f = fixture(); const stop = f.model.connect(); await tick();
  assert.equal(f.model.getSnapshot().rows.length, 2);
  f.changeAccount('hd:60:1', () => {
    const current = f.model.getSnapshot();
    assert.equal(current.accountId, 'hd:60:1');
    assert.equal(current.rows.length, 0);
  });
  await tick();
  assert(f.model.getSnapshot().rows.every(row => row.choice.scope.accountId === 'hd:60:1'));
  stop();
});

function pendingNetworksFixture(registrations: readonly NativeNetworkRegistration[]) {
  const choices: NotificationChoice[] = registrations.map(network => ({ label: 'Account', networkName: network.name, symbol: network.symbol,
    scope: { id: 'native:hd:60:0:' + network.id, accountId: 'hd:60:0', accountType: 'HDAccount', accountAddress: owner, network, guardian: false } }));
  const source = { getSnapshot: () => ({ phase: 'ready', revision: 1, account: { address: owner, network: registrations[0]!.id } }) as any,
    getCatalogue: () => ({ active: { accountId: 'hd:60:0', networkId: registrations[0]!.id }, revision: 1 }) as any,
    subscribe: () => () => {} };
  let release!: () => void, active = 0, maximum = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const calls: { kind: string; network: string; signal: AbortSignal }[] = [];
  const read = async (kind: string, network: string, signal: AbortSignal, guard: () => void) => {
    guard(); calls.push({ kind, network, signal }); maximum = Math.max(maximum, ++active);
    try { await held; guard(); } finally { active--; }
  };
  const model = new AccountActivityController({ source, choices: () => choices,
    filter: { async load() { return 'all'; }, async save() {} },
    runtime: (scope, check) => ({
      async load(guard) {
        check(); guard(); const network = scope.network as NativeNetworkRegistration;
        const activity = createActivityScope('b'.repeat(64), scope.accountId, owner, network);
        return { scope: activity, saved: { archived: [], candidates: [], truncated: false, view: DEFAULT_ACTIVITY_VIEW },
          locals: [1, 2].map(index => ({ walletFingerprint: 'b'.repeat(64), accountId: scope.accountId, address: owner,
            networkId: network.id, registrationHash: network.registrationHash, chainId: network.chainId,
            hash: '0x' + index.toString(16).padStart(64, '0'), phase: 'submitted' as const, nonce: index,
            createdAt: 1700000000000, recipient: outsider, amountUnits: '1', maximumFeeUnits: '21000' })) };
      },
      async observeLocal(_record, guard, signal) {
        await read('local', scope.network.id, signal, guard);
        return { status: 'missing' as const, latestNonce: '0' };
      },
      async saveCache(_scope, _rows, guard) { check(); guard(); },
      async saveView(_scope, _view, guard) { check(); guard(); },
    }),
    explorer: { async page(scope, _feed, _page, signal, guard) { await read('page', scope.network.id, signal, guard); return []; } },
    receipts: { async read(_hash, _owner, signal, guard, network) { await read('receipt', network!.id, signal, guard); return null; } },
  });
  return { model, calls, release, maximum: () => maximum };
}

const customNetworks = Array.from({ length: 16 }, (_, index) => createNativeNetwork({ id: 'custom:' + index,
  name: 'Custom ' + index, chainId: String(800000 + index), kind: 'evm', slip44: 60,
  rpcUrl: `https://network-${index}.example/rpc`, symbol: 'ETH', decimals: 18, testnet: true }));

test('sixteen networks with two pending transactions share a maximum of four public reads', async () => {
  const f = pendingNetworksFixture(customNetworks), stop = f.model.connect();
  await tick(); assert.equal(f.calls.length, 4); assert.equal(f.maximum(), 4);
  f.release(); await tick();
  assert.equal(f.calls.length, 32); assert.equal(f.maximum(), 4);
  stop();
});

test('switching networks aborts queued old reads and keeps active slots until their reads settle', async () => {
  const f = pendingNetworksFixture(customNetworks), stop = f.model.connect();
  await tick(); const old = [...f.calls]; assert.equal(old.length, 4);
  const selected = customNetworks[15]!.id;
  await f.model.selectFilter(selected); await tick();
  assert(old.every(call => call.signal.aborted)); assert.equal(f.calls.length, 4);
  f.release(); await tick();
  assert.equal(f.calls.length, 6);
  assert(f.calls.slice(4).every(call => call.network === selected));
  assert.equal(f.maximum(), 4);
  stop();
});

test('explorer pages, retained observations and detail receipts consume the same account budget', async () => {
  const f = pendingNetworksFixture([networks[0]!]), stop = f.model.connect();
  await tick(); assert.equal(f.calls.length, 3);
  for (const row of f.model.getSnapshot().rows) row.controller.inspect(row.row.hash);
  await tick(); assert.equal(f.calls.length, 4); assert.equal(f.maximum(), 4);
  f.release(); await tick();
  assert.deepEqual(new Set(f.calls.map(call => call.kind)), new Set(['local', 'page', 'receipt']));
  assert.equal(f.maximum(), 4);
  stop();
});

for (const paired of [false, true]) test(
  paired ? 'wallet account Activity preserves the same-network receipt wave' : 'wallet account Activity composition shares automatic receipt work with explicit details',
  async () => {
  const { ActivityReceiptReader } = await import('../src/activity/receiptReader.ts');
  const network = networks[0]!, blockHash = '0x' + 'b'.repeat(64);
  const held = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
  const hashes = paired ? [hash, '0x' + 'd'.repeat(64)] : [hash];
  const batches: string[][] = [];
  const receipts = new ActivityReceiptReader({ fetch: async (_url, init) => {
    const input = JSON.parse(String(init.body));
    const requests = Array.isArray(input) ? input : [input];
    batches.push(requests.map(request => request.method));
    const replies = await Promise.all(requests.map(async request => {
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getTransactionReceipt') {
        started.resolve(); await held.promise;
        result = { transactionHash: request.params[0], from: owner, to: outsider, status: '0x1', blockNumber: '0x50', blockHash, transactionIndex: '0x0', logs: [] };
      } else if (request.method === 'eth_getTransactionByHash') result = { hash, from: owner, to: outsider, value: '0x1', nonce: '0x1', blockHash, blockNumber: '0x50', transactionIndex: '0x0' };
      else if (request.method === 'eth_getBlockByNumber') result = { number: '0x50', hash: blockHash, timestamp: '0x6553f100', gasLimit: '0x1c9c380' };
      else throw Error(request.method);
      return { jsonrpc: '2.0', id: request.id, result };
    }));
    return Response.json(Array.isArray(input) ? replies : replies[0]);
  } });
  const scope = createActivityScope('b'.repeat(64), 'hd:60:0', owner, network);
  const choice: NotificationChoice = { label: 'Account', networkName: network.name, symbol: network.symbol,
    scope: { id: 'native:hd:60:0:ethereum', accountId: 'hd:60:0', accountType: 'HDAccount', accountAddress: owner, network, guardian: false } };
  const source = { getSnapshot: () => ({ phase: 'ready', revision: 1, account: { address: owner, network: network.id } }) as any,
    getCatalogue: () => ({ active: { accountId: 'hd:60:0', networkId: network.id }, revision: 1 }) as any,
    subscribe: () => () => {} };
  let persisted = 0;
  const model = new AccountActivityController({ source, choices: () => [choice],
    filter: { async load() { return 'all'; }, async save() {} },
    runtime: () => ({
      async load() { return { scope, saved: { archived: [], candidates: [], truncated: false, view: DEFAULT_ACTIVITY_VIEW },
        locals: hashes.map((item, index) => ({ walletFingerprint: 'b'.repeat(64), accountId: 'hd:60:0', address: owner, networkId: network.id,
          registrationHash: network.registrationHash, chainId: network.chainId, hash: item, phase: 'submitted' as const,
          nonce: index + 1, createdAt: 1000, recipient: outsider, amountUnits: '1', maximumFeeUnits: '21000' })) }; },
      async observeLocal(record, check, signal, observe) {
        const request = { chainId: network.chainId, from: owner, to: outsider, hash: record.hash, nonce: String(record.nonce) };
        const result = observe ? await observe(request) : await receipts.observe(request, signal, check, network, 'runtime-owned');
        check(); assert.equal(signal.aborted, false); persisted++; return result;
      },
      async saveCache() {}, async saveView() {},
    }),
    explorer: { async page() { return []; } }, receipts,
  });
  const stop = model.connect();
  try {
    await started.promise;
    if (!paired) {
      model.getNetwork(network.id)!.controller.inspect(hash);
      await tick();
      assert.equal(batches.flat().filter(method => method === 'eth_getTransactionByHash').length, 1);
    }
    held.resolve(); await tick();
    const row = model.findRow(network.id, hash)!.row;
    assert.equal(row.retainedObservation?.status, 'mined');
    if (paired) {
      assert.equal(model.findRow(network.id, hashes[1]!)?.row.retainedObservation?.status, 'mined');
      assert.equal(persisted, 2);
      assert.deepEqual(batches, [['eth_chainId'], ['eth_getTransactionReceipt', 'eth_getTransactionReceipt'], ['eth_getBlockByNumber'], ['eth_chainId']]);
    } else {
      assert.equal(row.observation?.status, 'confirmed');
      assert.equal(persisted, 1);
      assert.deepEqual(batches, [['eth_chainId'], ['eth_getTransactionReceipt'], ['eth_getTransactionByHash'], ['eth_getBlockByNumber'], ['eth_chainId']]);
    }
  } finally { held.resolve(); stop(); }
});

test('failed filter reads survive source updates and explicit refresh retries the exact prerequisite', async () => {
  let reject!: (cause: Error) => void;
  const f = fixture(new Promise<string>((_resolve, fail) => { reject = fail; }));
  const stop = f.model.connect();
  try {
    f.model.getSnapshot(); await tick();
    reject(Error('Public preference temporarily unavailable')); await tick();
    assert.equal(f.filterReads(), 1); assert.equal(f.calls.length, 0);
    const failure = f.model.getSnapshot().error;
    assert.equal(f.model.getSnapshot().status, 'unavailable'); assert(failure);
    f.refreshSource(); await f.model.setView({ filter: 'received' });
    assert.equal(f.model.getSnapshot().status, 'unavailable');
    assert.equal(f.model.getSnapshot().error, failure); assert.equal(f.filterReads(), 1);
    f.setFilterLoad('ethereum');
    await f.model.refresh(); await tick();
    assert.equal(f.filterReads(), 2); assert.equal(f.model.getSnapshot().filter, 'ethereum');
    assert.equal(f.model.getSnapshot().status, 'ready'); assert.equal(f.model.getSnapshot().error, null);
    assert(f.calls.length > 0); assert(f.calls.every(call => call.id === 'ethereum'));
  } finally { stop(); }
});

test('concurrent refreshes join a pending filter read without broadening its eventual concrete selection', async () => {
  let resolve!: (filter: string) => void;
  const f = fixture(new Promise<string>(done => { resolve = done; }));
  const stop = f.model.connect();
  try {
    const first = f.model.refresh(), second = f.model.refresh();
    f.refreshSource(); await tick();
    assert.equal(f.filterReads(), 1); assert.equal(f.model.getSnapshot().status, 'loading'); assert.equal(f.calls.length, 0);
    resolve('rollux'); await Promise.all([first, second]); await tick();
    assert.equal(f.filterReads(), 1); assert.equal(f.model.getSnapshot().filter, 'rollux');
    assert(f.calls.length > 0); assert(f.calls.every(call => call.id === 'rollux'));
  } finally { stop(); }
});

test('an immediate failed retry stays recoverable, and a retired read cannot replace a reconnected filter', async () => {
  const f = fixture(() => Promise.reject(Error('Preference unavailable')));
  let stop = f.model.connect();
  try {
    await tick(); await f.model.refresh(); f.refreshSource(); await tick();
    assert.equal(f.filterReads(), 2); assert.equal(f.model.getSnapshot().status, 'unavailable'); assert(f.model.getSnapshot().error);
    let release!: (filter: string) => void;
    f.setFilterLoad(new Promise<string>(resolve => { release = resolve; }));
    const retired = f.model.refresh(); await tick(); stop();
    f.setFilterLoad('ethereum'); stop = f.model.connect(); await tick();
    release('all'); await retired; await tick();
    assert.equal(f.model.getSnapshot().filter, 'ethereum');
    assert(f.calls.every(call => call.id === 'ethereum'));
  } finally { stop(); }
});

test('a synchronous loading subscriber joins the owned filter read', async () => {
  let resolve!: (filter: string) => void;
  const f = fixture(new Promise<string>(done => { resolve = done; }));
  let retry: Promise<void> | undefined;
  const unsubscribe = f.model.subscribe(() => {
    if (!retry && f.model.getSnapshot().status === 'loading') retry = f.model.refresh();
  });
  const stop = f.model.connect();
  try {
    await tick(); assert.equal(f.filterReads(), 1);
    resolve('ethereum'); await retry; await tick();
    assert.equal(f.model.getSnapshot().filter, 'ethereum'); assert.equal(f.filterReads(), 1);
  } finally { unsubscribe(); stop(); }
});
