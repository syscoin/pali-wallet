import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { AccountActivityController } from '../src/activity/accountActivity.ts';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW } from '../src/activity/types.ts';
import { decodeActivityPage } from '../src/activity/explorerReader.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { walletUiFixture } from './walletUiFixture.ts';

const address = '0x' + '11'.repeat(20), recipient = '0x' + '22'.repeat(20), hash = '0x' + 'a'.repeat(64);
const tick = async () => { for (let n = 0; n < 12; n++) await new Promise<void>(resolve => setImmediate(resolve)); };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
type Element = { type: unknown; props: Record<string, any>; children: unknown[] };

function fixture(failures: number, olderTarget = false) {
  const networks = ['ethereum', 'rollux'].map(id => getNativeNetwork(id));
  const choices = networks.map(network => ({ label: 'Account 1', networkName: network.name, symbol: network.symbol,
    scope: { id: `hd:60:0:${network.id}`, accountId: 'hd:60:0', accountType: 'HDAccount' as const, accountAddress: address, network, guardian: false } }));
  const writes: string[] = [], reads: string[] = [];
  let persisted = 'ethereum', heldSave: Promise<void> | undefined;
  const source = { getSnapshot: () => ({ phase: 'ready', revision: 1, account: { address, network: 'ethereum' } }) as any,
    getCatalogue: () => ({ active: { accountId: 'hd:60:0', networkId: 'ethereum' }, revision: 1 }) as any,
    subscribe: () => () => undefined };
  const controller = new AccountActivityController({ source, choices: () => choices,
    filter: { load: async () => persisted, save: async filter => {
      writes.push(filter); await heldSave;
      if (failures-- > 0) throw Error('Storage unavailable');
      persisted = filter;
    } },
    runtime: (scope, guard) => ({
      async load(check) { guard(); check(); return { scope: createActivityScope('b'.repeat(64), scope.accountId, scope.accountAddress, scope.network as typeof networks[number]),
        saved: { archived: [], candidates: [], truncated: false, view: DEFAULT_ACTIVITY_VIEW }, locals: [] }; },
      async saveCache(_scope, _rows, check) { guard(); check(); },
      async saveView(_scope, _view, check) { guard(); check(); },
    }),
    explorer: { async page(scope, feed, page, _signal, guard) { guard(); reads.push(scope.network.id);
      const hashes = olderTarget && page === 1 ? Array.from({ length: 20 }, (_, i) => '0x' + String(i + 1).padStart(64, '0')) : [hash];
      return feed === 'tokentx' ? [] : decodeActivityPage({ status: '1', result: hashes.map((entry, i) => ({ hash: entry, from: recipient, to: scope.address,
        value: '1', timeStamp: '1700000000', blockNumber: String(page === 1 ? 100 - i : 50), confirmations: '1', nonce: String(page * 20 + i), txreceipt_status: '1' })) }, feed, scope.address, Number(scope.network.chainId));
    } }, receipts: { async read() { throw Error('No receipt reads expected'); } },
  });
  let cursor = 0, target: { networkId: string; hash: string } | undefined = { networkId: 'rollux', hash };
  const cells: Cell[] = [], effects: (() => void)[] = [];
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const effect = (run: () => void | (() => void), deps?: readonly unknown[]) => {
    const slot = cell();
    if (deps && slot.deps && deps.length === slot.deps.length && deps.every((value, index) => Object.is(value, slot.deps![index]))) return;
    slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = run() || undefined; });
  };
  const react = { createElement: (type: unknown, props: any, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const slot = cell(); if (!Object.hasOwn(slot, 'value')) slot.value = initial;
      return [slot.value, (value: unknown) => { slot.value = typeof value === 'function' ? value(slot.value) : value; }]; },
    useRef(initial: unknown) { const slot = cell(); slot.value ??= { current: initial }; return slot.value; },
    useLayoutEffect: effect, useEffect: effect,
    useSyncExternalStore(_subscribe: unknown, get: () => unknown) { cell(); return get(); },
  };
  const imports: Record<string, any> = { react,
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'View'].map(name => [name, name])),
      AppState: { currentState: 'active' }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../platform/balancePrivacy': { useBalancePrivacy: () => ({ hidden: false }) },
    '../platform/localization': nativeTranslationFixture,
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'IconButton', 'Notice', 'SegmentedControl', 'Text'].map(name => [name, name])), styles: {}, colors: {} },
    './ActivityListRow': { ActivityListRow: 'ActivityListRow' },
    './IdleActivityBoundary': { IdlePressable: 'IdlePressable' },
    './NativeActivity': { NativeActivityScreen: 'NativeActivityScreen', nativeActivityRowPresentation: () => ({ date: { key: 'today', label: 'Today', time: '' }, direction: 'received', amount: '1', title: 'Received' }) },
    './NetworkSourceSheet': { NetworkSourceSheet: 'NetworkSourceSheet' },
    '../activity/assetIcon': { activityAssetIcon: () => undefined },
  };
  const module = { exports: {} as Record<string, any> };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/screens/AllNetworksActivity.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInNewContext(compiled, { module, exports: module.exports, queueMicrotask, Error,
    require(name: string) { const ui = walletUiFixture(name, imports); if (ui) return ui; assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  let opened = 0;
  const onInitialTargetOpened = () => { opened++; };
  const render = (): Element => { cursor = 0; const tree = module.exports.AllNetworksActivity({ controller, accountLabel: 'Account 1', initialTarget: target, onInitialTargetOpened }); effects.splice(0).forEach(run => run()); return tree; };
  const nodes = (value: any): Element[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object' || !('children' in value)) return [];
    return [value, ...value.children.flatMap(nodes), ...nodes(value.props.right), ...nodes(value.props.ListHeaderComponent), ...nodes(value.props.ListFooterComponent)];
  };
  return { controller, writes, reads, render, nodes, opened: () => opened,
    holdSave(promise: Promise<void>) { heldSave = promise; },
    setTarget(value: typeof target) { target = value; render(); },
    choose(filter: string) {
      nodes(render()).find(node => node.type === 'IdlePressable')!.props.onPress();
      nodes(render()).find(node => node.type === 'NetworkSourceSheet')!.props.onSelect(filter);
    },
    refresh() { const button = nodes(render()).find(node => node.props.label === 'Refresh activity'); assert(button && !button.props.disabled); button.props.onPress(); },
    detail: () => nodes(render()).find(node => node.type === 'NativeActivityScreen'),
    close() { for (const slot of cells) slot.cleanup?.(); },
  };
}

test('a deliberate refresh retries the failed exact target after reloading its saved concrete filter', async () => {
  const f = fixture(1);
  try {
    f.render(); await tick(); f.render(); await tick();
    assert.deepEqual(f.writes, ['rollux']); assert.equal(f.controller.getSnapshot().filter, null); assert(!f.detail());
    await tick(); assert.deepEqual(f.writes, ['rollux'], 'no automatic retry loop');
    assert.equal(f.opened(), 0);
    f.refresh(); await tick();
    assert.deepEqual(f.writes, ['rollux', 'rollux']);
    assert.equal(f.controller.getSnapshot().filter, 'rollux');
    assert(f.detail());
    assert.equal(f.opened(), 1);
    f.setTarget(undefined);
    assert(f.detail(), 'clearing the route intent keeps the selected detail open');
    assert(f.reads.every(network => network === 'ethereum' || network === 'rollux'));
  } finally { f.close(); }
});

test('a second failed target write is attempted only by a second explicit refresh', async () => {
  const f = fixture(2);
  try {
    f.render(); await tick(); f.render(); await tick();
    f.refresh(); await tick(); assert.deepEqual(f.writes, ['rollux', 'rollux']); assert(!f.detail());
    await tick(); assert.equal(f.writes.length, 2);
    f.refresh(); await tick(); assert.deepEqual(f.writes, ['rollux', 'rollux', 'rollux']); assert(f.detail());
  } finally { f.close(); }
});

test('a removed notification target cannot be retried by a later refresh', async () => {
  const f = fixture(1);
  try {
    f.render(); await tick(); f.render(); await tick();
    f.setTarget(undefined); f.refresh(); await tick();
    assert.deepEqual(f.writes, ['rollux']); assert.equal(f.controller.getSnapshot().filter, 'ethereum'); assert(!f.detail());
  } finally { f.close(); }
});

test('a deliberate concrete filter choice retires the failed notification target before refresh', async () => {
  const f = fixture(1);
  try {
    f.render(); await tick(); f.render(); await tick();
    assert.deepEqual(f.writes, ['rollux']);
    f.choose('ethereum'); await tick();
    assert.equal(f.controller.getSnapshot().filter, 'ethereum');
    f.refresh(); await tick();
    assert.deepEqual(f.writes, ['rollux', 'ethereum']);
    assert.equal(f.controller.getSnapshot().filter, 'ethereum');
    assert(!f.detail());
  } finally { f.close(); }
});

test('manually loading an older indexed EVM notification leaves the Activity list open', async () => {
  const f = fixture(0, true);
  try {
    f.render(); await tick(); f.render(); await tick();
    assert.equal(f.opened(), 0);
    assert(!f.controller.findRow('rollux', hash));
    const older = f.nodes(f.render()).find(node => node.props.title === 'Load older activity');
    assert(older && !older.props.disabled); older.props.onPress(); await tick();
    assert(f.controller.findRow('rollux', hash));
    assert(!f.detail());
    assert.equal(f.opened(), 1, 'the host consumes the routing intent');
    f.setTarget(undefined);
    f.refresh(); await tick();
    assert(!f.detail());
  } finally { f.close(); }
});
