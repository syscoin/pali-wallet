import { SENTRY_NETWORKS } from '../../../source/shared/sentryNetworks.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { NativeSentryNodeManagement, SentryNodeLinkReview } from '../src/custody/sentryNodeManagement.ts';
import { createIdleComponentFixture } from './idleComponentFixture.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
type Snapshot = Awaited<ReturnType<NativeSentryNodeManagement['list']>>;
type Component = (props: any) => Element;
const node = Object.freeze({ proTxHash: 'ab'.repeat(32), collateralOutpoint: Object.freeze({ txid: 'cd'.repeat(32), vout: 2 }), service: '127.0.0.1:18369', nevmAddress: `0x${'12'.repeat(20)}` });
const reservation = Object.freeze({ ...node.collateralOutpoint, proTxHash: node.proTxHash });
const empty: Snapshot = { network: 'testnet', serviceUrl: 'https://sentry.example', linkedNodes: [], collateral: [] };
const review: SentryNodeLinkReview = Object.freeze({ id: 'review-1', origin: 'Pali Wallet', network: 'testnet', serviceUrl: empty.serviceUrl, node });
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
};
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

// The recovery screen's VM approach: run the actual component and idle wrappers,
// injecting only React hook scheduling and the native rendering/event surfaces.
function evaluate(source: string, dependencies: Record<string, unknown>, flow = false) {
  const require = createRequire(import.meta.url);
  const babelRequire = createRequire(require.resolve('babel-preset-expo'));
  const babel = babelRequire('@babel/core') as { transformSync(code: string, options: object): { code: string } };
  const code = flow ? babel.transformSync(source, { babelrc: false, configFile: false, plugins: [babelRequire.resolve('babel-plugin-syntax-hermes-parser'), babelRequire.resolve('@babel/plugin-transform-flow-strip-types'), babelRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code
    : ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} as Record<string, any> };
  runInNewContext(code, { module, exports: module.exports, Error, AbortController, performance, setTimeout, clearTimeout, queueMicrotask, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected screen import ${name}`); return dependencies[name];
  } });
  return module.exports;
}

function renderer() {
  const cells: Cell[] = [], layouts: (() => void)[] = [];
  let cursor = 0, active = 'active', hardware = () => {}, defaults = 0, dismisses = 0;
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const hook = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState(initial: unknown) { const c = cell(); if (!Object.hasOwn(c, 'value')) c.value = typeof initial === 'function' ? initial() : initial;
      return [c.value, (value: any) => { c.value = typeof value === 'function' ? value(c.value) : value; }]; },
    useRef(initial: unknown) { const c = cell(); c.value ??= { current: initial }; return c.value; },
    useCallback(callback: unknown, deps: readonly unknown[]) { const c = cell(); if (!c.deps || deps.length !== c.deps.length || deps.some((value, i) => !Object.is(value, c.deps![i]))) { c.value = callback; c.deps = deps; } return c.value; },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) { const c = cell(); if (deps && c.deps && deps.length === c.deps.length && deps.every((value, i) => Object.is(value, c.deps![i]))) return;
      c.deps = deps; layouts.push(() => { c.cleanup?.(); c.cleanup = callback() || undefined; }); },
  };
  const listeners = new Map<string, Set<(state: string) => void>>();
  const back = evaluate(readFileSync(new NodeURL('../node_modules/react-native/Libraries/Utilities/BackHandler.android.js', import.meta.url), 'utf8'), {
    '../../Libraries/NativeModules/specs/NativeDeviceEventManager': { invokeDefaultBackPressHandler() { defaults++; } },
    '../../src/private/webapis/dom/events/internals/EventInternals': { setEventInitTimeStamp() {} },
    '../EventEmitter/RCTDeviceEventEmitter': { addListener(_name: string, callback: () => void) { hardware = callback; } },
    './HardwareBackPressEvent': { HardwareBackPressEvent: class {} },
  }, true).default as { addEventListener(name: string, callback: () => boolean): { remove(): void } };
  const native = {
    Platform: { OS: 'android' }, BackHandler: back,
    AppState: { get currentState() { return active; }, addEventListener(event: string, listener: (state: string) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener);
      return { remove() { listeners.get(event)!.delete(listener); } };
    } },
    Keyboard: { dismiss() { dismisses++; } }, StyleSheet: { create: (value: unknown) => value },
    ...Object.fromEntries(['KeyboardAvoidingView', 'Text', 'TextInput', 'View', 'Switch', 'Pressable'].map(name => [name, name])),
  };
  const ui = { ...Object.fromEntries(['Button', 'Card', 'Header', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {} };
  const idle = createIdleComponentFixture(hook, native);
  const common = { '../../../../source/shared/sentryNetworks': { SENTRY_NETWORKS }, react: hook, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui, './IdleActivityBoundary': idle.components };
  const load = (name: string, additional: Record<string, unknown> = {}) => evaluate(readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8'), { ...common, ...additional });
  const nodes = load('NativeSentryNodes', { './PinEntry': { PinField: 'PinField' } }).NativeSentryNodes as Component;
  const hub = load('NativeSentryHub', { './NativeSentryKeys': { NativeSentryKeys: 'NativeSentryKeys' }, './NativeSentryNodes': { NativeSentryNodes: 'NativeSentryNodes' } }).NativeSentryHub as Component;
  const expand = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(expand);
    if (!value || typeof value !== 'object' || !('children' in value)) return value;
    const element = value as Element;
    if (typeof element.type === 'function') return expand(element.type({ ...element.props, children: element.children }));
    return { ...element, children: element.children.flat(Infinity).map(expand) };
  };
  return {
    nodes, hub, back,
    render(component: Component, props: object) { cursor = 0; const tree = component(props); layouts.splice(0).forEach(run => run()); return expand(tree) as Element; },
    emit(event: string, state = '') { if (event === 'change') active = state; for (const listener of [...listeners.get(event) ?? []]) listener(state); },
    hardware: () => hardware(), defaults: () => defaults, dismisses: () => dismisses,
    dispose() { for (const c of cells) c.cleanup?.(); },
    listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}
function all(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(all);
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const element = value as Element; return [element, ...element.children.flatMap(all)];
}
const text = (tree: unknown) => all(tree).flatMap(element => element.children.filter(value => typeof value === 'string' || typeof value === 'number')).join(' ');
function find(tree: Element, type: string, property?: string, value?: string) {
  const result = all(tree).find(element => element.type === type && (!property || element.props[property] === value));
  assert.ok(result, `Missing ${type} ${value ?? ''}`); return result;
}
const button = (tree: Element, title: string) => find(tree, 'Button', 'title', title);
const field = (tree: Element, label: string) => label === 'Wallet PIN' ? find(tree, 'PinField', 'label', label) : find(tree, 'TextInput', 'accessibilityLabel', label);
const press = (element: Element) => element.props.onPress({ nativeEvent: {} });
const goBack = (tree: Element) => find(tree, 'Header').props.onBack();

function fixture(options: { initial?: Snapshot; opening?: Promise<void>; preparing?: Promise<void>; confirming?: Promise<void>; releasing?: Promise<void>; openingFailure?: boolean; listFailureAt?: number } = {}) {
  const r = renderer();
  let snapshot: Snapshot = options.initial ?? empty, backs = 0, opened = 0;
  const calls = { list: 0, prepare: [] as { request: unknown; origin: string }[], confirm: [] as SentryNodeLinkReview[], cancel: [] as string[], release: [] as { reservation: unknown; password: string; acknowledgeNodeStops: boolean }[], dispose: 0, writes: 0 };
  const signals: AbortSignal[] = [], managers: NativeSentryNodeManagement[] = [];
  const open = async (signal: AbortSignal, check: () => void): Promise<NativeSentryNodeManagement> => {
    opened++; signals.push(signal);
    let disposed = false;
    const current = () => { check(); if (disposed) throw new Error('Manager disposed'); };
    const manager: NativeSentryNodeManagement = {
      async list() { calls.list++; current(); if (calls.list === options.listFailureAt) throw new Error('Private refresh error'); return snapshot; },
      async prepareLink(request, origin) { calls.prepare.push({ request, origin }); current(); await options.preparing; current(); return review; },
      async confirmLink(value) { calls.confirm.push(value); current(); await options.confirming; current(); calls.writes++; snapshot = { ...empty, linkedNodes: [node], collateral: [reservation] }; return { version: 1, linked: true, proTxHash: node.proTxHash, genesisHash: '01'.repeat(32) }; },
      cancelLink(id) { calls.cancel.push(id); },
      async releaseCollateral(value) { calls.release.push(value); current(); await options.releasing; current(); calls.writes++; snapshot = { ...empty, linkedNodes: [node], collateral: [] }; return value.reservation; },
      dispose() { disposed = true; calls.dispose++; },
    };
    managers.push(manager);
    if (options.openingFailure && opened === 1) throw new Error('Do not expose this private service error');
    await options.opening;
    return manager;
  };
  const props = { networkLabel: 'Syscoin Testnet', open, onBack: () => { backs++; } };
  return { ...r, calls, managers, signals, render: () => r.render(r.nodes, props), backs: () => backs, opened: () => opened };
}
async function ready(f: ReturnType<typeof fixture>) { f.render(); await settle(); return f.render(); }
async function reviewNode(f: ReturnType<typeof fixture>) {
  let tree = await ready(f); press(button(tree, 'Link a node')); tree = f.render();
  field(tree, 'Registration transaction ID').props.onChangeText(node.proTxHash);
  tree = f.render(); press(button(tree, 'Review node')); await settle(); return f.render();
}
async function releaseForm(f: ReturnType<typeof fixture>) {
  let tree = await ready(f); press(button(tree, 'Release collateral')); tree = f.render();
  find(tree, 'Switch', 'accessibilityLabel', 'Allow collateral spending').props.onValueChange(true);
  field(tree, 'Wallet PIN').props.onChange('123456'); return f.render();
}

test('hub routes node/key ports separately and keeps pane-close callback stable for leaf ownership', () => {
  const f = renderer(); let backs = 0;
  const openKeys = async () => { throw new Error('Hub must not open keys itself'); };
  const openNodes = async () => { throw new Error('Hub must not open nodes itself'); };
  const props = { networkLabel: 'Syscoin Testnet', openKeys, openNodes, onBack: () => { backs++; } };
  let tree = f.render(f.hub, props);
  press(find(tree, 'Row', 'title', 'Linked nodes'));
  tree = f.render(f.hub, props); const child = find(tree, 'NativeSentryNodes');
  assert.equal(child.props.open, openNodes); assert.equal(child.props.networkLabel, props.networkLabel);
  assert.equal(find(f.render(f.hub, props), 'NativeSentryNodes').props.onBack, child.props.onBack);
  child.props.onBack(); tree = f.render(f.hub, props);
  press(find(tree, 'Row', 'title', 'Authority keys')); tree = f.render(f.hub, props);
  const keys = find(tree, 'NativeSentryKeys'); assert.equal(keys.props.open, openKeys);
  keys.props.onBack(); f.render(f.hub, props); f.hardware();
  assert.equal(backs, 1); assert.equal(f.defaults(), 0); f.dispose();
});

test('node link displays exact reviewed fields, confirms that same object and refreshes persisted state', async () => {
  const f = fixture(); let tree = await reviewNode(f);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.prepare)), [{ request: { version: 1, proTxHash: node.proTxHash, genesisHash: SENTRY_NETWORKS.testnet.genesisHash }, origin: 'Pali Wallet' }]);
  for (const value of [review.serviceUrl, node.proTxHash, node.service, node.nevmAddress, `${node.collateralOutpoint.txid}:2`]) assert.ok(text(tree).includes(value), `Missing reviewed field ${value}: ${text(tree)}`);
  assert.equal(all(tree).filter(element => element.type === 'TextInput').length, 0);
  press(button(tree, 'Link node')); await settle(); tree = f.render();
  assert.equal(f.calls.confirm.length, 1); assert.equal(f.calls.confirm[0], review);
  assert.equal(f.calls.list, 2); assert.match(text(tree), /Node linked\. Collateral is protected\./);
  assert.match(text(tree), /Collateral protected/); press(button(tree, 'Refresh')); await settle(); f.render();
  assert.equal(f.calls.list, 3); f.dispose();
});

test('release clears its PIN and acknowledgement before awaiting authentication; double tap admits once', async () => {
  const pending = deferred<void>(); const f = fixture({ initial: { ...empty, collateral: [reservation] }, releasing: pending.promise });
  let tree = await releaseForm(f); const password = field(tree, 'Wallet PIN');
  assert.equal(password.type, 'PinField'); assert.equal(password.props.busy, false);
  const submit = button(tree, 'Release collateral'); assert.equal(submit.props.disabled, false); press(submit); press(submit);
  tree = f.render(); assert.equal(field(tree, 'Wallet PIN').props.value, '');
  assert.equal(find(tree, 'Switch', 'accessibilityLabel', 'Allow collateral spending').props.value, false);
  assert.equal(f.calls.release.length, 1); assert.equal(f.calls.release[0]!.password, '123456');
  assert.equal(f.calls.release[0]!.reservation, reservation); assert.equal(f.calls.release[0]!.acknowledgeNodeStops, true);
  assert.equal(button(tree, 'Releasing…').props.disabled, true); assert.equal(f.calls.list, 1); assert.ok(f.dismisses());
  pending.resolve(); await settle(); tree = f.render(); assert.equal(f.calls.list, 2); assert.match(text(tree), /Collateral protection released\./); f.dispose();
});

test('rapid review and confirmation taps cannot duplicate work, including stale buttons after completion', async () => {
  const preparing = deferred<void>(), confirming = deferred<void>(); const f = fixture({ preparing: preparing.promise, confirming: confirming.promise });
  let tree = await ready(f); press(button(tree, 'Link a node')); tree = f.render(); field(tree, 'Registration transaction ID').props.onChangeText(node.proTxHash);
  tree = f.render(); const prepare = button(tree, 'Review node'); press(prepare); press(prepare);
  assert.equal(f.calls.prepare.length, 1); preparing.resolve(); await settle(); tree = f.render();
  const confirm = button(tree, 'Link node'); press(confirm); press(confirm); assert.equal(f.calls.confirm.length, 1);
  confirming.resolve(); await settle(); tree = f.render(); press(confirm); press(prepare); await settle();
  assert.equal(f.calls.confirm.length, 1); assert.equal(f.calls.prepare.length, 1); assert.equal(f.calls.writes, 1); f.dispose();
});

test('Back from a reviewed node retires its manager and rejects the prior confirmation after reopening the list', async () => {
  const f = fixture(); let tree = await reviewNode(f); const stale = button(tree, 'Link node');
  f.hardware(); await settle(); tree = f.render(); assert.equal(f.backs(), 0); assert.equal(f.calls.dispose, 1); assert.equal(f.opened(), 2);
  assert.equal(f.signals[0]!.aborted, true); assert.equal(button(tree, 'Link a node').props.disabled, false);
  press(stale); await settle(); assert.equal(f.calls.confirm.length, 0); assert.equal(f.calls.writes, 0);
  f.hardware(); assert.equal(f.backs(), 1); assert.equal(f.defaults(), 0); f.dispose(); assert.equal(f.listeners(), 0);
});

test('Back clears a release password and rejects its prior submit under the replacement owner', async () => {
  const f = fixture({ initial: { ...empty, collateral: [reservation] } }); let tree = await releaseForm(f); const stale = button(tree, 'Release collateral');
  goBack(tree); await settle(); tree = f.render(); press(stale); await settle(); assert.equal(f.calls.release.length, 0);
  press(button(tree, 'Release collateral')); tree = f.render(); assert.equal(field(tree, 'Wallet PIN').props.value, '');
  assert.equal(find(tree, 'Switch', 'accessibilityLabel', 'Allow collateral spending').props.value, false); f.dispose();
});

for (const event of ['background', 'inactive', 'blur'] as const) test(`${event} closes the release pane, clears credentials and rejects late actions after focus`, async () => {
  const f = fixture({ initial: { ...empty, collateral: [reservation] } }); let tree = await releaseForm(f); const stale = button(tree, 'Release collateral');
  if (event === 'blur') f.emit('blur'); else f.emit('change', event);
  tree = f.render(); assert.ok(all(tree).filter(element => element.type === 'TextInput').every(element => element.props.value !== '123456')); assert.equal(f.calls.dispose, 1); assert.equal(f.backs(), 1);
  f.emit('change', 'active'); press(stale); await settle(); assert.equal(f.calls.release.length, 0); assert.equal(f.calls.writes, 0);
  f.dispose(); assert.equal(f.listeners(), 0);
});

for (const end of ['Back', 'background', 'unmount'] as const) test(`${end} disposes a manager that opens late without reading it`, async () => {
  const pending = deferred<void>(); const f = fixture({ opening: pending.promise }); f.render(); await settle(); const tree = f.render();
  if (end === 'Back') goBack(tree); else if (end === 'background') f.emit('change', 'background'); else f.dispose();
  assert.equal(f.signals[0]!.aborted, true); pending.resolve(); await settle();
  assert.equal(f.calls.dispose, 1); assert.equal(f.calls.list, 0); assert.equal(f.calls.writes, 0); f.dispose();
});

for (const action of ['prepare', 'confirm', 'release'] as const) test(`Back during ${action} disposes its owner and rejects a late result`, async () => {
  const pending = deferred<void>(); const f = fixture({ initial: { ...empty, collateral: [reservation] }, ...(action === 'prepare' ? { preparing: pending.promise } : action === 'confirm' ? { confirming: pending.promise } : { releasing: pending.promise }) });
  let tree: Element;
  if (action === 'release') { tree = await releaseForm(f); press(button(tree, 'Release collateral')); }
  else if (action === 'confirm') { tree = await reviewNode(f); press(button(tree, 'Link node')); }
  else { tree = await ready(f); press(button(tree, 'Link a node')); tree = f.render(); field(tree, 'Registration transaction ID').props.onChangeText(node.proTxHash); tree = f.render(); press(button(tree, 'Review node')); }
  tree = f.render(); goBack(tree); assert.equal(f.backs(), 1); assert.equal(f.calls.dispose, 1);
  pending.resolve(); await settle(); assert.equal(f.calls.writes, 0); assert.equal(f.calls.list, 1); f.dispose();
});

test('confirmation errors show safe recovery copy, never success, and cannot reuse a discarded review button', async () => {
  const pending = deferred<void>(); const f = fixture({ confirming: pending.promise }); let tree = await reviewNode(f); const stale = button(tree, 'Link node');
  press(stale); pending.reject(new Error('Do not expose this private service error')); await settle(); tree = f.render();
  assert.match(text(tree), /Could not complete the action/); assert.doesNotMatch(text(tree), /private service error|Node linked\./);
  assert.deepEqual(f.calls.cancel, [review.id]); press(stale); await settle(); assert.equal(f.calls.confirm.length, 1); assert.equal(f.calls.writes, 0); f.dispose();
});

test('a failed open renders a recoverable error and Refresh starts a fresh open', async () => {
  const f = fixture({ openingFailure: true }); let tree = await ready(f);
  assert.match(text(tree), /Could not complete the action/); assert.doesNotMatch(text(tree), /private service error/);
  assert.equal(button(tree, 'Refresh').props.disabled, false); press(button(tree, 'Refresh')); await settle(); tree = f.render();
  assert.equal(f.opened(), 2); assert.equal(button(tree, 'Link a node').props.disabled, false); f.dispose();
});

test('a failed refresh after a confirmed link never retries the commit or reports a false success', async () => {
  const f = fixture({ listFailureAt: 2 }); let tree = await reviewNode(f); const stale = button(tree, 'Link node');
  press(stale); await settle(); tree = f.render();
  assert.equal(f.calls.writes, 1); assert.match(text(tree), /Could not complete the action/);
  assert.doesNotMatch(text(tree), /Private refresh error|Node linked\./); press(stale); await settle(); assert.equal(f.calls.confirm.length, 1);
  press(button(tree, 'Refresh')); await settle(); tree = f.render(); assert.match(text(tree), /Collateral protected/); assert.equal(f.calls.writes, 1); f.dispose();
});

test('a refused release clears credentials and a new release form requires password and acknowledgement again', async () => {
  const pending = deferred<void>(); const f = fixture({ initial: { ...empty, collateral: [reservation] }, releasing: pending.promise });
  let tree = await releaseForm(f); const stale = button(tree, 'Release collateral'); press(stale);
  pending.reject(new Error('Private password error')); await settle(); tree = f.render();
  assert.match(text(tree), /Could not complete the action/); assert.doesNotMatch(text(tree), /Private password error|Collateral protection released\./);
  press(stale); await settle(); assert.equal(f.calls.release.length, 1); assert.equal(f.calls.writes, 0);
  press(button(tree, 'Release collateral')); tree = f.render(); assert.equal(field(tree, 'Wallet PIN').props.value, '');
  assert.equal(find(tree, 'Switch', 'accessibilityLabel', 'Allow collateral spending').props.value, false); assert.equal(button(tree, 'Release collateral').props.disabled, true); f.dispose();
});
