import * as passwordPolicy from '../src/custody/password.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createIdleComponentFixture } from './idleComponentFixture.ts';
import { findUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { NativeControllerLifecycle } from '../src/custody/nativeControllerLifecycle.ts';
import { NativeRecoveryFlow } from '../src/custody/recoveryFlow.ts';

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Cell = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Snapshot = { phase: string; inventory: unknown; error: string; fieldErrors: Record<string, string> };
const inventory = { status: 'needs-matching-phrase-verification', reason: null, backup: 'unconfirmed', privateNotes: 'not-supported', counts: {
  hdAccounts: 3, importedKeys: 2,
  retainedSignedTransactions: 5, tokenEntries: 6,
  historySummaries: 7, cachedTransactions: 8, activityPreferences: 9,
} };
function evaluate(source: string, dependencies: Record<string, unknown>, flow = false) {
  const require = createRequire(import.meta.url);
  const babelRequire = createRequire(require.resolve('babel-preset-expo'));
  const babel = babelRequire('@babel/core') as { transformSync(code: string, options: object): { code: string } };
  const code = flow ? babel.transformSync(source, { babelrc: false, configFile: false,
    plugins: [babelRequire.resolve('babel-plugin-syntax-hermes-parser'), babelRequire.resolve('@babel/plugin-transform-flow-strip-types'), babelRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code : ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(code, { module, exports: module.exports, Error, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name}`); return dependencies[name];
  } });
  return module.exports;
}
function setup(phase = 'entry') {
  const cells: Cell[] = []; let cursor = 0;
  const layouts: (() => void)[] = [];
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const hook = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const c = cell(); if (!Object.hasOwn(c, 'value')) c.value = typeof initial === 'function' ? initial() : initial;
      return [c.value, (value: unknown) => { c.value = typeof value === 'function' ? value(c.value) : value; }]; },
    useRef(initial: unknown) { const c = cell(); c.value ??= { current: initial }; return c.value; },
    useCallback(callback: unknown, deps: readonly unknown[]) { const c = cell(); if (!c.deps || deps.some((d, i) => !Object.is(d, c.deps![i]))) { c.value = callback; c.deps = deps; } return c.value; },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) { const c = cell(); if (deps && c.deps && deps.length === c.deps.length && deps.every((d, i) => Object.is(d, c.deps![i]))) return;
      c.deps = deps; layouts.push(() => { c.cleanup?.(); c.cleanup = callback() || undefined; }); },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) { hook.useLayoutEffect(callback, deps); },
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) { cell(); return read(); },
  };
  const listeners = new Map<string, Set<(state: string) => void>>(); let active = 'active', hardware = () => false, defaultCalls = 0;
  const back = evaluate(readFileSync(new NodeURL('../node_modules/react-native/Libraries/Utilities/BackHandler.android.js', import.meta.url), 'utf8'), {
    '../../Libraries/NativeModules/specs/NativeDeviceEventManager': { invokeDefaultBackPressHandler() { defaultCalls++; } },
    '../../src/private/webapis/dom/events/internals/EventInternals': { setEventInitTimeStamp() {} },
    '../EventEmitter/RCTDeviceEventEmitter': { addListener(_name: string, callback: () => void) { hardware = () => { callback(); return true; }; } },
    './HardwareBackPressEvent': { HardwareBackPressEvent: class {} },
  }, true).default as { addEventListener(name: string, callback: () => boolean): { remove(): void } };
  let dismisses = 0;
  const native = { Platform: { OS: 'android' }, BackHandler: back,
    AppState: { get currentState() { return active; }, addEventListener(event: string, listener: (state: string) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); return { remove() { listeners.get(event)!.delete(listener); } };
    } },
    Keyboard: { dismiss() { dismisses++; } }, AccessibilityInfo: { setAccessibilityFocus() {} }, findNodeHandle: () => null,
    StyleSheet: { create: (s: unknown) => s },
    ...Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Pressable', 'Text', 'TextInput', 'View'].map((name) => [name, name])),
  };
  const ui = { ...Object.fromEntries(['Button', 'Card', 'Icon', 'Notice', 'Screen', 'Text'].map((name) => [name, name])), colors: {}, styles: {} };
  const idle = createIdleComponentFixture(hook, native);
  const loaded = evaluate(readFileSync(new NodeURL('../src/screens/NativeRecovery.tsx', import.meta.url), 'utf8'), {
    './IdleActivityBoundary': idle.components,
    '../custody/password': passwordPolicy,
    react: hook, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
  });
  const snapshot: Snapshot = { phase, inventory, error: '', fieldErrors: {} };
  const calls = { starts: 0, backs: 0, cancels: 0, submits: 0, commits: 0 };
  let admitted = true;
  const flow = { getSnapshot: () => snapshot, subscribe: () => () => {}, start() { calls.starts++; },
    back() { calls.backs++; }, cancel() { calls.cancels++; }, enter() { snapshot.phase = 'entry'; },
    submit(input: Record<string, string>) { calls.submits++; assert.deepEqual(Object.keys(input).sort(), ['confirmation', 'password', 'phrase']); if (admitted) snapshot.phase = 'verifying'; return admitted; },
    commit() { calls.commits++; snapshot.phase = 'committing'; },
  };
  const expand = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || !('children' in value)) return value;
    const el = value as Element;
    if (typeof el.type === 'function') return expand(el.type({ ...el.props, children: el.children }));
    return { ...el, children: el.children.flat(Infinity).map(expand), props: { ...el.props, ...(el.props.footer ? { footer: expand(el.props.footer) } : {}) } };
  };
  const render = () => { cursor = 0; const result = (loaded.NativeRecovery as (props: object) => Element)({ flow }); layouts.splice(0).forEach((run) => run()); return expand(result) as Element; };
  return { render, snapshot, calls, back, hook, native, ui, idle, component: loaded.NativeRecovery,
    renderOwner(component: (props: object) => Element, props: object) { cursor = 0; const result = component(props); layouts.splice(0).forEach((run) => run()); return result; },
    renderFlow(value: unknown) { cursor = 0; const result = (loaded.NativeRecovery as (props: object) => Element)({ flow: value }); layouts.splice(0).forEach((run) => run()); return expand(result) as Element; },
    admission(value: boolean) { admitted = value; },
    emit(event: string, state = '') { if (event === 'change') active = state; for (const fn of [...listeners.get(event) ?? []]) fn(state); },
    hardware: () => hardware(), defaults: () => defaultCalls, dismisses: () => dismisses,
    dispose() { for (const c of cells) c.cleanup?.(); },
    listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}
function all(tree: unknown): Element[] {
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return [];
  const node = tree as Element; return [node, ...node.children.flatMap(all), ...all(node.props.footer)];
}
const text = (tree: unknown): string => all(tree).flatMap((node) => node.children.filter((child) => typeof child === 'string' || typeof child === 'number')).join(' ');
function field(tree: Element, label: string) { const node = all(tree).find((e) => e.type === 'TextInput' && e.props.accessibilityLabel === label); assert.ok(node); return node; }
function button(tree: Element, title: string) { const node = all(tree).find((e) => e.type === 'Button' && e.props.title === title); assert.ok(node); return node; }
function press(node: Element) { (node.props.onPress as (event: object) => void)({ nativeEvent: {} }); }

test('actual recovery component keeps bounded private input with native autofill/correction disabled', () => {
  const f = setup(); const tree = f.render();
  for (const [label, max, secure] of [['Matching recovery phrase', 4096, false], ['New password', 1024, true], ['Confirm new password', 1024, true]] as const) {
    const input = field(tree, label);
    assert.equal(input.props.maxLength, max); assert.equal(input.props.secureTextEntry, secure);
    assert.equal(input.props.autoComplete, 'off'); assert.equal(input.props.autoCorrect, false); assert.equal(input.props.spellCheck, false);
    assert.equal(input.props.textContentType, 'none'); assert.equal(input.props.importantForAutofill, 'noExcludeDescendants');
    assert.equal(input.props.contextMenuHidden, false);
  }
  assert.equal(f.calls.starts, 1); f.dispose();
});

test('admitted submit clears all inputs and rapid second press cannot submit again', () => {
  const f = setup(); let tree = f.render();
  for (const label of ['Matching recovery phrase', 'New password', 'Confirm new password']) (field(tree, label).props.onChangeText as (s: string) => void)('public fixture text');
  tree = f.render(); const submit = button(tree, 'Verify wallet'); press(submit); press(submit);
  assert.equal(f.calls.submits, 1); assert.equal(f.snapshot.phase, 'verifying');
  tree = f.render(); assert.equal(all(tree).filter((e) => e.type === 'TextInput').length, 0);
  f.snapshot.phase = 'entry'; tree = f.render();
  for (const label of ['Matching recovery phrase', 'New password', 'Confirm new password']) assert.equal(field(tree, label).props.value, '');
  assert.ok(f.dismisses()); f.dispose();
});

test('nonadmitted local validation retains input and associates each public field error', () => {
  const f = setup(); f.admission(false); let tree = f.render();
  (field(tree, 'New password').props.onChangeText as (s: string) => void)('short'); tree = f.render(); press(button(tree, 'Verify wallet'));
  f.snapshot.fieldErrors.password = 'Use at least 12 characters.'; tree = f.render();
  assert.equal(field(tree, 'New password').props.value, 'short');
  assert.equal(field(tree, 'New password').props.accessibilityHint, 'Use at least 12 characters.');
  assert.equal(field(tree, 'New password').props['aria-labelledby'], 'recovery-password-label recovery-password-error');
  f.dispose();
});

for (const event of ['background', 'inactive', 'blur'] as const) test(`actual ${event} handler clears input and cancels without waiting for unmount`, () => {
  const f = setup(); let tree = f.render(); (field(tree, 'Matching recovery phrase').props.onChangeText as (s: string) => void)('public phrase');
  if (event === 'blur') f.emit('blur'); else f.emit('change', event);
  assert.equal(f.calls.cancels, 1); tree = f.render(); assert.equal(field(tree, 'Matching recovery phrase').props.value, '');
  press(button(tree, 'Verify wallet')); assert.equal(f.calls.submits, 0);
  f.dispose(); assert.equal(f.listeners(), 0);
});

for (const order of ['parent-first', 'child-first'] as const) test(`real Android Back dispatcher clears recovery and consumes before root (${order})`, () => {
  const f = setup(); let parentCalls = 0;
  const installParent = () => f.back.addEventListener('hardwareBackPress', () => {
    // NativeWallet's parent defers whenever the recovery leaf owns this stage.
    if (f.snapshot.phase) return false;
    parentCalls++; return true;
  });
  let parent = order === 'parent-first' ? installParent() : null;
  let tree = f.render(); parent ??= installParent();
  (field(tree, 'Matching recovery phrase').props.onChangeText as (s: string) => void)('public phrase');
  f.hardware(); tree = f.render(); assert.equal(f.calls.backs, 1); assert.equal(parentCalls, 0); assert.equal(f.defaults(), 0);
  assert.equal(field(tree, 'Matching recovery phrase').props.value, '');
  f.dispose(); parent.remove(); f.hardware(); assert.equal(f.defaults(), 1);
});

test('inventory shows exact public counts and preserves backup/private-note distinctions', () => {
  const f = setup('scope'); let tree = f.render();
  assert.match(text(tree), /Seed-derived accounts 3/); assert.match(text(tree), /Imported keys saved on this device 2/);
  assert.match(text(tree), /Saved transactions 5/); assert.match(text(tree), /6 tokens · 7 saved summaries/);
  assert.match(text(tree), /not confirmed/); assert.match(text(tree), /No private notes are saved on this device/);
  const details = all(tree).find((e) => e.props.accessibilityLabel === 'Saved-data details')!; press(details); tree = f.render();
  assert.match(text(tree), /Cached transactions 8/); assert.match(text(tree), /Activity preferences 9/);
  assert.doesNotMatch(text(tree), /Retired/);
  f.snapshot.inventory = { ...inventory, privateNotes: 'requires-matching-phrase-verification' }; tree = f.render();
  assert.match(text(tree), /Saved private notes will be verified and kept/);
  assert.doesNotMatch(text(tree), /No private notes are saved/);
  f.snapshot.inventory = { status: 'unavailable', counts: null }; tree = f.render();
  assert.equal(button(tree, 'Continue').props.disabled, true); assert.doesNotMatch(text(tree), /Seed-derived accounts|0 tokens/);
  assert.ok(all(tree).some((entry) => entry.props.title === 'Saved data unavailable' && entry.props.body === 'Your saved wallet could not be verified for this recovery. Nothing has been reset.'));
  f.dispose();
});

test('committing copy never promises cancellation rolls back a possibly completed password change', () => {
  const f = setup('committing'); const tree = f.render();
  assert.match(text(tree), /password change may already have completed/); assert.ok(button(tree, 'Leave recovery'));
  assert.equal(all(tree).filter((e) => e.type === 'TextInput').length, 0); f.dispose();
});

for (const order of ['parent-first', 'child-first'] as const) test(`actual NativeWallet parent and recovery leaf consume Back in ${order} order`, async () => {
  const root = setup(), leaf = setup(); let exits = 0;
  const actualBack = leaf.back;
  let owner: 'parent' | 'child' = 'parent';
  const handlers: { owner: 'parent' | 'child'; run: () => boolean; remove(): void }[] = [];
  leaf.native.BackHandler = { addEventListener(name: string, run: () => boolean) {
    const sub = actualBack.addEventListener(name, run); handlers.push({ owner, run, remove: () => sub.remove() }); return sub;
  } };
  let state = { phase: 'locked', revision: 1, presence: 'existing', backup: 'confirmed', account: null, error: null };
  const controllers = {
    authority: { getSnapshot: () => state, getCatalogue: () => null, supportsAccountManagement: () => false,
      async initialize() {}, subscribe: () => () => {}, lock() {}, async dispose() { state = { ...state, phase: 'disposed' }; } },
    accounts: {}, balanceReader: {}, transfers: {}, tokens: {}, activity: {},
    keyExport: { cancel() {}, dispose() {} }, backup: { cancel() {}, dispose() {}, onClear: () => () => {} },
    disposeTokens() {}, disposeTransfers() {}, async readRecoveryInventory() { return inventory; },
  };
  const source = readFileSync(new NodeURL('../src/screens/NativeWallet.native.tsx', import.meta.url), 'utf8');
  const dependencies: Record<string, unknown> = Object.fromEntries([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => [match[1]!, {}]));
  const noteRestore = { cancel() {}, lock() {}, step: { phase: 'select' } };
  Object.assign(dependencies, {
    '../platform/security': root.idle.security, './IdleActivityBoundary': root.idle.components,
    react: root.hook, 'react-native': leaf.native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': { ...leaf.ui, Header: 'Header', PaliMark: 'PaliMark' },
    '../platform/nativeFactory': { createNativeWalletControllers: () => controllers, createNativeRecoveryCoordinator: () => { throw Error('not used before verification'); } },
    '../platform/privacyShield.native': { async ensurePrivacyShield() {} },
    '../core/utxoNetworks': { findUtxoNetwork },
    '../custody/password': passwordPolicy,
    '../custody/nativeControllerLifecycle': { NativeControllerLifecycle }, '../custody/recoveryFlow': { NativeRecoveryFlow },
    './NativeRecovery': { NativeRecovery: leaf.component }, '../custody/networkView': { createNativeNetworkView: () => ({}) },
    './useNativeNoteBackup': { useNativeNoteBackup: () => noteRestore },
    './useRealShell': { useRealShell: () => ({ tab: 'wallet', navigation: {}, goBack() { exits++; }, restoreRoot() {} }) },
  });
  const Root = evaluate(source, dependencies).NativeWalletScreen as (props: object) => Element;
  const props = { onExit() { exits++; } };
  owner = 'parent'; root.renderOwner(Root, props);
  await new Promise((resolve) => setImmediate(resolve));
  let tree = root.renderOwner(Root, props); press(button(tree, 'Forgot password?'));
  tree = root.renderOwner(Root, props); const flow = tree.props.flow as NativeRecoveryFlow;
  assert(flow instanceof NativeRecoveryFlow);
  owner = 'child'; leaf.renderFlow(flow); await new Promise((resolve) => setImmediate(resolve));
  let child = leaf.renderFlow(flow); press(button(child, 'Continue')); child = leaf.renderFlow(flow);
  (field(child, 'Matching recovery phrase').props.onChangeText as (s: string) => void)('public fixture');
  const parentHandler = handlers.find((h) => h.owner === 'parent')!, childHandler = handlers.find((h) => h.owner === 'child')!;
  assert(parentHandler && childHandler);
  handlers.forEach((h) => h.remove());
  const ordered = order === 'parent-first' ? [parentHandler, childHandler] : [childHandler, parentHandler];
  const installed = ordered.map((h) => actualBack.addEventListener('hardwareBackPress', h.run));
  leaf.hardware(); assert.equal(flow.getSnapshot().phase, 'scope'); assert.equal(exits, 0); assert.equal(leaf.defaults(), 0);
  child = leaf.renderFlow(flow); assert.equal(all(child).filter((e) => e.type === 'TextInput').length, 0);
  leaf.hardware(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flow.getSnapshot().phase, 'closed'); assert.equal(exits, 0); assert.equal(leaf.defaults(), 0);
  installed.forEach((s) => s.remove()); leaf.dispose(); root.dispose();
});

async function walletFeedbackFixture() {
  const root = setup();
  let state: { phase: string; revision: number; presence: string; backup: string; account: null; error: string | null } =
    { phase: 'locked', revision: 1, presence: 'existing', backup: 'confirmed', account: null, error: null };
  let observer: (snapshot: typeof state) => void = () => {};
  let nextError: string | null = null;
  const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; observer(state); };
  const controllers = {
    authority: { getSnapshot: () => state, getCatalogue: () => null, supportsAccountManagement: () => false,
      async initialize() {}, subscribe(fn: typeof observer) { observer = fn; return () => { observer = () => {}; }; },
      lock() {}, async dispose() { state = { ...state, phase: 'disposed' }; },
      async unlock() {
        publish({ phase: 'authenticating', error: null });
        if (nextError) { const code = nextError; publish({ phase: 'locked', error: code }); throw new Error(code); }
        publish({ phase: 'backup-required', backup: 'unconfirmed', error: null });
      } },
    accounts: {}, balanceReader: {}, transfers: {}, tokens: {}, activity: {},
    keyExport: { cancel() {}, dispose() {} }, backup: { cancel() {}, dispose() {}, onClear: () => () => {} },
    disposeTokens() {}, disposeTransfers() {},
  };
  const source = readFileSync(new NodeURL('../src/screens/NativeWallet.native.tsx', import.meta.url), 'utf8');
  const dependencies: Record<string, unknown> = Object.fromEntries([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => [match[1]!, {}]));
  const noteRestore = { cancel() {}, lock() {}, step: { phase: 'select' } };
  Object.assign(dependencies, {
    '../platform/security': root.idle.security, './IdleActivityBoundary': root.idle.components,
    react: root.hook, 'react-native': root.native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...root.ui, Header: 'Header', PaliMark: 'PaliMark' },
    '../platform/nativeFactory': { createNativeWalletControllers: () => controllers, createNativeRecoveryCoordinator: () => { throw Error('unused'); } },
    '../platform/privacyShield.native': { async ensurePrivacyShield() {} },
    '../core/utxoNetworks': { findUtxoNetwork }, '../custody/password': passwordPolicy,
    '../custody/nativeControllerLifecycle': { NativeControllerLifecycle }, '../custody/recoveryFlow': { NativeRecoveryFlow },
    './NativeCustodyFeedback': { NativeCustodyFeedback: 'NativeCustodyFeedback' },
    './NativeRecovery': { NativeRecovery: 'NativeRecovery' }, './NativeNoteRestore': { NoteRestoreUnconfirmedNotice: 'NoteRestoreUnconfirmedNotice' },
    '../custody/networkView': { createNativeNetworkView: () => ({}) },
    './useNativeNoteBackup': { useNativeNoteBackup: () => noteRestore },
    './useRealShell': { useRealShell: () => ({ tab: 'wallet', navigation: {}, goBack() {}, restoreRoot() {} }) },
  });
  const Root = evaluate(source, dependencies).NativeWalletScreen as (props: object) => Element;
  const props = { onExit() {} };
  const render = () => root.renderOwner(Root, props);
  render(); await new Promise((resolve) => setImmediate(resolve));
  const unlock = async (error: string | null) => {
    nextError = error;
    let tree = render();
    const input = all(tree).find((node) => node.props.label === 'Password'); assert.ok(input);
    (input.props.onChange as (value: string) => void)('public test password');
    tree = render(); press(button(tree, 'Unlock wallet'));
    await new Promise((resolve) => setImmediate(resolve));
    return render();
  };
  return { render, unlock, publish, dispose: root.dispose };
}

for (const code of ['INVALID_CREDENTIAL', 'AUTH_THROTTLED'] as const) test(`wallet fallback renders one alert for duplicate ${code}, preserves distinct failures and clears on retry`, async () => {
  const f = await walletFeedbackFixture();
  let tree = f.render();
  assert.equal(tree.type, 'SafeAreaView');
  assert.deepEqual(Array.from(tree.props.edges as string[]), ['top', 'bottom']);
  tree = await f.unlock(code);
  assert.equal(all(tree).filter((node) => node.type === 'NativeCustodyFeedback').length, 0);
  assert.equal(all(tree).filter((node) => node.props.accessibilityRole === 'alert').length, 1);
  f.publish({ error: 'PENDING_TRANSFER' }); tree = f.render();
  assert.equal(all(tree).filter((node) => node.type === 'NativeCustodyFeedback' && node.props.error === 'PENDING_TRANSFER').length, 1);
  assert.equal(all(tree).filter((node) => node.props.accessibilityRole === 'alert').length, 1);
  tree = await f.unlock(null);
  assert.equal(all(tree).filter((node) => node.type === 'NativeCustodyFeedback' || node.props.accessibilityRole === 'alert').length, 0);
  f.publish({ phase: 'locked', error: 'INVALID_CREDENTIAL' }); tree = f.render();
  assert.equal(all(tree).filter((node) => node.type === 'NativeCustodyFeedback' && node.props.error === 'INVALID_CREDENTIAL').length, 1);
  assert.equal(all(tree).filter((node) => node.props.accessibilityRole === 'alert').length, 0);
  f.dispose();
});
