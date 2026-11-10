import { PALI_RECOVERY_ALERTS_URL } from '../../../source/shared/smartAccountLinks.ts';
import { getNativeGuardianRecoveryChoices } from '../src/smartAccount/guardianRecovery.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';
import * as passwordPolicy from '../src/custody/password.ts';
import { isNativePin } from '../src/custody/pinVault.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createIdleComponentFixture } from './idleComponentFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { findUtxoNetwork, UTXO_NETWORKS, supportsUtxoSoftwareCustody } from '../src/core/utxoNetworks.ts';
import { supportsSptUtxoChain, sptBalanceTotalUnits } from '../../../source/shared/sptInventory.ts';
import { createNativeNetworkView } from '../src/custody/networkView.ts';
import type { NativeNetworkSelectionProof } from '../src/custody/accounts.ts';
import { networkSelectionReceiptFixture } from './networkSelectionReceiptFixture.ts';
import { sendDraftForNetwork, NETWORK_CHANGED_DRAFT_NOTICE } from '../src/screens/sendNetworkDraft.ts';
import { UTXO_ADDRESSES } from './publicWatchFixtures.ts';
import { NativeControllerLifecycle } from '../src/custody/nativeControllerLifecycle.ts';
import { NativeRecoveryFlow } from '../src/custody/recoveryFlow.ts';
import * as networkContext from '../src/custody/networkContext.ts';
import { isAllowedSentryKeyRoleScheme, type SentryKeySummary } from '../../../source/wallet/sentryKeyVault.ts';
import { containsSentryPrivateKey, parseSentryKeyBatch } from '../../../source/utils/sentry/importBatch.ts';
import type { NativeSentryKeyManagement } from '../src/custody/sentryKeyManagement.ts';
import type { NativeConnectionsView } from '../src/connections/types.ts';
import type { NativeTrezorView } from '../src/custody/trezorAccounts.ts';

// Leaf tests inject completed PIN values; the actual numeric pad has dedicated coverage.
function pinFieldFixture(f: ReturnType<typeof setup>) {
  return { PinField: (props: { label: string; value: string; onChange(value: string): void; busy: boolean }) =>
    f.hook.createElement(f.idle.components.IdleTextInput, {
      accessibilityLabel: props.label, value: props.value, onChangeText: props.onChange,
      editable: !props.busy, secureTextEntry: true, maxLength: 6,
    }) };
}

function trezorLifecycle() {
  return {background() {}, async cancel() {}, subscribe: () => () => undefined,
    getSnapshot: () => ({phase: 'idle', operation: null, networkLabel: '', accountLabel: '', address: null, signer: null, error: null}),
  } satisfies Pick<NativeTrezorView, 'background' | 'cancel' | 'subscribe' | 'getSnapshot'>;
}

function psbtLifecycle(events: string[] = []) {
  return {
    backgroundSigning() { events.push('psbt-background'); },
    async cancelSigningHandoff() { events.push('psbt-cancel'); },
    async resumeSigning() { throw Error('PSBT resume is outside this fixture'); },
  } satisfies Pick<NativeConnectionsView, 'backgroundSigning' | 'cancelSigningHandoff' | 'resumeSigning'>;
}

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Cell = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Snapshot = { phase: string; inventory: unknown; error: string; fieldErrors: Record<string, string> };
const inventory = { status: 'needs-matching-phrase-verification', reason: null, backup: 'unconfirmed', privateNotes: 'not-supported', counts: {
  hdAccounts: 3, importedKeys: 2,
  retainedSignedTransactions: 5, tokenEntries: 6,
  historySummaries: 7, cachedTransactions: 8, activityPreferences: 9,
} };
const walletScreenPorts = {
  './BackupIntroduction': { BackupIntroduction: 'BackupIntroduction' },
  './TransactionAuthentication': { TransactionAuthentication: 'TransactionAuthentication' },
  './NativeImportWallet': { NativeImportWallet: 'NativeImportWallet' },
  './PinEntry': { PinEntryScreen: 'PinEntryScreen', PinSetup: 'PinSetup', PinField: 'PinField', isWalletPin: isNativePin },
  './BackupVerification': { BackupVerification: 'BackupVerification' },
};
function evaluate(source: string, dependencies: Record<string, unknown>, flow = false) {
  const require = createRequire(import.meta.url);
  const babelRequire = createRequire(require.resolve('babel-preset-expo'));
  const babel = babelRequire('@babel/core') as { transformSync(code: string, options: object): { code: string } };
  const code = flow ? babel.transformSync(source, { babelrc: false, configFile: false,
    plugins: [babelRequire.resolve('babel-plugin-syntax-hermes-parser'), babelRequire.resolve('@babel/plugin-transform-flow-strip-types'), babelRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code : ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(code, { module, exports: module.exports, Error, AbortController, performance, setTimeout, clearTimeout, queueMicrotask, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name}`); return dependencies[name];
  } });
  return module.exports;
}
function setup(phase = 'entry') {
  const cells: Cell[] = []; let cursor = 0, dirty = false;
  const layouts: (() => void)[] = [];
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const hook = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) { const c = cell(); if (!Object.hasOwn(c, 'value')) c.value = typeof initial === 'function' ? initial() : initial;
      return [c.value, (value: unknown) => { const next = typeof value === 'function' ? value(c.value) : value;
        if (!Object.is(c.value, next)) { c.value = next; dirty = true; } }]; },
    useRef(initial: unknown) { const c = cell(); c.value ??= { current: initial }; return c.value; },
    useCallback(callback: unknown, deps: readonly unknown[]) { const c = cell(); if (!c.deps || deps.some((d, i) => !Object.is(d, c.deps![i]))) { c.value = callback; c.deps = deps; } return c.value; },
    useMemo(create: () => unknown, deps: readonly unknown[]) { const c = cell(); if (!c.deps || deps.length !== c.deps.length || deps.some((d, i) => !Object.is(d, c.deps![i]))) { c.value = create(); c.deps = deps; } return c.value; },
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
  const ui = { ...Object.fromEntries(['Button', 'Card', 'Icon', 'Notice', 'Row', 'Screen', 'Text', 'SegmentedControl'].map((name) => [name, name])), colors: {}, styles: {} };
  const idle = createIdleComponentFixture(hook, native);
  const loaded = evaluate(readFileSync(new NodeURL('../src/screens/NativeRecovery.tsx', import.meta.url), 'utf8'), {
    './IdleActivityBoundary': idle.components,
    '../custody/pinVault': { isNativePin }, './PinEntry': { PinSetup: 'PinSetup' },
    react: hook, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
  });
  const snapshot: Snapshot = { phase, inventory, error: '', fieldErrors: {} };
  const calls = { starts: 0, backs: 0, cancels: 0, submits: 0, commits: 0 };
  let admitted = true;
  const flow = { getSnapshot: () => snapshot, subscribe: () => () => {}, start() { calls.starts++; },
    back() { calls.backs++; }, cancel() { calls.cancels++; }, enter() { snapshot.phase = 'entry'; },
    submit(input: Record<string, string>) { calls.submits++; assert.deepEqual(Object.keys(input).sort(), ['phrase', 'pin']); if (admitted) snapshot.phase = 'verifying'; return admitted; },
    commit() { calls.commits++; snapshot.phase = 'committing'; },
  };
  const expand = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || !('children' in value)) return value;
    const el = value as Element;
    if (typeof el.type === 'function') return expand(el.type({ ...el.props, children: el.children }));
    return { ...el, children: el.children.flat(Infinity).map(expand), props: { ...el.props, ...(el.props.footer ? { footer: expand(el.props.footer) } : {}) } };
  };
  // React flushes state changes from layout effects before accepting the next event.
  // Model that commit boundary so tests never invoke a stale pre-layout callback.
  const commit = (component: (props: object) => Element, props: object) => {
    for (let pass = 0; pass < 20; pass++) {
      dirty = false; cursor = 0;
      const result = component(props);
      layouts.splice(0).forEach(run => run());
      if (!dirty) return result;
    }
    throw Error('Fixture layout updates did not settle');
  };
  const render = () => expand(commit(loaded.NativeRecovery as (props: object) => Element, { flow })) as Element;
  return { render, expand, snapshot, calls, back, hook, native, ui, idle, component: loaded.NativeRecovery,
    renderOwner(component: (props: object) => Element, props: object) { return commit(component, props); },
    renderFlow(value: unknown) { return expand(commit(loaded.NativeRecovery as (props: object) => Element, { flow: value })) as Element; },
    admission(value: boolean) { admitted = value; },
    emit(event: string, state = '') { if (event === 'change') active = state; for (const fn of [...listeners.get(event) ?? []]) fn(state); },
    hardware: () => hardware(), defaults: () => defaultCalls, dismisses: () => dismisses,
    dispose() { for (const c of cells) c.cleanup?.(); },
    listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}
function all(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(all);
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return [];
  const node = tree as Element; return [node, ...node.children.flatMap(all), ...all(node.props.footer)];
}
const text = (tree: unknown): string => all(tree).flatMap((node) => node.children.filter((child) => typeof child === 'string' || typeof child === 'number')).join(' ');
function field(tree: Element, label: string) { const node = all(tree).find((e) => e.type === 'TextInput' && e.props.accessibilityLabel === label); assert.ok(node); return node; }
function button(tree: Element, title: string) { const node = all(tree).find((e) => e.type === 'Button' && e.props.title === title); assert.ok(node); return node; }
function row(tree: Element, title: string) { const node = all(tree).find(e => e.type === 'Row' && e.props.title === title); assert.ok(node); return node; }
function press(node: Element) { (node.props.onPress as (event: object) => void)({ nativeEvent: {} }); }

test('recovery keeps numbered input bounded with native autofill disabled', () => {
  const f = setup(); const tree = f.render();
  for (let index = 1; index <= 12; index++) {
    const input = field(tree, `Recovery word ${index}`);
    assert.equal(input.props.maxLength, index === 1 ? 4096 : 64);
    assert.equal(input.props.autoComplete, 'off'); assert.equal(input.props.autoCorrect, false); assert.equal(input.props.spellCheck, false);
    assert.equal(input.props.textContentType, 'none'); assert.equal(input.props.importantForAutofill, 'noExcludeDescendants');
  }
  assert.equal(f.calls.starts, 1); f.dispose();
});

test('recovery hands phrase to PIN setup then submits once and clears words', () => {
  const f = setup(); let tree = f.render();
  (field(tree, 'Recovery word 1').props.onChangeText as (text: string) => void)('abandon '.repeat(11) + 'about');
  tree = f.render(); press(button(tree, 'Continue')); tree = f.render();
  assert.equal(tree.type, 'PinSetup'); const submit = tree.props.onComplete as (pin: string) => void;
  submit('123456'); submit('123456');
  assert.equal(f.calls.submits, 1); assert.equal(f.snapshot.phase, 'verifying');
  tree = f.render(); assert.equal(all(tree).filter(e => e.type === 'TextInput').length, 0);
  f.snapshot.phase = 'entry'; tree = f.render(); assert.equal(field(tree, 'Recovery word 1').props.value, '');
  assert.ok(f.dismisses()); f.dispose();
});

for (const event of ['background', 'inactive', 'blur'] as const) test(`actual ${event} handler clears input and cancels without waiting for unmount`, () => {
  const f = setup(); let tree = f.render(); (field(tree, 'Recovery word 1').props.onChangeText as (s: string) => void)('public');
  if (event === 'blur') f.emit('blur'); else f.emit('change', event);
  assert.equal(f.calls.cancels, 1); tree = f.render(); assert.equal(field(tree, 'Recovery word 1').props.value, '');
  press(button(tree, 'Continue')); assert.equal(f.calls.submits, 0);
  f.dispose(); assert.equal(f.listeners(), 0);
});

for (const order of ['parent-first', 'child-first'] as const) test(`real Android Back dispatcher clears recovery and consumes before root (${order})`, () => {
  const f = setup(); let parentCalls = 0;
  const installParent = () => f.back.addEventListener('hardwareBackPress', () => {
    if (f.snapshot.phase) return false;
    parentCalls++; return true;
  });
  let parent = order === 'parent-first' ? installParent() : null;
  let tree = f.render(); parent ??= installParent();
  (field(tree, 'Recovery word 1').props.onChangeText as (s: string) => void)('public');
  f.hardware(); tree = f.render(); assert.equal(f.calls.backs, 1); assert.equal(parentCalls, 0); assert.equal(f.defaults(), 0);
  assert.equal(field(tree, 'Recovery word 1').props.value, '');
  f.dispose(); parent.remove(); f.hardware(); assert.equal(f.defaults(), 1);
});

test('recovery shows public inventory only in the expanded disclosure', () => {
  const f = setup('scope'); let tree = f.render();
  assert.doesNotMatch(text(tree), /Seed-derived accounts/);
  press(button(tree, 'Saved-data details')); tree = f.render();
  assert.match(text(tree), /Seed-derived accounts 3/); assert.match(text(tree), /Imported keys saved on this device 2/);
  assert.match(text(tree), /Saved transactions 5/); assert.match(text(tree), /6 tokens · 7 summaries/);
  assert.match(text(tree), /not confirmed/); assert.match(text(tree), /No private notes are saved on this phone/);
  assert.match(text(tree), /Cached transactions 8/); assert.match(text(tree), /Activity preferences 9/);
  f.snapshot.inventory = { ...inventory, privateNotes: 'requires-matching-phrase-verification' }; tree = f.render();
  assert.match(text(tree), /Saved private notes will be verified and kept/);
  f.snapshot.inventory = { status: 'unavailable', counts: null }; tree = f.render();
  assert.equal(button(tree, 'Restore Wallet').props.disabled, true);
  assert.ok(all(tree).some(entry => entry.props.title === 'Saved data unavailable'));
  f.dispose();
});

test('committing copy does not promise cancellation rolls back a completed PIN change', () => {
  const f = setup('committing'); const tree = f.render();
  assert.match(text(tree), /PIN change may already have completed/); assert.ok(button(tree, 'Leave recovery'));
  assert.equal(all(tree).filter(e => e.type === 'TextInput').length, 0); f.dispose();
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
    canManageGuardianPolicy: () => false, canSignSmartAccount: () => false, canManageSlhDsa: () => false,
    canManageSmartAccountModules: () => false,
    async openSmartAccountModules() { throw Error('Modules are outside this fixture'); },
    async openSlhDsaManagement() { throw Error('SLH is outside this fixture'); },
    canUseWalletAuthenticator: () => false,
    guardianRecovery: { hasIntent: () => false, async open() { throw Error('Unavailable in this fixture'); } },
    authority: { getSnapshot: () => state, getCatalogue: () => null, supportsAccountManagement: () => false,
      async getAuthenticationStatus() { return { pinConfigured: true, biometricsAvailable: false, biometricsEnabled: false }; },
      async initialize() {}, subscribe: () => () => {}, lock() {}, async dispose() { state = { ...state, phase: 'disposed' }; } },
    accounts: {}, balanceReader: {}, transfers: {}, tokens: {}, activity: {},
    trezor: trezorLifecycle(), connections: { ...psbtLifecycle(), getSnapshot: () => ({ status: 'ready', signingReview: null, proposals: [] }), subscribe: () => () => {}, cancel() {} },
    removal: { requiresControllerReopen: () => false, cancel() {}, async dispose() {}, hasVerifiedRemoval: () => false },
    keyExport: { cancel() {}, dispose() {} }, backup: { cancel() {}, dispose() {}, onClear: () => () => {} },
    disposeTokens() {}, disposeTransfers() {}, async disposeConnections() {}, async readRecoveryInventory() { return inventory; },
  };
  const source = readFileSync(new NodeURL('../src/screens/NativeWallet.native.tsx', import.meta.url), 'utf8');
  const dependencies: Record<string, unknown> = Object.fromEntries([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => [match[1]!, {}]));
  const noteRestore = { cancel() {}, lock() {}, step: { phase: 'select' } };
  Object.assign(dependencies, {
    ...walletScreenPorts,
    '../portfolio/nativePortfolio': { NativePortfolioController: class { getSnapshot = () => null; subscribe = () => () => {}; connect() { return () => {}; } }, sameNativePortfolioAccount: () => false },
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
    '../platform/localization': nativeTranslationFixture,
    '../../../../source/shared/smartAccountLinks.ts': { PALI_RECOVERY_ALERTS_URL },
    '../smartAccount/guardianRecovery': { getNativeGuardianRecoveryChoices },
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
  const Root = evaluate(source, dependencies).NativeWalletContent as (props: object) => Element;
  const props = { onExit() { exits++; } };
  owner = 'parent'; root.renderOwner(Root, props);
  await new Promise((resolve) => setImmediate(resolve));
  let tree = root.renderOwner(Root, props); press(button(tree, 'Forgot PIN?'));
  tree = root.renderOwner(Root, props); const flow = tree.props.flow as NativeRecoveryFlow;
  assert(flow instanceof NativeRecoveryFlow);
  owner = 'child'; leaf.renderFlow(flow); await new Promise((resolve) => setImmediate(resolve));
  let child = leaf.renderFlow(flow); press(button(child, 'Restore Wallet')); child = leaf.renderFlow(flow);
  (field(child, 'Recovery word 1').props.onChangeText as (s: string) => void)('public fixture');
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

async function walletFeedbackFixture(deviceUnlock = false, empty = false, setting?: { enabled: boolean; wait: Promise<void> }, backupCompletion?: Promise<void>, depositMode = false, networkMode?: 'evm' | 'utxo') {
  const root = setup();
  const networkId = networkMode === 'utxo' ? 'bitcoin' : 'ethereum';
  const address = `0x${'11'.repeat(20)}`;
  let catalogue = { revision: 1, active: { accountId: 'hd:60:0', networkId },
    accounts: [{ id: 'hd:60:0', type: 'HDAccount', index: 0, slip44: 60, address, label: 'Account 1' }],
    networks: networkContext.NATIVE_NETWORKS, utxoNetworks: networkMode ? UTXO_NETWORKS : [] };
  let state: { phase: string; revision: number; presence: string; backup: string; account: { address: string; network: string } | null; error: string | null } =
    { phase: setting || depositMode || networkMode ? 'ready' : empty ? 'empty' : 'locked', revision: 1, presence: empty ? 'empty' : 'existing', backup: empty ? 'unconfirmed' : 'confirmed', account: setting || depositMode || networkMode ? { address, network: networkId } : null, error: null };
  let observer: (snapshot: typeof state) => void = () => {};
  let nextError: string | null = null;
  let releasePrompt!: () => void;
  let locks = 0;
  const lifecycle: string[] = [];
  const enrollments: { enabled: boolean; password: string }[] = [];
  const backupAcknowledgements: string[] = [];
  const authentication = new DeviceUnlockPrompt({
    state: () => root.native.AppState.currentState,
    subscribe(listener) {
      const subscriptions = [root.native.AppState.addEventListener('change', listener),
        root.native.AppState.addEventListener('blur', () => listener('blur')),
        root.native.AppState.addEventListener('focus', () => listener('focus'))];
      return () => subscriptions.forEach(subscription => subscription.remove());
    },
  });
  const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; observer(state); };
  const controllers = {
    canManageGuardianPolicy: () => false, canSignSmartAccount: () => false, canManageSlhDsa: () => false,
    canManageSmartAccountModules: () => false,
    async openSmartAccountModules() { throw Error('Modules are outside this fixture'); },
    async openSlhDsaManagement() { throw Error('SLH is outside this fixture'); },
    canUseWalletAuthenticator: () => false,
    guardianRecovery: { hasIntent: () => false, async open() { throw Error('Unavailable in this fixture'); } },
    ...(deviceUnlock ? { authentication } : {}),
    ...(depositMode ? { async openPrivateDeposit() { throw Error('Deposit child owns opening in the dedicated screen test'); } } : {}),
    ...(networkMode ? { async openUtxoSend() { throw Error('UTXO child owns opening'); } } : {}),
    authority: { getSnapshot: () => state, getCatalogue: () => ['ready', 'backup-required'].includes(state.phase) ? catalogue : null, supportsAccountManagement: () => false,
      async selectNetwork(id: string, contextRevision: number, catalogueRevision: number, onCommitted: (proof: NativeNetworkSelectionProof) => void) {
        assert(networkMode); assert.equal(contextRevision, state.revision); assert.equal(catalogueRevision, catalogue.revision);
        const target = [...networkContext.NATIVE_NETWORKS, ...UTXO_NETWORKS].find(network => network.id === id)!;
        const nextAddress = target.kind === 'utxo' ? UTXO_ADDRESSES[target.id as keyof typeof UTXO_ADDRESSES] : address;
        assert(nextAddress);
        catalogue = { ...catalogue, revision: catalogueRevision + 1, active: { ...catalogue.active, networkId: id }, accounts: [{ ...catalogue.accounts[0]!, address: nextAddress }] };
        const receipt = networkSelectionReceiptFixture(target, { ...catalogue.active, address: nextAddress }, contextRevision, catalogueRevision, () => {
          assert.equal(state.revision, contextRevision + 1); assert.equal(state.account?.network, id);
        });
        publish({ phase: 'ready', revision: contextRevision + 1, account: { address: nextAddress, network: id } });
        onCommitted(receipt); return receipt;
      },
      cancelAccountOperation() {},
      async initialize() {}, subscribe(fn: typeof observer) { observer = fn; return () => { observer = () => {}; }; },
      async getAuthenticationStatus() { return { pinConfigured: !empty, biometricsAvailable: deviceUnlock, biometricsEnabled: deviceUnlock && (setting?.enabled ?? !empty) }; },
      async create() { publish({ phase: 'backup-required', presence: 'existing', backup: 'unconfirmed' }); },
      async setDeviceUnlock(enabled: boolean, password: string, check: () => void) {
        check();
        if (setting) { publish({ phase: 'authenticating', account: null }); await setting.wait; }
        check(); enrollments.push({ enabled, password });
        if (setting) publish({ phase: 'ready', account: { address, network: 'ethereum' } });
      },
      async unlockWithDevice(check: () => void) {
        check(); publish({ phase: 'authenticating', error: null });
        try { await authentication.run(() => new Promise<void>(resolve => { releasePrompt = resolve; })); }
        catch (cause) { publish({ phase: 'locked', account: null, error: 'DEVICE_UNLOCK_UNAVAILABLE' }); throw cause; }
        check(); publish({ phase: 'backup-required', backup: 'unconfirmed', account: { address, network: networkId }, error: null });
      },
      lock() { if (deviceUnlock) { lifecycle.push('lock'); locks++; publish({ phase: 'locked', revision: state.revision + 1, account: null }); } }, async dispose() { state = { ...state, phase: 'disposed' }; },
      async unlock() {
        publish({ phase: 'authenticating', error: null });
        if (nextError) { const code = nextError; publish({ phase: 'locked', error: code }); throw new Error(code); }
        publish({ phase: 'backup-required', backup: 'unconfirmed', error: null });
      } },
    accounts: {}, balanceReader: {}, transfers: { cancel() {} }, tokens: {}, activity: {},
    trezor: trezorLifecycle(), connections: { ...psbtLifecycle(lifecycle), getSnapshot: () => ({ status: 'ready', signingReview: null, proposals: [] }), subscribe: () => () => {}, cancel() {} },
    removal: { requiresControllerReopen: () => false, cancel() {}, async dispose() {}, hasVerifiedRemoval: () => false },
    keyExport: { cancel() {}, dispose() {} }, backup: {
      cancel() {}, dispose() {}, onClear: () => () => {},
      async begin(password: string) {
        assert(backupCompletion, 'Backup is outside this fixture');
        assert.equal((password as unknown as { pin: string }).pin, '123456');
        return { id: 'public-backup-review', words: [...Array(11).fill('abandon'), 'about'] };
      },
      async confirm(id: string, words: readonly string[]) {
        assert(backupCompletion, 'Backup is outside this fixture');
        assert.equal(words.join(' '), [...Array(11).fill('abandon'), 'about'].join(' '));
        backupAcknowledgements.push(id);
        await backupCompletion;
        publish({ phase: 'ready', backup: 'confirmed', account: { address, network: 'ethereum' } });
      },
    },
    disposeTokens() {}, disposeTransfers() {}, async disposeConnections() {},
  };
  const source = readFileSync(new NodeURL('../src/screens/NativeWallet.native.tsx', import.meta.url), 'utf8');
  const dependencies: Record<string, unknown> = Object.fromEntries([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => [match[1]!, {}]));
  const noteRestore = { cancel() {}, lock() {}, step: { phase: 'select' }, exportStep: { phase: 'select' } as { phase: 'select' | 'saved'; noteCount?: number }, busy: false, error: '',
    begin(mode: string) { assert(depositMode && mode === 'export'); return true; } };
  Object.assign(dependencies, {
    ...walletScreenPorts,
    '../portfolio/nativePortfolio': { NativePortfolioController: class { getSnapshot = () => null; subscribe = () => () => {}; connect() { return () => {}; } }, sameNativePortfolioAccount: () => false },
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
    '../platform/localization': nativeTranslationFixture,
    '../../../../source/shared/smartAccountLinks.ts': { PALI_RECOVERY_ALERTS_URL },
    '../smartAccount/guardianRecovery': { getNativeGuardianRecoveryChoices },
    '../platform/security': root.idle.security, './IdleActivityBoundary': root.idle.components,
    react: root.hook, 'react-native': root.native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...root.ui, Header: 'Header', PaliMark: 'PaliMark' },
    '../platform/nativeFactory': { createNativeWalletControllers: () => controllers, createNativeRecoveryCoordinator: () => { throw Error('unused'); } },
    '../platform/privacyShield.native': { async ensurePrivacyShield() {} },
    '../core/utxoNetworks': { findUtxoNetwork, supportsUtxoSoftwareCustody }, '../custody/password': passwordPolicy,
    '../../../../source/shared/sptInventory': { supportsSptUtxoChain, sptBalanceTotalUnits },
    '../custody/nativeControllerLifecycle': { NativeControllerLifecycle }, '../custody/recoveryFlow': { NativeRecoveryFlow },
    '../custody/networkContext': networkContext,
    '../../../../source/shared/evmNetworks': { EVM_NETWORK_DEFINITIONS: [{ id: 'ethereum', name: 'Ethereum' }] },
    './NativeSend': { NativeSend: 'NativeSend' }, './NativeUtxoSend': { NativeUtxoSendScreen: 'NativeUtxoSendScreen' },
    './NativeNetworks': { NativeNetworks: 'NativeNetworks' },
    './sendNetworkDraft': { sendDraftForNetwork, NETWORK_CHANGED_DRAFT_NOTICE },
    '../platform/http': { walletFetch: async () => { throw Error('Network picker fixture performs no HTTP requests'); } },
    './NativePortfolio': { NativePortfolio: 'NativePortfolio' }, './NativeSecurity': { NativeSecurity: 'NativeSecurity' },
    './RealTools': { RealTools: 'RealTools' }, './RealAppShell': { RealAppShell: 'RealAppShell' },
    './NativePrivateDeposit': { NativePrivateDeposit: 'NativePrivateDeposit' },
    './NativeNoteExport': { NativeNoteExport: 'NativeNoteExport', NativeNoteFilesMenu: 'NativeNoteFilesMenu' },
    '../../../../source/utils/privacy/registry': { PRIVACY_CHAIN_ID: 1 },
    './NativeCustodyFeedback': { NativeCustodyFeedback: 'NativeCustodyFeedback' },
    './NativeRecovery': { NativeRecovery: 'NativeRecovery' }, './NativeNoteRestore': { NoteRestoreUnconfirmedNotice: 'NoteRestoreUnconfirmedNotice' },
    '../custody/networkView': { createNativeNetworkView: networkMode ? createNativeNetworkView : () => ({}) },
    './useNativeNoteBackup': { useNativeNoteBackup: () => noteRestore },
    './useRealShell': { useRealShell: () => ({ tab: depositMode ? 'tools' : 'wallet', navigation: {}, goBack() {}, restoreRoot() {} }) },
  });
  const Root = evaluate(source, dependencies).NativeWalletContent as (props: object) => Element;
  const props = { onExit() {} };
  const render = () => root.renderOwner(Root, props);
  render(); await new Promise((resolve) => setImmediate(resolve));
  const unlock = async (error: string | null) => {
    nextError = error;
    let tree = render();
    const pinEntry = all(tree).find(node => node.type === 'PinEntryScreen'); assert(pinEntry);
    (pinEntry.props.onComplete as (pin: string) => void)('123456');
    await new Promise((resolve) => setImmediate(resolve));
    return render();
  };
  return { render, unlock, publish, noteRestore, dispose: root.dispose, emit: root.emit, hardware: root.hardware, releasePrompt: () => releasePrompt(), enrollments, backupAcknowledgements, lifecycle, get locks() { return locks; } };
}

test('backup completion waits for verification and durable save, then clears displayed words', async () => {
  for (const action of ['done', 'back'] as const) {
    const completion = Promise.withResolvers<void>();
    const f = await walletFeedbackFixture(false, false, undefined, completion.promise);
    try {
      let tree = await f.unlock(null);
      const home = all(tree).find(node => node.type === 'NativePortfolio'); assert(home);
      (home.props.onBackup as () => void)(); tree = f.render();
      const intro = all(tree).find(node => node.type === 'BackupIntroduction'); assert(intro);
      (intro.props.onStart as () => void)(); tree = f.render();
      const authentication = all(tree).find(node => node.type === 'TransactionAuthentication'); assert(authentication);
      assert.equal(authentication.props.method, 'pin');
      (authentication.props.onConfirm as (credential: object) => void)({ method: 'pin', pin: '123456' });
      await new Promise(resolve => setImmediate(resolve));
      tree = f.render(); assert.match(text(tree), /abandon/);
      assert.deepEqual(f.backupAcknowledgements, []);
      press(button(tree, 'Continue')); tree = f.render();
      const verification = all(tree).find(node => node.type === 'BackupVerification'); assert(verification);
      (verification.props.onConfirm as (words: readonly string[]) => void)([...Array(11).fill('abandon'), 'about']);
      await new Promise(resolve => setImmediate(resolve));
      tree = f.render();
      assert.equal(tree.type, 'BackupVerification'); assert.equal(tree.props.busy, true);
      assert.deepEqual(f.backupAcknowledgements, ['public-backup-review']);
      completion.resolve(); await new Promise(resolve => setImmediate(resolve));
      tree = f.render();
      assert.match(text(tree), /Backup complete/); assert(!JSON.stringify(tree).includes('abandon'));
      if (action === 'done') press(button(tree, 'Done')); else f.hardware();
      assert(all(f.render()).some(node => node.type === 'NativePortfolio'));
      assert.equal(f.backupAcknowledgements.length, 1);
    } finally { f.dispose(); }
  }
});

test('PIN setup offers biometric enrollment while preserving Not now', async () => {
  for (const enable of [false, true]) {
    const f = await walletFeedbackFixture(true, true);
    try {
      press(row(f.render(), 'Create a wallet'));
      let tree = f.render(); assert.equal(tree.type, 'PinSetup'); assert.equal(tree.props.available, true);
      (tree.props.onBack as () => void)();
      assert(row(f.render(), 'Import existing wallet'));
      press(row(f.render(), 'Create a wallet'));
      tree = f.render(); assert.equal(tree.type, 'PinSetup');
      (tree.props.onComplete as (pin: string, enabled: boolean) => void)('123456', enable);
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(f.enrollments, enable ? [{ enabled: true, password: '123456' }] : []);
    } finally { f.dispose(); }
  }
});

for (const interruption of ['inactive', 'blur']) test(`native wallet discards a biometric result returned during ${interruption} and permits a fresh attempt`, async () => {
  const f = await walletFeedbackFixture(true);
  try {
    let tree = f.render();
    assert.equal(tree.type, 'PinEntryScreen');
    press(button(tree, 'Use biometrics'));
    await new Promise(resolve => setImmediate(resolve));
    if (interruption === 'inactive') f.emit('change', 'inactive'); else f.emit('blur');
    f.render();
    assert.equal(f.locks, 0);
    f.releasePrompt(); await new Promise(resolve => setImmediate(resolve));
    tree = f.render(); assert.equal(tree.type, 'PinEntryScreen');
    assert.match(String(tree.props.error), /Biometric unlock was not completed/);
    if (interruption === 'inactive') f.emit('change', 'active');
    else f.emit('focus');
    await new Promise(resolve => setImmediate(resolve));
    tree = f.render(); assert.equal(tree.type, 'PinEntryScreen');
    press(button(tree, 'Use biometrics'));
    await new Promise(resolve => setImmediate(resolve));
    f.releasePrompt(); await new Promise(resolve => setImmediate(resolve));
    tree = f.render();
    const home = all(tree).find(node => node.type === 'NativePortfolio'); assert(home);
    (home.props.onBackup as () => void)(); tree = f.render();
    const intro = all(tree).find(node => node.type === 'BackupIntroduction'); assert(intro);
    (intro.props.onStart as () => void)(); tree = f.render();
    assert.ok(all(tree).some(node => node.type === 'TransactionAuthentication' && node.props.method === 'biometric'));
    const lifecycleOffset = f.lifecycle.length;
    f.emit('blur'); f.render();
    assert.equal(f.locks, 1);
    assert.deepEqual(f.lifecycle.slice(lifecycleOffset), ['psbt-background', 'lock']);
  } finally { f.dispose(); }
});

for (const enabled of [false, true]) test(`a queued settings Cancel revokes pending biometric ${enabled ? 'disable' : 'enrollment'}`, async () => {
  let finish!: () => void;
  const f = await walletFeedbackFixture(true, false, { enabled, wait: new Promise(resolve => { finish = resolve; }) });
  try {
    const portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    (portfolio.props.onSecurity as () => void)();
    const security = f.render();
    assert.equal(security.type, 'NativeSecurity');
    (security.props.onDeviceUnlock as () => void)();
    let tree = f.render();
    const cancel = button(tree, 'Cancel');
    const input = all(tree).find(node => node.type === 'PinField'); assert(input);
    (input.props.onChange as (value: string) => void)('123456');
    tree = f.render();
    press(button(tree, enabled ? 'Turn off biometric unlock' : 'Enable biometric unlock'));
    // Authentication replaces the form, but an already queued callback remains callable.
    assert.equal(all(f.render()).some(node => node.props.title === 'Cancel'), false);
    const lifecycleOffset = f.lifecycle.length;
    press(cancel);
    assert.equal(f.locks, 1);
    assert.deepEqual(f.lifecycle.slice(lifecycleOffset), ['psbt-cancel', 'lock']);
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.enrollments, []);
    assert.equal(f.render().type, 'PinEntryScreen');
  } finally { finish(); f.dispose(); }
});

test('native wallet background revokes a pending biometric prompt', async () => {
  const f = await walletFeedbackFixture(true);
  try {
    press(button(f.render(), 'Use biometrics'));
    await new Promise(resolve => setImmediate(resolve));
    f.emit('blur'); f.render();
    assert.equal(f.locks, 0);
    const lifecycleOffset = f.lifecycle.length;
    f.emit('change', 'background'); f.render();
    assert.equal(f.locks, 1);
    assert.deepEqual(f.lifecycle.slice(lifecycleOffset), ['psbt-background', 'lock']);
    f.emit('change', 'active'); f.releasePrompt();
    await new Promise(resolve => setImmediate(resolve));
    const tree = f.render(); assert.equal(tree.type, 'PinEntryScreen');
    assert.equal(all(tree).some(node => node.type === 'TransactionAuthentication'), false);
  } finally { f.dispose(); }
});

for (const code of ['INVALID_CREDENTIAL', 'AUTH_THROTTLED'] as const) test(`PIN unlock shows its failure and clears it after retry (${code})`, async () => {
  const f = await walletFeedbackFixture();
  try {
    let tree = await f.unlock(code);
    assert.equal(tree.type, 'PinEntryScreen');
    assert.match(String(tree.props.error), code === 'INVALID_CREDENTIAL' ? /incorrect/ : /Too many/);
    tree = await f.unlock(null);
    assert.equal(all(tree).some(node => node.type === 'PinEntryScreen'), false);
  } finally { f.dispose(); }
});

test('actual native Sentry surface reviews once, copies only public data and retires held work on blur', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup();
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = {
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Row: 'Row' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const secure = evaluate(load('NoteBackupPasswordField'), common);
  const copied: string[] = [];
  const view = evaluate(load('NativeSentryKeys'), {
    ...common,
    './NativeSentrySettings': { NativeSentrySettings: () => null },
    './NoteBackupPasswordField': secure, './PinEntry': pinFieldFixture(f),
    '../../../../source/wallet/sentryKeyVault': { isAllowedSentryKeyRoleScheme },
    '../../../../source/utils/sentry/importBatch': { containsSentryPrivateKey, parseSentryKeyBatch },
    'expo-clipboard': { async setStringAsync(value: string) { copied.push(value); return true; } },
  }).NativeSentryKeys as (props: object) => Element;
  const secret = '13'.repeat(32), publicKey = '29'.repeat(48), password = 'fixture only passphrase';
  const storedKey = Object.freeze({
    id: 'public-id', network: 'mainnet', label: 'Node one', role: 'operator', scheme: 'bls-basic', publicKey,
  } as const) satisfies SentryKeySummary;
  let keys: readonly SentryKeySummary[] = [];
  let scope!: AbortSignal;
  let previewCount = 0, confirmCount = 0, removalCount = 0, closed = 0, cancels = 0;
  let importReview: Awaited<ReturnType<NativeSentryKeyManagement['prepareImport']>> | undefined;
  let removeReview: Awaited<ReturnType<NativeSentryKeyManagement['prepareRemoval']>>;
  let hold: Promise<void> | undefined, busyConfirmation: Promise<void> | undefined;
  const manager: NativeSentryKeyManagement = {
    async getSettings() { return { serviceUrl: 'https://sysnode.info', maxFeeSatoshis: '100000' }; },
    async saveSettings(settings) { return settings; },
    async list() { return keys; },
    async prepareImport(input, role, scheme) {
      previewCount++;
      assert.equal(input, 'Node one | ' + secret);
      assert.equal(role, 'operator'); assert.equal(scheme, 'bls-basic');
      await hold;
      return importReview = Object.freeze({
        network: 'mainnet', expiresAt: performance.now() + 90_000,
        keys: Object.freeze([{ label: 'Node one', role, scheme, publicKey }]),
      });
    },
    async confirmImport(review, entered) {
      assert.equal(review, importReview); assert.equal(entered, password);
      if (busyConfirmation) {
        await busyConfirmation;
        throw Object.assign(new Error('BUSY'), { code: 'BUSY' });
      }
      confirmCount++;
      return keys = [storedKey];
    },
    async prepareRemoval(id) {
      assert.equal(id, storedKey.id);
      return removeReview = Object.freeze({ key: storedKey, expiresAt: performance.now() + 90_000 });
    },
    async confirmRemoval(review, entered, backedUp) {
      removalCount++;
      assert.equal(review, removeReview); assert.equal(entered, password); assert.equal(backedUp, true);
      keys = [];
      return { removedKeyId: storedKey.id };
    },
    cancel() { cancels++; importReview = undefined; },
    dispose() { closed++; },
  };
  const props = { networkLabel: 'Syscoin Mainnet', onBack() {}, async open(signal: AbortSignal, check: () => void) {
    assert.equal(signal.aborted, false); scope = signal; check(); return manager;
  } };
  const render = () => f.expand(f.renderOwner(view, props)) as Element;
  const activate = (node: Element) => (node.props.onPress as (event: object) => unknown)({ nativeEvent: {} });
  const change = (node: Element, value: string) => (node.props.onChangeText as (value: string) => void)(value);
  const openStored = () => {
    const row = all(render()).find((item) => item.type === 'Row' && item.props.title === 'Node one');
    assert.ok(row);
    activate(row);
  };
  const draft = () => {
    activate(button(render(), 'Import key'));
    let form = render();
    const name = field(form, 'Key label');
    change(name, secret);
    assert.equal(field(render(), 'Key label').props.value, '');
    const ordinary = 'Sentry operator for node one at home 0x';
    const pasted = ordinary + '24bc'.repeat(32);
    const platformValue = typeof name.props.maxLength === 'number'
      ? pasted.slice(0, name.props.maxLength) : pasted;
    change(name, platformValue);
    assert.equal(field(render(), 'Key label').props.value, '');
    change(name, 'x'.repeat(80));
    assert.equal(field(render(), 'Key label').props.value, 'x'.repeat(80));
    change(name, 'x'.repeat(81));
    assert.equal(field(render(), 'Key label').props.value, 'x'.repeat(80));
    change(name, 'Node one');
    const entry = field(form, 'Private key');
    assert.equal(entry.props.secureTextEntry, true);
    assert.equal(entry.props.autoComplete, 'off');
    assert.equal(entry.props.maxLength, 1024);
    change(entry, '0x' + '13'.repeat(64) + 'trailing');
    assert.equal(field(render(), 'Private key').props.value, '');
    change(entry, secret);
    form = render();
    return button(form, 'Review key');
  };
  try {
    render(); await new Promise<void>((resolve) => setImmediate(resolve));
    await activate(draft());
    assert.equal(previewCount, 1);
    assert.equal(confirmCount, 0);
    let tree = render();
    assert.match(text(tree), new RegExp(publicKey));
    assert(!JSON.stringify(tree).includes(secret));
    const confirmation = field(tree, 'Wallet PIN');
    assert.equal(confirmation.props.value, '');
    assert.equal(confirmation.props.secureTextEntry, true);
    assert.equal(button(tree, 'Save key').props.disabled, true);
    change(confirmation, password);
    const save = button(render(), 'Save key');
    const savePending = activate(save); activate(save);
    await savePending;
    assert.equal(confirmCount, 1);
    openStored();
    await activate(button(render(), 'Copy public key'));
    assert.deepEqual(copied, [publicKey]);
    await activate(button(render(), 'Remove key'));
    tree = render();
    change(field(tree, 'Wallet PIN'), password);
    assert.equal(button(render(), 'Remove key').props.disabled, true);
    activate(button(render(), 'Remove key'));
    assert.equal(removalCount, 0);
    const checkbox = all(render()).find((item) => item.props.accessibilityRole === 'checkbox');
    assert.ok(checkbox); activate(checkbox);
    await activate(button(render(), 'Remove key'));
    assert.equal(removalCount, 1);
    assert.equal(keys.length, 0);

    await activate(draft());
    change(field(render(), 'Wallet PIN'), password);
    t.mock.timers.tick(90_000);
    assert.match(text(render()), /Review expired/);
    assert.equal(all(render()).filter((item) => item.type === 'TextInput').length, 0);
    assert.equal(confirmCount, 1);

    await activate(draft());
    change(field(render(), 'Wallet PIN'), password);
    const admitted = Promise.withResolvers<void>();
    busyConfirmation = admitted.promise;
    const blocked = activate(button(render(), 'Save key'));
    assert.equal(field(render(), 'Wallet PIN').props.value, '');
    const cancelsBeforeBusy = cancels;
    admitted.resolve();
    await blocked;
    assert.equal(cancels, cancelsBeforeBusy + 1);
    assert.equal(importReview, undefined);
    assert.equal(all(render()).filter((item) => item.type === 'TextInput').length, 0);
    assert.equal(confirmCount, 1);
    busyConfirmation = undefined;
    await activate(button(render(), 'Try again'));

    const late = Promise.withResolvers<void>();
    hold = late.promise;
    const pending = activate(draft());
    assert.equal(field(render(), 'Private key').props.value, '');
    f.emit('blur');
    assert.equal(scope.aborted, true);
    late.resolve();
    await pending;
    assert.equal(closed, 1);
    tree = render();
    assert(!text(tree).includes(publicKey));
    assert.equal(all(tree).filter((item) => item.type === 'TextInput').length, 0);
    assert.equal(confirmCount, 1);
  } finally { f.dispose(); }
});

test('Sentry batch paste reviews ordered public keys and rejects duplicates, oversize and stale clipboard results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup();
  const common = {
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Row: 'Row' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  let clipboard = '', pendingClipboard: Promise<string> | undefined, confirmed = 0;
  const view = evaluate(load('NativeSentryKeys'), {
    ...common,
    './NativeSentrySettings': { NativeSentrySettings: () => null },
    './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common), './PinEntry': pinFieldFixture(f),
    '../../../../source/wallet/sentryKeyVault': { isAllowedSentryKeyRoleScheme },
    '../../../../source/utils/sentry/importBatch': { containsSentryPrivateKey },
    'expo-clipboard': { getStringAsync: () => pendingClipboard ?? Promise.resolve(clipboard), setStringAsync: async () => true },
  }).NativeSentryKeys as (props: object) => Element;
  const manager: NativeSentryKeyManagement = {
    async getSettings() { return { serviceUrl: 'https://sysnode.info', maxFeeSatoshis: '100000' }; },
    async saveSettings(settings) { return settings; },
    list: async () => [],
    async prepareImport(input, _role, scheme) {
      const parsed = parseSentryKeyBatch(input, scheme);
      if (parsed.issues.length) throw Object.assign(new Error('Invalid batch'), { code: 'INVALID_INPUT', issues: parsed.issues });
      return { network: 'mainnet', expiresAt: performance.now() + 90000,
        keys: parsed.entries.map(({ label }, index) => ({ label, role: 'operator', scheme: 'bls-basic', publicKey: (index ? '48' : '39').repeat(48) })) };
    },
    async confirmImport(review) { confirmed++; return review.keys.map((key, index) => ({ ...key, id: String(index), network: 'mainnet' })); },
    prepareRemoval: async () => { throw new Error('Unused'); },
    confirmRemoval: async () => { throw new Error('Unused'); },
    cancel() {}, dispose() {},
  };
  const props = { networkLabel: 'Syscoin', onBack() {}, open: async () => manager };
  const render = () => f.expand(f.renderOwner(view, props)) as Element;
  const press = async (title: string) => (button(render(), title).props.onPress as () => Promise<void> | void)();
  try {
    render(); await new Promise<void>((resolve) => setImmediate(resolve));
    await press('Import multiple keys');
    assert.equal(all(render()).filter((node) => node.type === 'TextInput').length, 0);
    clipboard = `One | ${'13'.repeat(32)}\nTwo | ${'13'.repeat(32)}`;
    await press('Paste and review keys');
    assert.match(text(render()), /Check the private key/);
    assert(!JSON.stringify(render()).includes(clipboard));
    clipboard = `One | ${'13'.repeat(32)}` + '\n'.repeat(6001);
    await press('Paste and review keys');
    assert.match(text(render()), /Check the private key/);
    clipboard = `One | ${'13'.repeat(32)}\nTwo | ${'24'.repeat(32)}`;
    await press('Paste and review keys');
    let tree = render();
    assert(text(tree).indexOf('One') < text(tree).indexOf('Two'));
    assert(!JSON.stringify(tree).includes('13'.repeat(32)));
    assert(!JSON.stringify(tree).includes('24'.repeat(32)));
    (field(tree, 'Wallet PIN').props.onChangeText as (value: string) => void)('fixture password');
    await press('Save keys');
    assert.equal(confirmed, 1);
    await press('Import multiple keys');
    await press('Paste and review keys');
    render();
    t.mock.timers.tick(90000);
    assert.match(text(render()), /Review expired/);
    assert.equal(all(render()).filter((node) => node.type === 'TextInput').length, 0);
    await press('Import multiple keys');
    const late = Promise.withResolvers<string>();
    pendingClipboard = late.promise;
    const reading = press('Paste and review keys');
    f.emit('blur');
    late.resolve(clipboard);
    await reading;
    tree = render();
    assert(!text(tree).includes('One'));
    assert.equal(all(tree).filter((node) => node.type === 'TextInput').length, 0);
    assert.equal(confirmed, 1);
  } finally { f.dispose(); }
});

for (const parentLast of [false, true]) test(`Sentry settings Android Back drains its read before the parent returns (${parentLast ? 'parent-last' : 'child-last'})`, async () => {
  const parent = setup(), child = setup();
  child.native.BackHandler = parent.back;
  child.native.AppState = parent.native.AppState;
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = (f: ReturnType<typeof setup>) => ({
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header', Row: 'Row' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  });
  const settingsView = evaluate(load('NativeSentrySettings'), {
    ...common(child), './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common(child)), './PinEntry': pinFieldFixture(child),
  }).NativeSentrySettings as (props: object) => Element;
  const parentView = evaluate(load('NativeSentryKeys'), {
    ...common(parent), './NativeSentrySettings': { NativeSentrySettings: 'SettingsChild' },
    './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common(parent)), './PinEntry': pinFieldFixture(parent),
    '../../../../source/wallet/sentryKeyVault': { isAllowedSentryKeyRoleScheme },
    '../../../../source/utils/sentry/importBatch': { containsSentryPrivateKey },
    'expo-clipboard': {},
  }).NativeSentryKeys as (props: object) => Element;
  const held = Promise.withResolvers<void>();
  let readGuard!: () => void, cancelled = 0, closed = 0;
  const unused = async () => { throw Error('Unexpected key operation'); };
  const manager: NativeSentryKeyManagement = {
    async getSettings(check) {
      readGuard = check;
      await held.promise;
      check();
      return { serviceUrl: 'https://sysnode.info', maxFeeSatoshis: '100000' };
    },
    saveSettings: unused, list: async () => [], prepareImport: unused, confirmImport: unused,
    prepareRemoval: unused, confirmRemoval: unused, cancel() { cancelled++; }, dispose() {},
  };
  const props = { networkLabel: 'Syscoin', open: async () => manager, onBack() { closed++; } };
  const renderParent = () => parent.expand(parent.renderOwner(parentView, props)) as Element;
  let settingsProps!: object;
  const renderChild = () => child.expand(child.renderOwner(settingsView, settingsProps)) as Element;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    renderParent(); await tick();
    press(button(renderParent(), 'Service settings'));
    const selected = renderParent();
    assert.equal(selected.type, 'SettingsChild');
    settingsProps = selected.props;
    renderChild(); await tick();
    if (parentLast) {
      props.onBack = () => { closed++; };
      renderParent();
    }
    parent.hardware();
    assert.match(text(renderChild()), /Closing service settings/);
    assert.equal(renderParent().type, 'SettingsChild');
    assert.throws(readGuard, /CANCELLED/);
    assert.equal(cancelled, 0);
    assert.equal(closed, 0);
    assert.equal(parent.defaults(), 0);
    if (parentLast) held.reject(Error('Held read failed'));
    else held.resolve();
    await tick();
    assert.equal(cancelled, 1);
    assert.equal(closed, 0);
    assert.ok(button(renderParent(), 'Import key'));
  } finally { held.resolve(); child.dispose(); parent.dispose(); }
});

test('Sentry settings Back cannot return a replacement owner after its old read fails', async () => {
  const f = setup();
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = {
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const view = evaluate(load('NativeSentrySettings'), {
    ...common, './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common), './PinEntry': pinFieldFixture(f),
  }).NativeSentrySettings as (props: object) => Element;
  const held = Promise.withResolvers<{ serviceUrl: string; maxFeeSatoshis: string }>();
  let oldReturns = 0, newReturns = 0;
  const saveSettings = async () => { throw Error('Unexpected save'); };
  let props = { manager: { getSettings: async () => held.promise, saveSettings }, assertCurrent() {},
    networkLabel: 'Syscoin', onBack() { oldReturns++; } };
  const render = () => f.expand(f.renderOwner(view, props)) as Element;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    render(); await tick();
    press(button(render(), 'Cancel'));
    assert.match(text(render()), /Closing service settings/);
    props = { ...props, manager: { getSettings: async () => ({ serviceUrl: 'https://new.example', maxFeeSatoshis: '200000' }), saveSettings },
      onBack() { newReturns++; } };
    render(); await tick();
    held.reject(Error('Old read failed'));
    await tick();
    assert.equal(oldReturns, 0);
    assert.equal(newReturns, 0);
    assert.equal(field(render(), 'Sentry service origin').props.value, 'https://new.example');
  } finally { held.reject(Error('Cleanup')); f.dispose(); }
});

test('Sentry settings repeated Save keeps Back joined to the original operation', async () => {
  const f = setup();
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = {
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const view = evaluate(load('NativeSentrySettings'), {
    ...common, './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common), './PinEntry': pinFieldFixture(f),
  }).NativeSentrySettings as (props: object) => Element;
  const held = Promise.withResolvers<void>();
  let saves = 0, returned = 0, writes = 0;
  const props = { manager: {
    getSettings: async () => ({ serviceUrl: 'https://sysnode.info', maxFeeSatoshis: '100000' }),
    async saveSettings(settings: { serviceUrl: string; maxFeeSatoshis: string }, _password: string, check: () => void) {
      saves++;
      if (saves > 1) throw Error('BUSY');
      await held.promise;
      check();
      writes++;
      return settings;
    },
  }, assertCurrent() {}, networkLabel: 'Syscoin', onBack() { returned++; } };
  const render = () => f.expand(f.renderOwner(view, props)) as Element;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    render(); await tick();
    (field(render(), 'Confirm wallet PIN').props.onChangeText as (value: string) => void)('Fixture password 1!');
    const tree = render(), save = button(tree, 'Save settings');
    press(save); press(save);
    press(button(tree, 'Cancel'));
    await tick();
    assert.equal(saves, 1);
    assert.equal(returned, 0);
    assert.match(text(render()), /Closing service settings/);
    held.resolve(); await tick();
    assert.equal(writes, 0);
    assert.equal(returned, 1);
  } finally { held.resolve(); f.dispose(); }
});

test('Sentry settings handles a synchronous stale-at-open failure without a read', async () => {
  const f = setup();
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = {
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const view = evaluate(load('NativeSentrySettings'), {
    ...common, './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common), './PinEntry': pinFieldFixture(f),
  }).NativeSentrySettings as (props: object) => Element;
  let writes = 0;
  const props = { manager: {
    getSettings(): Promise<never> { throw Error('CANCELLED'); },
    async saveSettings() { writes++; throw Error('Unexpected save'); },
  }, assertCurrent() {}, networkLabel: 'Syscoin', onBack() {} };
  try {
    assert.doesNotThrow(() => f.renderOwner(view, props));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const tree = f.expand(f.renderOwner(view, props)) as Element;
    assert.match(text(tree), /Could not load service settings/);
    assert.equal(button(tree, 'Save settings').props.disabled, true);
    assert.equal(writes, 0);
  } finally { f.dispose(); }
});


test('private deposit backup returns its public task and discards stale export callbacks', async () => {
  for (const finish of ['saved', 'back', 'changed-context'] as const) {
    const f = await walletFeedbackFixture(false, false, undefined, undefined, true);
    try {
      const tools = all(f.render()).find(node => node.type === 'RealTools'); assert(tools);
      (tools.props.onPrivateNotes as () => void)();
      let menu = f.render(); assert.equal(menu.type, 'NativeNoteFilesMenu');
      (menu.props.onDeposit as () => void)();
      let deposit = f.render(); assert.equal(deposit.type, 'NativePrivateDeposit');
      assert.equal(deposit.props.initialTask, undefined);
      const task = { poolId: 'eth-10', noteId: 'public-note-id' };
      (deposit.props.onBackup as (task: object) => void)(task);
      if (finish === 'saved') f.noteRestore.exportStep = { phase: 'saved', noteCount: 1 };
      const exported = f.render(); assert.equal(exported.type, 'NativeNoteExport');
      assert.equal(exported.props.doneLabel, 'Continue deposit');
      assert(!JSON.stringify(exported.props).includes('intentId'));
      if (finish === 'changed-context') f.publish({ revision: 2, account: { address: '0x' + '22'.repeat(20), network: 'syscoin-nevm' } });
      (exported.props.onBack as () => void)();
      const after = f.render();
      if (finish === 'changed-context') { assert.notEqual(after.type, 'NativePrivateDeposit'); continue; }
      assert.equal(after.type, 'NativePrivateDeposit');
      assert.deepEqual(JSON.parse(JSON.stringify(after.props.initialTask)), task);
      assert.deepEqual(Object.keys(after.props.initialTask as object).sort(), ['noteId', 'poolId']);
      (exported.props.onBack as () => void)();
      assert.deepEqual(JSON.parse(JSON.stringify(f.render().props.initialTask)), task, 'retired export cannot navigate again');
      (after.props.onBack as () => void)(); menu = f.render();
      (menu.props.onDeposit as () => void)(); deposit = f.render();
      assert.equal(deposit.props.initialTask, undefined, 'a new deposit starts without the old task');
    } finally { f.dispose(); }
  }
});

for (const family of ['evm', 'utxo'] as const) test(`contextual ${family} network picker preserves Cancel draft and resets only after a proven selection`, async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, family);
  const form = family === 'evm'
    ? { kind: 'evm', recipient: '0x52908400098527886E0F7030069857D2E4169EE7', amount: '2.5', nonce: '8', tokenId: '3', max: true, advanced: true }
    : { kind: 'utxo', recipient: UTXO_ADDRESSES.bitcoin, amount: '0.2', max: true, rbf: false };
  const sendType = family === 'evm' ? 'NativeSend' : 'NativeUtxoSendScreen';
  try {
    const portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    (portfolio.props.onSend as () => void)();
    let send = f.render(); assert.equal(send.type, sendType);
    (send.props.onChangeNetwork as (value: object) => void)(form);
    await new Promise(resolve => setImmediate(resolve));
    let picker = f.render(); assert.equal(picker.type, 'NativeNetworks');
    (picker.props.onBack as () => void)();
    send = f.render(); assert.equal(send.type, sendType);
    const expected = { ...form }; delete (expected as { kind?: string }).kind;
    const retained = { ...(send.props.initialDraft as object) }; delete (retained as { kind?: string }).kind;
    assert.deepEqual(JSON.parse(JSON.stringify(retained)), expected);
    assert.throws(() => (picker.props.selection as { assertCurrent(): void }).assertCurrent(), /CANCELLED/);
    (send.props.onChangeNetwork as (value: object) => void)(form); await new Promise(resolve => setImmediate(resolve));
    picker = f.render();
    const view = picker.props.controller as ReturnType<typeof createNativeNetworkView>;
    const target = family === 'evm' ? 'syscoin-nevm' : 'syscoin';
    const receipt = await view.select(target, view.getContextRevision(), view.getSnapshot()!.revision, () => {});
    (picker.props.selection as { onSelected(value: unknown): void }).onSelected(receipt);
    send = f.render(); assert.equal(send.type, sendType);
    const fresh = send.props.initialDraft as { amount: string; recipient: string; nonce?: string; max: boolean };
    assert.equal(fresh.amount, ''); assert.equal(fresh.max, false);
    assert.equal(fresh.recipient, family === 'evm' ? form.recipient : '');
    if (family === 'evm') assert.equal(fresh.nonce, '');
    assert.equal(send.props.draftNotice, NETWORK_CHANGED_DRAFT_NOTICE);
    assert.equal(send.props.authentication, undefined); assert.equal(send.props.review, undefined);
  } finally { f.dispose(); }
});

test('Receive network selection returns to the canonical address and does not reuse the previous network acknowledgement', async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm');
  try {
    let portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    const continuation = { account: { network: 'ethereum', address: '0x' + '11'.repeat(20), revision: 1 }, backupAcknowledged: true };
    (portfolio.props.onChangeReceiveNetwork as (value: object) => void)(continuation);
    let picker = f.render(); assert.equal(picker.type, 'NativeNetworks');
    (picker.props.onBack as () => void)();
    portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    assert.deepEqual(JSON.parse(JSON.stringify(portfolio.props.initialReceive)), continuation);
    (portfolio.props.onChangeReceiveNetwork as (value: object) => void)(continuation);
    picker = f.render();
    const view = picker.props.controller as ReturnType<typeof createNativeNetworkView>;
    const receipt = await view.select('bitcoin', view.getContextRevision(), view.getSnapshot()!.revision, () => {});
    (picker.props.selection as { onSelected(value: unknown): void }).onSelected(receipt);
    portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    assert.deepEqual(JSON.parse(JSON.stringify(portfolio.props.initialReceive)), {
      account: { address: UTXO_ADDRESSES.bitcoin, network: 'bitcoin', revision: 2 }, backupAcknowledged: false,
    });
  } finally { f.dispose(); }
});
