import * as pairingLinks from '../src/connections/pairingLinks.ts';
import * as sharedHistory from '../../../source/shared/evmHistory.ts';
import * as syscoinAssetIds from '../../../source/shared/syscoinAssetIds.ts';
import * as sptInventory from '../../../source/shared/sptInventory.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createIdleComponentFixture, expandIdleElements } from './idleComponentFixture.ts';
import * as core from '../src/core/index.ts';
import { WatchAccounts } from '../src/core/watchAccounts.ts';
import { canUseUtxoCustodyAddress } from '../src/core/utxoAddresses.ts';
import { UTXO_NETWORKS, findUtxoNetwork, getUtxoNetwork, isCustomUtxoNetworkId } from '../src/core/utxoNetworks.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { TabDeparture } from '../src/navigation/tabDeparture.ts';
import type { ShellLeafNavigation, RealTab } from '../src/screens/RealAppShell';
import type { NativeActivitySnapshot } from '../src/activity/nativeActivity.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';

const require = createRequire(import.meta.url);
// Use the declared Expo Babel preset's toolchain to strip the installed RN Flow
// module. The dispatcher below is RN's real reverse-order implementation.
const requireBabel = createRequire(require.resolve('babel-preset-expo'));
const babel = requireBabel('@babel/core') as { transformSync(source: string, options: object): { code: string } };
type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type BackApi = { addEventListener(name: string, handler: () => boolean): { remove(): void } };
type Component = (props: Record<string, unknown>) => Element;
type Cell = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { cells: Cell[]; next: number; effects: (() => void)[]; layouts: (() => void)[] };

function evaluate(source: string, dependencies: Record<string, unknown>, flow = false) {
  const module = { exports: {} as Record<string, unknown> };
  const code = flow ? babel.transformSync(source, {
    babelrc: false, configFile: false,
    plugins: [requireBabel.resolve('babel-plugin-syntax-hermes-parser'), requireBabel.resolve('@babel/plugin-transform-flow-strip-types'), requireBabel.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code : ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  runInNewContext(code, { module, exports: module.exports, console, setTimeout, clearTimeout, AbortController,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`); return dependencies[name]; },
  });
  return module.exports;
}
function backHandler() {
  let dispatch: () => void = () => assert.fail('Missing RN dispatcher');
  let defaultCalls = 0;
  const loaded = evaluate(readFileSync(new NodeURL('../node_modules/react-native/Libraries/Utilities/BackHandler.android.js', import.meta.url), 'utf8'), {
    '../../Libraries/NativeModules/specs/NativeDeviceEventManager': { invokeDefaultBackPressHandler() { defaultCalls++; } },
    '../../src/private/webapis/dom/events/internals/EventInternals': { setEventInitTimeStamp() {} },
    '../EventEmitter/RCTDeviceEventEmitter': { addListener(name: string, callback: () => void) { assert.equal(name, 'hardwareBackPress'); dispatch = callback; } },
    './HardwareBackPressEvent': { HardwareBackPressEvent: class {} },
  }, true);
  return { api: loaded.default as BackApi, dispatch: () => dispatch(), defaults: () => defaultCalls };
}
function renderer() {
  let current: Instance;
  const instance = (): Instance => ({ cells: [], next: 0, effects: [], layouts: [] });
  const cell = () => current.cells[current.next++] ?? (current.cells[current.next - 1] = {});
  const effect = (callback: () => void | (() => void), deps: readonly unknown[] | undefined, layout: boolean) => {
    const hook = cell();
    if (deps && hook.deps && deps.length === hook.deps.length && deps.every((value, index) => Object.is(value, hook.deps![index]))) return;
    hook.deps = deps;
    current[layout ? 'layouts' : 'effects'].push(() => { hook.cleanup?.(); hook.cleanup = callback() || undefined; });
  };
  const api = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState<T>(initial: T | (() => T)) {
      const hook = cell();
      if (!Object.hasOwn(hook, 'value')) hook.value = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hook.value as T, (value: T | ((old: T) => T)) => { hook.value = typeof value === 'function' ? (value as (old: T) => T)(hook.value as T) : value; }];
    },
    useRef<T>(initial: T) { const hook = cell(); hook.value ??= { current: initial }; return hook.value; },
    useEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) => effect(callback, deps, false),
    useLayoutEffect: (callback: () => void | (() => void), deps?: readonly unknown[]) => effect(callback, deps, true),
    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const hook = cell();
      if (!hook.deps || deps.some((value, index) => !Object.is(value, hook.deps![index]))) { hook.value = callback; hook.deps = deps; }
      return hook.value;
    },
    useMemo<T>(factory: () => T, deps: readonly unknown[]) {
      const hook = cell();
      if (!hook.deps || deps.some((value, index) => !Object.is(value, hook.deps![index]))) { hook.value = factory(); hook.deps = deps; }
      return hook.value;
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => { cell(); return snapshot(); },
  };
  return { api, instance,
    render(owner: Instance, component: Component, props: Record<string, unknown>) {
      current = owner; owner.next = 0;
      const result = component(props); owner.layouts.splice(0).forEach((run) => run()); return expandIdleElements(result);
    },
    flush(owner: Instance) { owner.effects.splice(0).forEach((run) => run()); },
    dispose(owner: Instance) { owner.cells.forEach((hook) => hook.cleanup?.()); },
  };
}

for (const kind of ['native', 'smart', 'smart-signable', 'watch', 'activity'] as const) {
  for (const order of ['parent-first', 'child-first'] as const) {
    test(`${kind} real screen and shell consume nested Back before exit (${order})`, async () => {
      const back = backHandler(); const render = renderer();
      type Subscription = { remove(): void };
      type BackApi = { addEventListener(name: string, handler: () => boolean): Subscription };
      const actual = back.api as BackApi;
      let owner: 'parent' | 'child' = 'parent';
      const subscriptions: { owner: 'parent' | 'child'; handler: () => boolean; actual: Subscription; removed: boolean }[] = [];
      const observedBack = { addEventListener(name: string, handler: () => boolean) {
        const subscription = { owner, handler, actual: actual.addEventListener(name, handler), removed: false };
        subscriptions.push(subscription);
        return { remove() { subscription.removed = true; subscription.actual.remove(); } };
      } };
      const native = { Platform: { OS: 'android' }, BackHandler: observedBack,
        AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
        StyleSheet: { create: (value: unknown) => value }, Share: {}, Linking: {},
        useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
        ...Object.fromEntries(['View', 'ActivityIndicator', 'FlatList', 'Modal', 'Pressable', 'ScrollView'].map((name) => [name, name])),
      };
      const ui = { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'IconButton', 'Notice', 'Row', 'Screen', 'SegmentedControl', 'Text'].map((name) => [name, name])), colors: {}, styles: {} };
      const load = (name: string) => readFileSync(new NodeURL(`../${name}`, import.meta.url), 'utf8');
      const hooks = evaluate(load('src/screens/useRealShell.ts'), { react: render.api, 'react-native': native, '../navigation/tabDeparture': { TabDeparture } });
      const idle = createIdleComponentFixture(render.api, native);
      const activityListRow = evaluate(load('src/screens/ActivityListRow.tsx'), {
        react: render.api, 'react-native': native, '../ui': ui, './IdleActivityBoundary': idle.components,
      });
      const dependencies = { '../platform/localization': nativeTranslationFixture, '../../../../source/shared/evmHistory': sharedHistory, './IdleActivityBoundary': idle.components, react: render.api, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        'expo-clipboard': {}, 'react-native-qrcode-svg': 'QRCode', '../ui': ui, '../core/amounts': core, '../core/networks': core,
        '../core/utxoAddresses': { canUseUtxoCustodyAddress },
        '../core/utxoNetworks': { findUtxoNetwork, getUtxoNetwork }, '../core/watchOnlyAuthority': core,
        '../custody/networkContext': { getNativeNetwork: () => ({ id: 'ethereum' }), getNativeSendContext: () => ({ networkId: 'ethereum', name: 'Ethereum', symbol: 'ETH', decimals: 18 }), nativeSigningEnabled: () => kind === 'smart-signable' },
        '../custody/testnetFaucet': { getTestnetFaucet: () => null }, './TestnetFaucetCard': {},
        './PortfolioQuote': evaluate(load('src/screens/PortfolioQuote.tsx'), { react: render.api, 'react-native': native, '../ui': ui }),
        './NativeTokens': { NativeTokens: 'NativeTokens' }, '../platformRpc': {}, '../platform/http': {}, '../portfolio/nativePortfolio': {},
        '../portfolio/AssetMarketCard': { AssetMarketCard: 'AssetMarketCard' },
        '../portfolio/useNativeCoinQuote': { useNativeCoinQuote: () => ({ supported: false, quote: null }) },
        './ActivityListRow': activityListRow,
        '../activity/activityAmountLabel': { compactActivityAmountLabel },
        '../../../../source/shared/erc20': {},
        '../../../../source/shared/syscoinAssetIds': syscoinAssetIds,
        '../../../../source/shared/sptInventory': sptInventory,
        './NativeSptAssets': { NativeSptAssets: 'NativeSptAssets' },
      };
      const source = (kind === 'native' || kind === 'smart' || kind === 'smart-signable') ? load('src/screens/NativePortfolio.tsx') + '\nexport { NativePortfolioContent };'
        : kind === 'activity' ? load('src/screens/NativeActivity.tsx') + '\nexport { NativeActivityContent };' : load('src/screens/WatchAccountPortfolio.tsx');
      const exports = evaluate(source, dependencies);
      const leaf = ((kind === 'native' || kind === 'smart' || kind === 'smart-signable') ? exports.NativePortfolioContent : kind === 'activity' ? exports.NativeActivityContent : exports.WatchAccountPortfolio) as Component;
      let exits = 0, sent = 0, tokenSent = 0, collectibleSent = 0;
      let shell!: { tab: RealTab; goBack(): void; select(tab: RealTab): void; finishLeave(tab: RealTab): void; navigation: ShellLeafNavigation };
      const parent = render.instance(), child = render.instance();
      const Root = () => {
        shell = (hooks.useRealShell as (scope: string, current: () => string, exit: () => void) => typeof shell)('watch/ethereum', () => 'watch/ethereum', () => { exits++; });
        render.api.useEffect(() => { const subscription = observedBack.addEventListener('hardwareBackPress', () => { shell.goBack(); return true; }); return () => subscription.remove(); }, []);
        return { type: 'root', props: {}, children: [] };
      };
      render.render(parent, Root, {}); render.flush(parent);
      if (kind === 'activity') { shell.select('activity'); render.render(parent, Root, {}); render.flush(parent); }
      const account = core.createWatchAccount('watch', 'Public account', '0x1111111111111111111111111111111111111111');
      const authority = new core.WatchOnlyAuthority([account], { async readBalance() { return { chainId: 1, units: '0' }; } });
      authority.unlock(); await authority.refresh();
      const props = () => (kind === 'native' || kind === 'smart' || kind === 'smart-signable') ? {
        model: { isCurrent: () => true, getNetworkRegistration: () => ({ id: 'ethereum' }), getUtxoNetwork: () => findUtxoNetwork('ethereum') }, snapshot: { account: { address: account.addresses.ethereum, network: 'ethereum', revision: 1 }, status: 'available', units: '0', updatedAt: 1 },
        accountLabel: 'Public account', onExit() { exits++; }, onLock() {}, onViewRecovery() {}, navigation: shell.navigation,
        ...((kind === 'smart' || kind === 'smart-signable') ? { smartAccount: { chainId: 1, isDeployed: true, localEcdsa: false, managementAddress: '0x2222222222222222222222222222222222222222' }, onSend() { if (kind !== 'smart-signable') assert.fail('Smart account must not enter EOA send'); sent++; },
          ...(kind === 'smart-signable' ? { tokenView: {}, onSendToken() { tokenSent++; }, onSendCollectible() { collectibleSent++; } } : {}) } : {}),
      } : kind === 'activity' ? { controller: { async setView() {} },
        snapshot: { status: 'ready', rows: [], accountAddress: account.addresses.ethereum!, view: { filter: 'all', showZero: false, anchor: null, offset: 0 },
          scopeKey: 'public-back-fixture', chainId: '1', networkName: 'Ethereum', nativeSymbol: 'ETH', explorerUrl: null,
          loadingMore: false, hasMore: false, error: null, coverage: 'Direct transactions and ERC20 transfer events from the selected network are included.',
          truncated: false, canViewSavedPending: false, savedPending: undefined } satisfies NativeActivitySnapshot,
        accountLabel: 'Public account', onBack: () => shell.finishLeave('wallet'), navigation: shell.navigation,
      } : { authority, onAccounts() {}, onExit() { exits++; }, onLock() {}, navigation: shell.navigation };
      owner = 'child'; let tree = render.render(child, leaf, props()); render.flush(child);
      if (kind === 'smart-signable') {
        press(get(tree, element => element.props.title === 'Send')); assert.equal(sent, 1);
        const tokens = get(tree, element => element.type === 'NativeTokens');
        assert(typeof tokens.props.onSend === 'function'); assert(typeof tokens.props.onSendCollectible === 'function');
        tokens.props.onSend({symbol:'PUBLIC'}); tokens.props.onSendCollectible({contractAddress:'public'});
        assert.equal(tokenSent, 1); assert.equal(collectibleSent, 1);
        assert(!JSON.stringify(tree).includes('signing is not yet available'));
        tree = render.render(child, leaf, {...props(),onSend:undefined,onSendToken:undefined,onSendCollectible:undefined}); render.flush(child);
        assert.equal(find(tree, element => element.props.title === 'Send'), undefined);
        assert.equal(get(tree, element => element.type === 'NativeTokens').props.onSend, undefined);
        assert.equal(get(tree, element => element.type === 'NativeTokens').props.onSendCollectible, undefined);
        tree = render.render(child, leaf, props()); render.flush(child);
      }
      if (kind !== 'activity') {
        if (kind === 'smart') assert.equal(find(tree, (element) => element.props.title === 'Send'), undefined);
        press(get(tree, (element) => element.props.title === 'Receive'));
        tree = render.render(child, leaf, props()); render.flush(child);
        if (kind === 'smart') assert.equal(get(tree, (element) => element.type === 'QRCode').props.value, account.addresses.ethereum);
      }
      const active = subscriptions.filter((subscription) => !subscription.removed);
      active.forEach((subscription) => subscription.actual.remove());
      active.sort((a, b) => (a.owner === (order === 'parent-first' ? 'parent' : 'child') ? -1 : 1) - (b.owner === (order === 'parent-first' ? 'parent' : 'child') ? -1 : 1));
      assert.deepEqual(active.map((subscription) => subscription.owner), order === 'parent-first' ? ['parent', 'child'] : ['child', 'parent']);
      active.forEach((subscription) => { subscription.actual = actual.addEventListener('hardwareBackPress', subscription.handler); });
      try {
        back.dispatch(); await new Promise<void>((resolve) => setImmediate(resolve));
        if (kind === 'activity') {
          render.render(parent, Root, {}); render.flush(parent); assert.equal(shell.tab, 'wallet'); render.dispose(child);
        } else {
          tree = render.render(child, leaf, props()); render.flush(child); assert.ok(find(tree, (element) => element.props.title === 'Receive'));
        }
        assert.equal(exits, 0);
        back.dispatch(); assert.equal(exits, 1); assert.equal(back.defaults(), 0);
      } finally {
        render.dispose(child); render.dispose(parent); back.dispatch(); assert.equal(back.defaults(), 1);
      }
    });
  }
}
function find(tree: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return;
  const element = tree as Element;
  if (predicate(element)) return element;
  for (const child of element.children.flat(Infinity)) { const hit = find(child, predicate); if (hit) return hit; }
}
function get(tree: Element, predicate: (element: Element) => boolean): Element {
  const found = find(tree, predicate); assert.ok(found, 'Expected rendered element'); return found;
}
function press(element: Element) { return (element.props.onPress as (event: object) => void)({ nativeEvent: {} }); }
function control(tree: Element, label: string) { return get(tree, (element) => element.props.accessibilityLabel === label); }
function named(tree: Element, text: string) {
  return get(tree, (element) => typeof element.props.onPress === 'function' && !!find(element, (child) => child.children.includes(text)));
}

async function fixture(path: 'app' | 'accounts', order: 'parent-first' | 'child-first') {
  const back = backHandler(); const render = renderer();
  let registrationOwner: 'parent' | 'child' = 'parent';
  const registrations: { owner: 'parent' | 'child'; name: string; handler: () => boolean; actual: { remove(): void }; removed: boolean }[] = [];
  const observedBack = { ...back.api, addEventListener(name: string, handler: () => boolean) {
    const registration = { owner: registrationOwner, name, handler,
      actual: back.api.addEventListener(name, handler), removed: false };
    registrations.push(registration);
    return { remove() { registration.removed = true; registration.actual.remove(); } };
  } };
  const parent = render.instance(); const child = render.instance();
  const ui = Object.fromEntries(['Icon', 'PaliMark', 'Button', 'Card', 'Header', 'IconButton', 'Notice', 'Screen', 'Text', 'Row', 'Label', 'Coin'].map((name) => [name, name]));
  Object.assign(ui, { colors: {}, styles: {} });
  const native = { Platform: { OS: 'android' }, BackHandler: observedBack,
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    Linking: { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (value: unknown) => value }, Share: {},
    ...Object.fromEntries(['View', 'Pressable', 'ScrollView', 'TextInput', 'Text', 'Modal', 'KeyboardAvoidingView', 'ActivityIndicator'].map((name) => [name, name])),
  };
  const source = (name: string) => readFileSync(new NodeURL(`../${name}`, import.meta.url), 'utf8');
  const idle = createIdleComponentFixture(render.api, native);
  await idle.ready;
  const onboarding = evaluate(source('src/screens/Onboarding.tsx'), {
    '../platform/localization': nativeTranslationFixture,
    './IdleActivityBoundary': idle.components,
    react: render.api, 'react-native': native, '../ui': ui,
    '../core/watchOnlyAuthority': core, '../core/utxoNetworks': { UTXO_NETWORKS, getUtxoNetwork, isCustomUtxoNetworkId }, './WatchNetworks': {}, '../core/utxoIdentifier': { parseUtxoPublicIdentifier },
  });
  const AddWatch = onboarding.AddWatchAccount as Component;
  const accounts = evaluate(source('src/screens/WalletAccounts.tsx'), {
    './IdleActivityBoundary': idle.components,
    react: render.api, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    '../core/accountDirectory': { projectAccounts: () => [], accountIdentity: () => '' }, './Onboarding': onboarding, '../core/networks': core,
  });
  // Only expose the real internal component to this VM; production exports stay unchanged.
  const app = evaluate(`${source('App.tsx')}\nexport { AppContent };`, {
    './src/connections/pairingLinks': pairingLinks,
    './src/platform/security': idle.security, './src/screens/IdleActivityBoundary': idle.components,
    react: render.api, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider' },
    'expo-status-bar': { StatusBar: 'StatusBar' }, 'expo-clipboard': {}, 'react-native-qrcode-svg': 'QRCode', './src/ui': ui,
    './src/screens/Onboarding': onboarding, './src/screens/NativeWallet': {}, './src/screens/WalletAccounts': accounts,
    './src/screens/WatchSession': {}, './src/core/watchAccounts': { WatchAccounts }, './src/core/accountDirectory': {},
    './src/design/Studio': {}, './src/screens/Settings': {}, './src/core/index': core,
    './src/platform': { publicAccountRecords: { assertNetworkCurrent() {}, load: async () => ({ version: 1, records: [], accounts: [], utxoNetworks: UTXO_NETWORKS }), compareAndSet: async () => ({ version: 1, records: [], accounts: [], utxoNetworks: UTXO_NETWORKS }) },
      loadAccountSelection: async () => null, saveAccountSelection: async () => {}, balanceReader: {}, isNativePersistence: false },
  });
  let exited = 0;
  const parentComponent = (path === 'app' ? app.AppContent : accounts.WalletAccounts) as Component;
  const parentProps = path === 'app' ? { availableWatchNetworks: ['evm', 'syscoin', 'bitcoin'] } : {
    catalogue: null, watch: { status: 'ready', accounts: [], busy: false }, active: null,
    onBack: () => { exited++; }, onAdd: async () => {}, availableWatchNetworks: ['evm', 'syscoin', 'bitcoin'],
  };
  let parentTree = render.render(parent, parentComponent, parentProps); render.flush(parent);
  // The real App startup loads the empty public store before displaying Welcome.
  await new Promise<void>((resolve) => setImmediate(resolve));
  parentTree = render.render(parent, parentComponent, parentProps); render.flush(parent);
  if (path === 'app') (get(parentTree, (element) => element.type === onboarding.Welcome).props.onWatch as () => void)();
  else press(get(parentTree, (element) => element.props.title === 'Watch an account'));
  parentTree = render.render(parent, parentComponent, parentProps);
  const nested = get(parentTree, (element) => element.type === AddWatch);
  let finish: (error: Error) => void = () => assert.fail('No pending save');
  let saves = 0;
  const childProps = { ...nested.props, onAdd: () => { saves++; return new Promise<void>((_resolve, reject) => { finish = reject; }); } };
  let childTree = render.render(child, AddWatch, childProps);
  for (const owner of order === 'parent-first' ? [parent, child] : [child, parent]) {
    registrationOwner = owner === parent ? 'parent' : 'child'; render.flush(owner);
  }
  // A mounted Accounts parent naturally registers before its new Add child.
  // Remove and reinstall actual RN handlers to exercise the opposite order too.
  const activeRegistrations = registrations.filter((registration) => !registration.removed);
  assert.deepEqual(activeRegistrations.map((r) => r.owner).sort(), path === 'accounts' ? ['child', 'parent'] : ['child']);
  for (const registration of activeRegistrations) registration.actual.remove();
  activeRegistrations.sort((a, b) => order === 'parent-first'
    ? (a.owner === 'parent' ? -1 : 1) - (b.owner === 'parent' ? -1 : 1)
    : (a.owner === 'child' ? -1 : 1) - (b.owner === 'child' ? -1 : 1));
  for (const registration of activeRegistrations) registration.actual = back.api.addEventListener(registration.name, registration.handler);
  assert.deepEqual(activeRegistrations.map((r) => r.owner), path === 'accounts'
    ? (order === 'parent-first' ? ['parent', 'child'] : ['child', 'parent']) : ['child']);
  const update = () => {
    parentTree = render.render(parent, parentComponent, parentProps); childTree = render.render(child, AddWatch, childProps);
    render.flush(parent); render.flush(child); return childTree;
  };
  const isOpen = () => !!find(render.render(parent, parentComponent, parentProps), (element) => element.type === AddWatch);
  const review = () => {
    press(control(childTree, 'Bitcoin')); update();
    (control(childTree, 'Account name').props.onChangeText as (text: string) => void)('Public BTC');
    (control(childTree, 'Public address, account key or descriptor').props.onChangeText as (text: string) => void)('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    update(); press(named(childTree, 'Review account')); update();
    assert.ok(find(childTree, (element) => element.children.includes('Check your watch account')));
  };
  return { back, review, update, isOpen, tree: () => childTree, saves: () => saves, finish: () => finish(new Error('Synthetic save failure')), exited: () => exited,
    dispose() { render.dispose(child); render.dispose(parent); back.dispatch(); assert.equal(back.defaults(), 1, 'Every handler must be removed on unmount'); },
  };
}

for (const path of ['app', 'accounts'] as const) {
  for (const order of ['parent-first', 'child-first'] as const) {
    test(`${path}: Android Back returns review→edit→cancel (${order})`, async () => {
      const screen = await fixture(path, order);
      try {
        screen.review(); screen.back.dispatch(); const edited = screen.update();
        assert.equal(screen.isOpen(), true, 'Hardware Back must keep the add form open at review');
        assert.equal(control(edited, 'Account name').props.value, 'Public BTC');
        assert.equal(control(edited, 'Public address, account key or descriptor').props.value, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
        assert.ok(find(edited, (element) => element.children.includes('Watch an account')));
        screen.back.dispatch(); assert.equal(screen.isOpen(), false, 'Second Back cancels the editable form');
        assert.equal(screen.exited(), 0, 'Accounts itself must remain open'); assert.equal(screen.back.defaults(), 0);
      } finally { screen.dispose(); }
    });
    test(`${path}: Android Back is consumed throughout a pending save (${order})`, async () => {
      const screen = await fixture(path, order);
      try {
        screen.review(); press(named(screen.tree(), 'Confirm watch account'));
        // Exercise both event sources before React has rerendered disabled controls.
        press(control(screen.tree(), 'Back'));
        press(named(screen.tree(), 'Confirm watch account'));
        assert.equal(screen.saves(), 1);
        // The synchronous guard must cover the window before submitting renders.
        screen.back.dispatch(); assert.equal(screen.isOpen(), true);
        const pending = screen.update(); assert.equal(control(pending, 'Back').props.disabled, true);
        screen.back.dispatch(); assert.equal(screen.isOpen(), true);
        assert.ok(find(screen.update(), (element) => element.children.includes('Check your watch account')));
        assert.equal(screen.saves(), 1); assert.equal(screen.back.defaults(), 0);
        screen.finish(); await new Promise<void>((resolve) => setImmediate(resolve)); screen.update();
        screen.back.dispatch(); const edited = screen.update(); assert.equal(screen.isOpen(), true);
        assert.ok(find(edited, (element) => element.children.includes('Watch an account')));
        screen.back.dispatch(); assert.equal(screen.isOpen(), false);
      } finally { screen.dispose(); }
    });
  }
}
