import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as core from '../src/core/index.ts';
import { WatchAccounts } from '../src/core/watchAccounts.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';

const require = createRequire(import.meta.url);
// Use the declared Expo Babel preset's toolchain to strip the installed RN Flow
// module. The dispatcher below is RN's real reverse-order implementation.
const requireBabel = createRequire(require.resolve('babel-preset-expo'));
const babel = requireBabel('@babel/core') as { transformSync(source: string, options: object): { code: string } };
type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
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
  runInNewContext(code, { module, exports: module.exports, console, setTimeout, clearTimeout,
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
  return { api: loaded.default, dispatch: () => dispatch(), defaults: () => defaultCalls };
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
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => { cell(); return snapshot(); },
  };
  return { api, instance,
    render(owner: Instance, component: Component, props: Record<string, unknown>) {
      current = owner; owner.next = 0;
      const result = component(props); owner.layouts.splice(0).forEach((run) => run()); return result;
    },
    flush(owner: Instance) { owner.effects.splice(0).forEach((run) => run()); },
    dispose(owner: Instance) { owner.cells.forEach((hook) => hook.cleanup?.()); },
  };
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
function press(element: Element) { return (element.props.onPress as () => void)(); }
function control(tree: Element, label: string) { return get(tree, (element) => element.props.accessibilityLabel === label); }
function named(tree: Element, text: string) {
  return get(tree, (element) => typeof element.props.onPress === 'function' && !!find(element, (child) => child.children.includes(text)));
}

async function fixture(path: 'app' | 'accounts', order: 'parent-first' | 'child-first') {
  const back = backHandler(); const render = renderer();
  const parent = render.instance(); const child = render.instance();
  const ui = Object.fromEntries(['Icon', 'PaliMark', 'Button', 'Card', 'Header', 'Notice', 'Screen', 'Text', 'Row', 'Label', 'Coin'].map((name) => [name, name]));
  Object.assign(ui, { colors: {}, styles: {} });
  const native = { Platform: { OS: 'android' }, BackHandler: back.api,
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: (value: unknown) => value }, Share: {},
    ...Object.fromEntries(['View', 'Pressable', 'ScrollView', 'TextInput', 'Text', 'Modal', 'KeyboardAvoidingView', 'ActivityIndicator'].map((name) => [name, name])),
  };
  const source = (name: string) => readFileSync(new NodeURL(`../${name}`, import.meta.url), 'utf8');
  const onboarding = evaluate(source('src/screens/Onboarding.tsx'), {
    react: render.api, 'react-native': native, '../ui': ui,
    '../core/watchOnlyAuthority': core, '../core/networks': core, '../core/utxoNetworks': { getUtxoNetwork },
  });
  const AddWatch = onboarding.AddWatchAccount as Component;
  const accounts = evaluate(source('src/screens/WalletAccounts.tsx'), {
    react: render.api, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    '../core/accountDirectory': { projectAccounts: () => [], accountIdentity: () => '' }, './Onboarding': onboarding, '../core/networks': core,
  });
  // Only expose the real internal component to this VM; production exports stay unchanged.
  const app = evaluate(`${source('App.tsx')}\nexport { AppContent };`, {
    react: render.api, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider' },
    'expo-status-bar': { StatusBar: 'StatusBar' }, 'expo-clipboard': {}, 'react-native-qrcode-svg': 'QRCode', './src/ui': ui,
    './src/screens/Onboarding': onboarding, './src/screens/NativeWallet': {}, './src/screens/WalletAccounts': accounts,
    './src/screens/WatchAccountPortfolio': {}, './src/core/watchAccounts': { WatchAccounts }, './src/core/accountDirectory': {},
    './src/design/Studio': {}, './src/screens/Settings': {}, './src/core/index': core,
    './src/platform': { loadPublicAccounts: async () => [], compareAndSetPublicAccounts: async () => {},
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
  else press(get(parentTree, (element) => element.props.title === 'Watch an address'));
  parentTree = render.render(parent, parentComponent, parentProps);
  const nested = get(parentTree, (element) => element.type === AddWatch);
  let finish: (error: Error) => void = () => assert.fail('No pending save');
  let saves = 0;
  const childProps = { ...nested.props, onAdd: () => { saves++; return new Promise<void>((_resolve, reject) => { finish = reject; }); } };
  let childTree = render.render(child, AddWatch, childProps);
  for (const owner of order === 'parent-first' ? [parent, child] : [child, parent]) render.flush(owner);
  const update = () => {
    parentTree = render.render(parent, parentComponent, parentProps); childTree = render.render(child, AddWatch, childProps);
    render.flush(parent); render.flush(child); return childTree;
  };
  const isOpen = () => !!find(render.render(parent, parentComponent, parentProps), (element) => element.type === AddWatch);
  const review = () => {
    press(control(childTree, 'Bitcoin')); update();
    (control(childTree, 'Account name').props.onChangeText as (text: string) => void)('Public BTC');
    (control(childTree, 'Public Bitcoin address').props.onChangeText as (text: string) => void)('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    update(); press(named(childTree, 'Review address')); update();
    assert.ok(find(childTree, (element) => element.children.includes('Check your watch account')));
  };
  return { back, review, update, isOpen, tree: () => childTree, saves: () => saves, finish: () => finish(new Error('Synthetic save failure')), exited: () => exited,
    dispose() { render.dispose(child); render.dispose(parent); },
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
        assert.equal(control(edited, 'Public Bitcoin address').props.value, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
        assert.ok(find(edited, (element) => element.children.includes('Watch an address')));
        screen.back.dispatch(); assert.equal(screen.isOpen(), false, 'Second Back cancels the editable form');
        assert.equal(screen.exited(), 0, 'Accounts itself must remain open'); assert.equal(screen.back.defaults(), 0);
      } finally { screen.dispose(); }
    });
    test(`${path}: Android Back is consumed throughout a pending save (${order})`, async () => {
      const screen = await fixture(path, order);
      try {
        screen.review(); press(named(screen.tree(), 'Confirm watch account'));
        // The synchronous guard must cover the window before submitting renders.
        screen.back.dispatch(); assert.equal(screen.isOpen(), true);
        const pending = screen.update(); assert.equal(control(pending, 'Back').props.disabled, true);
        screen.back.dispatch(); assert.equal(screen.isOpen(), true);
        assert.ok(find(screen.update(), (element) => element.children.includes('Check your watch account')));
        assert.equal(screen.saves(), 1); assert.equal(screen.back.defaults(), 0);
        screen.finish(); await new Promise<void>((resolve) => setImmediate(resolve)); screen.update();
        screen.back.dispatch(); const edited = screen.update(); assert.equal(screen.isOpen(), true);
        assert.ok(find(edited, (element) => element.children.includes('Watch an address')));
        screen.back.dispatch(); assert.equal(screen.isOpen(), false);
      } finally { screen.dispose(); }
    });
  }
}
