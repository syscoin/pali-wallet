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

function fixture(initialFilter: string | Promise<string> = 'all') {
  let currentId = 'hd:60:0', revision = 1;
  const listeners = new Set<(snapshot: any) => void>();
  const calls: { id: string; account: string; signal: AbortSignal }[] = [], loads: string[] = [], savedLoads: string[] = [];
  let held: Promise<void> | undefined, saveHeld: Promise<void> | undefined;
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
  const model = new AccountActivityController({ source, choices: () => choices,
    filter: { load: () => Promise.resolve(initialFilter), save: async value => { await saveHeld; selected = value; } },
    runtime: (scope, guard) => ({
      async load(check) {
        guard(); check(); loads.push(scope.accountId + ':' + scope.network.id);
        return { scope: createActivityScope('b'.repeat(64), scope.accountId, scope.accountAddress, scope.network as typeof networks[number]),
          saved: { archived: [], candidates: [], truncated: false, view: DEFAULT_ACTIVITY_VIEW }, locals: [] };
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
      if (feed === 'tokentx') return [];
      return decodeActivityPage({ status: '1', result: [{ hash, from: outsider, to: scope.address, value: '1',
        timeStamp: '1700000000', blockNumber: '10', confirmations: '1', nonce: '0', txreceipt_status: '1' }] }, feed, scope.address, Number(scope.network.chainId));
    } },
    receipts: { async read() { throw Error('List rendering must not request receipts'); } },
  });
  return { model, calls, loads, savedLoads, selected: () => selected,
    hold(value: Promise<void> | undefined) { held = value; },
    holdSave(value: Promise<void> | undefined) { saveHeld = value; },
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

test('saved inventory opens only an existing visible account/network child and includes older journal rows', async () => {
  const f = fixture('ethereum'), stop = f.model.connect(); await tick();
  assert.equal(f.model.getNetwork('rollux'), undefined);
  assert.equal(f.model.getNetwork('missing'), undefined);
  const ethereum = f.model.getNetwork('ethereum')!;
  assert(ethereum.controller.getSnapshot().canViewSavedPending);
  assert(!f.model.getSnapshot().rows.some(row => row.row.hash === '0x' + 'c'.repeat(64)));
  await ethereum.controller.loadSavedPending();
  assert.deepEqual(f.savedLoads, ['hd:60:0:ethereum']);
  assert.equal(ethereum.controller.getSnapshot().savedPending?.rows[0]?.hash, '0x' + 'c'.repeat(64));
  await f.model.selectFilter('all'); await tick();
  const other = f.model.getNetwork('rollux')!;
  await other.controller.loadSavedPending();
  assert.deepEqual(f.savedLoads, ['hd:60:0:ethereum', 'hd:60:0:rollux']);
  assert.equal(other.controller.getSnapshot().savedPending?.rows[0]?.local?.networkId, 'rollux');
  assert.notEqual(other.controller, ethereum.controller);
  f.changeAccount('hd:60:1'); await tick();
  assert.equal(f.model.getNetwork('rollux')?.choice.scope.accountId, 'hd:60:1');
  assert.equal(ethereum.controller.getSnapshot().savedPending, undefined);
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
