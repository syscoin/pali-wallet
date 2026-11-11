import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { formatIndicativeFiat } from '../src/portfolio/fiatDisplay.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const address = '0x' + '1'.repeat(40);
const tokenAddress = '0x' + '2'.repeat(40);

function fixture(screen: 'wallet' | 'activity', failed = false, onManageAccounts?: () => void) {
  const choice = { label: 'Account 1', networkName: 'Ethereum', symbol: 'ETH', scope: {
    id: 'account-1:ethereum', accountId: 'account-1', accountAddress: address,
    network: { id: 'ethereum', kind: 'evm', chainId: '1', testnet: false },
  } };
  const row = { choice, status: failed ? 'error' : 'available', units: '1000000000000000000', decimals: 18,
    price: 1000, tokens: [{ status: 'available', units: '250', price: 2,
      metadata: { name: 'Saved token', symbol: 'TOK', contractAddress: tokenAddress, decimals: 2 } }], collectibles: [] };
  const snapshot: any = { status: 'ready', filter: 'all', accountId: 'account-1', choices: [choice], rows: screen === 'wallet' ? [row] : [],
    refreshing: false, knownValue: failed ? null : 1005, partial: failed, currency: 'usd',
    view: { filter: 'all', showZero: false }, hasMore: false };
  let rejectSelection = true, hidden = false, writes = 0, cursor = 0;
  let selectionGate: Promise<void> | undefined;
  const cells: Cell[] = [], effects: (() => void)[] = [];
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const effect = (run: () => void | (() => void), deps?: readonly unknown[]) => {
    const value = cell();
    if (deps && value.deps && deps.length === value.deps.length && deps.every((item, index) => Object.is(item, value.deps![index]))) return;
    value.deps = deps;
    effects.push(() => { value.cleanup?.(); value.cleanup = run() || undefined; });
  };
  const react = {
    createElement: (type: unknown, props: Record<string, any> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const value = cell(); if (!Object.hasOwn(value, 'value')) value.value = typeof initial === 'function' ? initial() : initial;
      return [value.value, (next: unknown) => { value.value = typeof next === 'function' ? next(value.value) : next; }]; },
    useRef(initial: unknown) { const value = cell(); value.value ??= { current: initial }; return value.value; },
    useCallback(callback: unknown) { cell(); return callback; },
    useLayoutEffect: effect, useEffect: effect,
    useSyncExternalStore(_subscribe: unknown, get: () => unknown) { cell(); return get(); },
  };
  const native = { ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'View'].map(name => [name, name])),
    AppState: { currentState: 'active' }, StyleSheet: { create: (value: unknown) => value } };
  const controller = { subscribe: () => () => undefined, getSnapshot: () => snapshot, connect: () => () => undefined,
    setCurrency() {}, cachedBalances: () => [], findRow: () => undefined, getNetwork: () => undefined,
    async selectFilter(value: string) { writes++; await selectionGate; if (rejectSelection) throw Error('Storage unavailable'); snapshot.filter = value; },
    async refresh() { throw Error('Activity unavailable'); },
  };
  const imports: Record<string, unknown> = {
    react, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../platform/localization': nativeTranslationFixture,
    '../platform/fiatPreferences': { useFiatCurrency: () => ({ status: 'ready', currency: 'usd' }) },
    '../platform/balancePrivacy': { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden }) },
    '../core/amounts': { formatBaseUnits }, '../../../../source/shared/erc20': { formatTokenUnits },
    '../portfolio/fiatDisplay': { formatIndicativeFiat }, '../activity/activityAmountLabel': { compactActivityAmountLabel },
    '../custody/networkContext': { nativeSigningEnabled: () => true },
    './NativePortfolio': { NativePortfolio: 'NativePortfolio' }, './WalletBackupBadge': { WalletBackupBadge: 'WalletBackupBadge' },
    './ActivityListRow': { ActivityListRow: 'ActivityListRow' }, '../activity/assetIcon': { activityAssetIcon: () => undefined },
    './NativeActivity': { NativeActivityScreen: 'NativeActivityScreen', nativeActivityRowPresentation: () => { throw Error('No activity rows expected'); } },
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'TextInput' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'IconButton', 'Notice', 'Row', 'Screen', 'SegmentedControl', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
  };
  const load = (name: string) => {
    const module = { exports: {} as Record<string, any> };
    const source = readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    runInNewContext(compiled, { module, exports: module.exports, Error, queueMicrotask, require(name: string) {
      assert(Object.hasOwn(imports, name), name); return imports[name];
    } });
    return module.exports;
  };
  const sourceSheet = load('NetworkSourceSheet').NetworkSourceSheet;
  imports['./NetworkSourceSheet'] = { NetworkSourceSheet: sourceSheet };
  const component = load(screen === 'wallet' ? 'NativeAccountOverview' : 'AllNetworksActivity')[screen === 'wallet' ? 'NativeAccountOverview' : 'AllNetworksActivity'];
  const source = { getSnapshot: () => ({ backup: 'confirmed', account: { address, network: 'ethereum' } }),
    getCatalogue: () => ({ active: { accountId: 'account-1' } }) };
  const render = () => {
    cursor = 0;
    const tree = component(screen === 'wallet' ? { controller, portfolio: { source, accountLabel: 'Account 1', onSend() {}, onManageAccounts }, selectNetwork: async () => { throw Error('Detail unavailable'); }, send: async () => {} }
      : { controller, accountLabel: 'Account 1' }) as Element;
    effects.splice(0).forEach(run => run());
    return tree;
  };
  const nodes = (value: any): Element[] => {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object' || !('children' in value)) return [];
    if (value.type === sourceSheet) return nodes(sourceSheet(value.props));
    if (value.type === 'Modal' && !value.props.visible) return [];
    const extra = value.type === 'FlatList' ? [value.props.ListHeaderComponent, value.props.ListFooterComponent,
      ...value.props.data.map((item: unknown, index: number) => value.props.renderItem({ item, index }))] : [];
    return [value, ...value.children.flatMap(nodes), ...nodes(value.props.footer), ...nodes(value.props.right), ...extra.flatMap(nodes)];
  };
  const modal = () => nodes(render()).find(node => node.type === 'Modal' && node.props.visible);
  return { render, nodes, modal, row,
    setHidden(value: boolean) { hidden = value; },
    permitSelection() { rejectSelection = false; },
    holdSelection(value: Promise<void>) { selectionGate = value; },
    selectedFilter: () => snapshot.filter,
    writes: () => writes,
    openFilter() { const label = screen === 'wallet' ? 'Choose network filter, All networks' : 'Activity network: All networks';
      nodes(render()).find(node => node.props.accessibilityLabel === label)!.props.onPress(); },
    openSource(title: 'Send' | 'Receive') { nodes(render()).find(node => node.type === 'Button' && node.props.title === title)!.props.onPress(); },
    failEarlierAction() { const tree = nodes(render());
      const action = screen === 'wallet' ? tree.find(node => String(node.props.accessibilityLabel).startsWith('ETH, Ethereum, '))
        : tree.find(node => node.props.label === 'Refresh activity');
      assert(action); action.props.onPress(); },
    hasScreenError() { return nodes(render()).some(node => node.props.accessibilityRole === 'alert' || node.type === 'Notice' && node.props.body === 'Activity could not be opened. Refresh and try again.'); },
    chooseEthereum() { const choice = nodes(modal()).find(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === 'Ethereum, ETH');
      assert(choice); choice.props.onPress(); },
    close() { cells.forEach(value => value.cleanup?.()); },
  };
}

for (const screen of ['wallet', 'activity'] as const) test(`${screen} filter failure stays visible inside its chooser and permits retry`, async () => {
  const f = fixture(screen);
  try {
    f.openFilter(); f.chooseEthereum(); await tick();
    const modal = f.modal(); assert(modal, 'the failed selection keeps the chooser open');
    const alert = f.nodes(modal).find(node => node.props.accessibilityRole === 'alert');
    assert(alert); assert.equal(alert.props.accessibilityLiveRegion, 'polite');
    assert.deepEqual(alert.children, ['Could not complete this request. Try again.']);
    f.permitSelection(); f.chooseEthereum(); await tick();
    assert.equal(f.writes(), 2); assert.equal(f.modal(), undefined, 'successful retry closes the chooser');
  } finally { f.close(); }
});

for (const screen of ['wallet', 'activity'] as const) test(`${screen} opens a fresh filter without an earlier screen error`, async () => {
  const f = fixture(screen);
  try {
    f.failEarlierAction(); await tick(); assert(f.hasScreenError());
    f.openFilter();
    assert(f.modal());
    assert(!f.nodes(f.modal()).some(node => node.props.accessibilityRole === 'alert'));
    assert(!f.hasScreenError());
  } finally { f.close(); }
});

for (const source of ['Send', 'Receive'] as const) test(`Wallet ${source} opens a fresh chooser without an earlier detail error`, async () => {
  const f = fixture('wallet');
  try {
    f.failEarlierAction(); await tick(); assert(f.hasScreenError());
    f.openSource(source);
    assert(f.modal());
    assert(!f.nodes(f.modal()).some(node => node.props.accessibilityRole === 'alert'));
  } finally { f.close(); }
});

for (const source of ['Send', 'Receive'] as const) test(`a closed filter save cannot dismiss a reopened ${source} chooser`, async () => {
  const f = fixture('wallet'), held = Promise.withResolvers<void>();
  try {
    f.permitSelection(); f.holdSelection(held.promise);
    f.openFilter(); f.chooseEthereum(); await tick();
    f.modal()!.props.onRequestClose(); f.openSource(source);
    assert(f.modal());
    held.resolve(); await tick();
    const modal = f.modal(); assert(modal, 'the newer chooser remains open');
    assert(f.nodes(modal).some(node => node.type === 'Text' && node.children.includes(source === 'Send' ? 'Send from' : 'Receive on')));
    assert.equal(f.writes(), 1); assert.equal(f.selectedFilter(), 'ethereum', 'the selected preference still persists');
  } finally { held.resolve(); f.close(); }
});

test('failed network observations retain their amounts, label them as last known, and hide stale fiat values', () => {
  const f = fixture('wallet', true);
  try {
    const tree = f.nodes(f.render()), text = tree.flatMap(node => node.children).filter(value => typeof value === 'string');
    assert(text.includes('1 ETH')); assert(text.includes('2.5'));
    assert.equal(text.filter(value => value === 'Last known balance').length, 2);
    assert(!text.some(value => value.includes('1,000.00') || value.includes('5.00 USD')));
    for (const symbol of ['ETH', 'TOK']) assert(tree.some(node => String(node.props.accessibilityLabel).startsWith(`${symbol}, Ethereum, `) && String(node.props.accessibilityLabel).endsWith(', Last known balance')));
    assert.equal(f.row.units, '1000000000000000000'); assert.equal(f.row.tokens[0]!.units, '250');
    f.setHidden(true);
    const hiddenTree = f.nodes(f.render());
    const labels = hiddenTree.map(node => node.props.accessibilityLabel).filter(value => typeof value === 'string');
    assert(labels.includes('ETH, Ethereum, ••••, Last known balance'));
    assert(labels.includes('TOK, Ethereum, ••••, Last known balance'));
    assert(!hiddenTree.flatMap(node => node.children).some(value => value === '1 ETH' || value === '2.5'));
  } finally { f.close(); }
});

test('an unavailable balance without a cached amount is not labelled as a last-known value', () => {
  const f = fixture('wallet', true);
  try {
    f.row.units = null as any; f.row.tokens[0]!.units = null as any;
    const text = f.nodes(f.render()).flatMap(node => node.children);
    assert.equal(text.filter(value => value === 'Balance unavailable').length, 2);
    assert(!text.includes('Last known balance'));
  } finally { f.close(); }
});

test('successful observations continue to show their fiat estimates', () => {
  const f = fixture('wallet');
  try {
    const text = f.nodes(f.render()).flatMap(node => node.children).filter(value => typeof value === 'string');
    assert(text.some(value => value.includes('1,000.00')));
    assert(text.some(value => value.includes('5.00 USD')));
    assert(!text.includes('Last known balance'));
  } finally { f.close(); }
});


test('wallet account identity has no control semantics when account management is unavailable', () => {
  const f = fixture('wallet');
  try {
    const tree = f.nodes(f.render());
    assert(tree.some(node => node.type === 'Text' && node.children.includes('Account 1')));
    assert(!tree.some(node => node.props.accessibilityLabel === 'Choose account, Account 1'));
    const identity = tree.find(node => node.type === 'View' && f.nodes(node).some(child => child.type === 'Icon' && child.props.name === 'wallet'));
    assert(identity);
    assert(!f.nodes(identity).some(node => node.type === 'Icon' && node.props.name === 'chevron-down'));
  } finally { f.close(); }
});

test('wallet account chooser remains actionable when account management is available', () => {
  let opened = 0;
  const f = fixture('wallet', false, () => { opened++; });
  try {
    const choice = f.nodes(f.render()).find(node => node.props.accessibilityLabel === 'Choose account, Account 1');
    assert(choice); assert.equal(choice.props.accessibilityRole, 'button');
    assert(f.nodes(choice).some(node => node.type === 'Icon' && node.props.name === 'chevron-down'));
    choice.props.onPress(); assert.equal(opened, 1);
  } finally { f.close(); }
});
