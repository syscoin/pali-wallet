import { Transaction } from 'ethers/transaction';
import { PALI_RECOVERY_ALERTS_URL } from '../../../source/shared/smartAccountLinks.ts';
import { getNativeGuardianRecoveryChoices } from '../src/smartAccount/guardianRecovery.ts';
import { credentialPromptActivityState } from '../src/platform/credentialPort.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createIdleComponentFixture } from './idleComponentFixture.ts';
import { createSecurityRuntime } from '../src/core/securityRuntime.ts';
import { nativeTranslationFixture, languageMessages } from './localizationFixture.ts';
import { createInstance } from 'i18next';
import { findUtxoNetwork, UTXO_NETWORKS, supportsUtxoSoftwareCustody } from '../src/core/utxoNetworks.ts';
import { supportsSptUtxoChain, sptBalanceTotalUnits } from '../../../source/shared/sptInventory.ts';
import { createNativeNetworkView } from '../src/custody/networkView.ts';
import type { NativeNetworkSelectionProof } from '../src/custody/accounts.ts';
import { networkSelectionReceiptFixture } from './networkSelectionReceiptFixture.ts';
import { sendDraftForNetwork, NETWORK_CHANGED_DRAFT_NOTICE } from '../src/screens/sendNetworkDraft.ts';
import * as publicSendDraft from '../src/screens/publicSendDraft.ts';
import { trezorResumeDraft } from '../src/screens/trezorResumeDraft.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { sameNativePortfolioAccount } from '../src/portfolio/nativePortfolio.ts';
import { UTXO_ADDRESSES } from './publicWatchFixtures.ts';
import { NativeControllerLifecycle } from '../src/custody/nativeControllerLifecycle.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { NativeRecoveryFlow } from '../src/custody/recoveryFlow.ts';
import * as recoveryCopy from '../src/screens/recoveryCopy.ts';
import { createNativeNoteRestore } from '../src/custody/nativeNoteRestore.ts';
import { createNativePrivateAuthenticationScope, type NativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { createNoteBackupCodec } from '../../../source/wallet/noteBackup.ts';
import * as networkContext from '../src/custody/networkContext.ts';
import { isAllowedSentryKeyRoleScheme, type SentryKeySummary } from '../../../source/wallet/sentryKeyVault.ts';
import { containsSentryPrivateKey, parseSentryKeyBatch } from '../../../source/utils/sentry/importBatch.ts';
import { createNativeSentryKeyManagement, type NativeSentryKeyManagement } from '../src/custody/sentryKeyManagement.ts';
import type { NativeConnectionsView } from '../src/connections/types.ts';
import type { NativeTrezorResumeIntent, NativeTrezorView } from '../src/custody/trezorAccounts.ts';
import { quietActivityNotifications, type NotificationTestPort } from './notificationFixture.ts';

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
  './publicSendDraft': publicSendDraft,
  './recoveryCopy': recoveryCopy,
  './NativeAccountOverview': { NativePortfolioRoute: 'NativePortfolio' },
  '../notifications/service': { nativeActivityNotifications: quietActivityNotifications, isNotificationPermissionPromptActive: () => false },
    '../platform/cameraPermission': { isCameraPermissionPromptActive: () => false },
  '../activity/accountActivity': { AccountActivityController: class {} },
  './BackupIntroduction': { BackupIntroduction: 'BackupIntroduction' },
  './WalletUpdatePanel': { LockedWalletUpdate: () => null },
  './NativeImportWallet': { NativeImportWallet: 'NativeImportWallet' },
  './BackupVerification': { BackupVerification: 'BackupVerification' },
};
function evaluate(source: string, dependencies: Record<string, unknown>, flow = false) {
  dependencies = { '../platform/localization': nativeTranslationFixture, ...dependencies };
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
function setup(phase = 'entry', translation = nativeTranslationFixture) {
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
    '../platform/localization': translation,
    './IdleActivityBoundary': idle.components,
    './recoveryCopy': recoveryCopy,
    react: hook, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
  });
  const snapshot: Snapshot = { phase, inventory, error: '', fieldErrors: {} };
  const calls = { starts: 0, backs: 0, cancels: 0, submits: 0, commits: 0 };
  let admitted = true;
  const flow = { getSnapshot: () => snapshot, isAuthenticating: () => false, subscribe: () => () => {}, start() { calls.starts++; },
    back() { calls.backs++; }, cancel() { calls.cancels++; }, enter() { snapshot.phase = 'entry'; },
    submit(input: Record<string, string>) { calls.submits++; assert.deepEqual(Object.keys(input).sort(), ['phrase']); if (admitted) snapshot.phase = 'verifying'; return admitted; },
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

test('recovery verifies the phrase before device-protected restoration', () => {
  const f = setup(); let tree = f.render();
  (field(tree, 'Recovery word 1').props.onChangeText as (text: string) => void)('abandon '.repeat(11) + 'about');
  tree = f.render(); press(button(tree, 'Continue'));
  assert.equal(f.calls.submits, 1); assert.equal(f.snapshot.phase, 'verifying');
  tree = f.render(); assert.equal(all(tree).filter(e => e.type === 'TextInput').length, 0);
  assert.notEqual(tree.type, 'PinSetup');
  f.snapshot.phase = 'review'; tree = f.render();
  assert.ok(all(tree).some(e => e.type === 'Notice' && /phrase matches/.test(String(e.props.title)))); press(button(tree, 'Restore secure access'));
  tree = f.render(); assert.notEqual(tree.type, 'PinSetup');
  assert.equal(f.snapshot.phase, 'committing');
  f.dispose();
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

test('committing copy does not promise cancellation rolls back a completed access change', () => {
  const f = setup('committing'); const tree = f.render();
  assert.match(text(tree), /access change may already have completed/); assert.ok(button(tree, 'Leave recovery'));
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
    guardianRecovery: { supportsPasskeys: () => false, hasIntent: () => false, async open() { throw Error('Unavailable in this fixture'); } },
    authority: { getSnapshot: () => state, getCatalogue: () => null, supportsAccountManagement: () => false,
      async getAuthenticationStatus() { return { deviceAuth: 'ready', credentialPresent: true };  },
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

    '../custody/nativeControllerLifecycle': { NativeControllerLifecycle }, '../custody/recoveryFlow': { NativeRecoveryFlow },
    './NativeRecovery': { NativeRecovery: leaf.component }, '../custody/networkView': { createNativeNetworkView: () => ({}) },
    './useNativeNoteBackup': { useNativeNoteBackup: () => noteRestore },
    './useRealShell': { useRealShell: () => ({ tab: 'wallet', navigation: {}, goBack() { exits++; }, restoreRoot() {} }) },
  });
  const Root = evaluate(source, dependencies).NativeWalletContent as (props: object) => Element;
  const props = { controllerRef: { current: null }, onExit() { exits++; } };
  owner = 'parent'; root.renderOwner(Root, props);
  await new Promise((resolve) => setImmediate(resolve));
  let tree = root.renderOwner(Root, props); press(button(tree, 'Restore access'));
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

test('recovery renders controller errors in the chosen language without English fallback', async () => {
  const i18n = createInstance();
  await i18n.init({ initImmediate: false, lng: 'de', fallbackLng: false,
    resources: { de: { translation: languageMessages('de') } } });
  const f = setup('entry', { nativeI18n: i18n, useNativeTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) });
  try {
    f.snapshot.error = 'WRONG_PHRASE';
    const tree = f.render();
    assert.match(text(tree), /Diese Wiederherstellungsphrase gehört nicht zu dieser Wallet/);
    assert.doesNotMatch(text(tree), /WRONG_PHRASE|does not match/);
  } finally { f.dispose(); }
});

async function walletFeedbackFixture(deviceUnlock = false, empty = false, setting?: { enabled: boolean; wait: Promise<void> }, backupCompletion?: Promise<void>, depositMode = false, networkMode?: 'evm' | 'utxo', pinChange?: { calls: [string, string][]; refusal: 'INVALID_CREDENTIAL' | 'AUTH_THROTTLED'; verifyCalls?: string[]; wait?: Promise<void> }, notificationPort: NotificationTestPort = quietActivityNotifications,
  networkLifecycle?: { wait?: Promise<void>; onAuthenticating?(): void; tab?: 'wallet' | 'activity'; phases?: string[]; backup?: 'confirmed' | 'unconfirmed' }, utxoResume?: { nativeUnits: string }, restoreFailure?: { commits: number }, networkOverride?: networkContext.NativeNetworkRegistration, publicNavigation?: { initialAccountId: string }, idleClock?: { minutes: number; time: number }) {
  const root = setup();
  if (idleClock) {
    await root.idle.ready;
    const security = createSecurityRuntime({
      async get() { return JSON.stringify({ version: 1, custodyIdleMinutes: idleClock.minutes, watchIdleMinutes: 0 }); },
      async set() { assert.fail('The lifecycle test must not change the configured timeout'); },
    }, () => ({ monotonic: idleClock.time, wall: idleClock.time }));
    await security.securityPreferences.load();
    Object.assign(root.idle.security, security);
  }
  const networkId = networkMode === 'utxo' ? utxoResume ? 'syscoin' : 'bitcoin' : networkOverride?.id ?? 'ethereum';
  const address = `0x${'11'.repeat(20)}`;
  let catalogue = { revision: 1, active: { accountId: 'hd:60:0', networkId },
    accounts: [{ id: 'hd:60:0', type: utxoResume ? 'Trezor' : 'HDAccount', index: 0, slip44: 60, address, label: 'Account 1' }],
    networks: networkOverride ? [...networkContext.NATIVE_NETWORKS.filter(network => network.id !== networkOverride.id), networkOverride] : networkContext.NATIVE_NETWORKS, utxoNetworks: networkMode ? UTXO_NETWORKS : [] };
  let state: { phase: string; revision: number; presence: string; backup: string; account: { address: string; network: string } | null; error: string | null } =
    { phase: setting || depositMode || networkMode || pinChange ? 'ready' : empty ? 'empty' : 'locked', revision: 1, presence: empty ? 'empty' : 'existing', backup: empty ? 'unconfirmed' : 'confirmed', account: setting || depositMode || networkMode || pinChange ? { address, network: networkId } : null, error: null };
  if (publicNavigation) catalogue = { ...catalogue, accounts: [...catalogue.accounts, { ...catalogue.accounts[0]!, id: 'hd:60:1', index: 1, address: '0x' + '22'.repeat(20), label: 'Account 2' }] };
  const selectedAccounts: string[] = [];
  let observer: (snapshot: typeof state) => void = () => {};
  let nextError: string | null = null;
  let credentialPresent = !empty, recoveryInventoryReads = 0;
  let releasePrompt!: () => void;
  let locks = 0;
  let backupFailure: Error | undefined;
  const lifecycle: string[] = [];
  const notificationRoutes: { tab: string; identity: string }[] = [];
  const enrollments: { enabled: boolean; password?: string }[] = [];
  const configurations: { enabled: boolean; signal: AbortSignal; authentication: NativePrivateAuthenticationScope }[] = [];
  let biometricsEnabled = deviceUnlock && (setting?.enabled ?? !empty);
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
    getNotificationChoices: () => networkContext.NATIVE_NETWORKS.map(network => ({ label: 'Account 1', networkName: network.name, symbol: network.symbol,
      scope: { id: `native:hd:60:0:${network.id}`, accountId: 'hd:60:0', accountType: 'HDAccount', accountAddress: address, network, guardian: false } })),
    canManageGuardianPolicy: () => false, canSignSmartAccount: () => false, canManageSlhDsa: () => false,
    canManageSmartAccountModules: () => false,
    async openSmartAccountModules() { throw Error('Modules are outside this fixture'); },
    async openSlhDsaManagement() { throw Error('SLH is outside this fixture'); },
    canUseWalletAuthenticator: () => false,
    guardianRecovery: { supportsPasskeys: () => false, hasIntent: () => false, async open() { throw Error('Unavailable in this fixture'); } },
    ...(deviceUnlock ? { authentication } : {}),
    async configureDeviceUnlock(enabled: boolean, signal: AbortSignal, authentication: NativePrivateAuthenticationScope, check: () => void) {
      check(); configurations.push({ enabled, signal, authentication });
      if (setting) await setting.wait;
      check(); if (signal.aborted) throw Error('CANCELLED');
      biometricsEnabled = enabled; enrollments.push({ enabled });
    },
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
      async getAuthenticationStatus() { return { deviceAuth: 'ready', credentialPresent }; },
      async getDeviceUnlockStatus() { return { available: deviceUnlock, enabled: biometricsEnabled }; },
      async create() { publish({ phase: 'backup-required', presence: 'existing', backup: 'unconfirmed' }); },
      async setDeviceUnlock(enabled: boolean, password: string, check: () => void) {
        check();
        if (setting) { publish({ phase: 'authenticating', account: null }); await setting.wait; }
        check(); biometricsEnabled = enabled; enrollments.push({ enabled, password });
        if (setting) publish({ phase: 'ready', account: { address, network: 'ethereum' } });
      },
      async unlockWithDevice(check: () => void) {
        check(); publish({ phase: 'authenticating', error: null });
        try { await authentication.run(null, () => new Promise<void>(resolve => { releasePrompt = resolve; })); }
        catch (cause) { publish({ phase: 'locked', account: null, error: 'DEVICE_UNLOCK_UNAVAILABLE' }); throw cause; }
        check(); publish({ phase: 'backup-required', backup: 'unconfirmed', account: { address, network: networkId }, error: null });
      },
      lock() { if (deviceUnlock || pinChange || restoreFailure || idleClock) { lifecycle.push('lock'); locks++; publish({ phase: 'locked', revision: state.revision + 1, account: null }); } }, async dispose() { state = { ...state, phase: 'disposed' }; },
      async unlock() {
        publish({ phase: 'authenticating', error: null });
        if (nextError) { const code = nextError; publish({ phase: 'locked', error: code }); throw new Error(code); }
        publish({ phase: 'backup-required', backup: 'unconfirmed', account: { address, network: networkId }, error: null });
      } },
    accounts: { async execute(request: { kind: string; id: string }, contextRevision: number, catalogueRevision: number) {
      assert(publicNavigation); assert.equal(request.kind, 'select');
      assert.equal(state.revision, contextRevision); assert.equal(catalogue.revision, catalogueRevision);
      const selected = catalogue.accounts.find(account => account.id === request.id); assert(selected);
      selectedAccounts.push(request.id);
      catalogue = { ...catalogue, revision: catalogue.revision + 1, active: { ...catalogue.active, accountId: request.id } };
      publish({ phase: 'ready', revision: state.revision + 1, account: { address: selected.address, network: networkId } });
    } }, balanceReader: {}, transfers: { cancel() {} }, tokens: {}, activity: {},
    trezor: trezorLifecycle(), connections: { ...psbtLifecycle(lifecycle), getSnapshot: () => ({ status: 'ready', signingReview: null, proposals: [] }), subscribe: () => () => {}, cancel() {} },
    removal: { requiresControllerReopen: () => false, cancel() {}, async dispose() {}, hasVerifiedRemoval: () => false },
    keyExport: { cancel() {}, dispose() {} }, backup: {
      cancel() {}, dispose() {}, onClear: () => () => {},
      async begin(password: string) {
        if (backupFailure) throw backupFailure;
        assert(backupCompletion, 'Backup is outside this fixture');
        assert.equal((password as unknown as { method: string }).method, 'device');
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
    async readRecoveryInventory() { recoveryInventoryReads++; return inventory; },
  };
  let realAuthority: NativeCustodyAuthority | undefined, renderTransition: (() => void) | undefined;
  if (networkLifecycle) {
    const runtime = {
      session: { async unlock() { return { authenticated: true }; }, async readSelectedAddress() { return address; }, async lock() { locks++; } },
      storage: { async readState() { return { presence: 'existing', backup: networkLifecycle.backup ?? 'confirmed' }; }, async close() {} },
      accounts: { getSnapshot: () => catalogue },
      networks: { getSelectedId: () => catalogue.active.networkId,
        reserve(id: string, revision: number) { return { cancel() {}, async execute(check: () => void) {
          await networkLifecycle.wait; check();
          const target = networkContext.getNativeNetwork(id);
          catalogue = { ...catalogue, revision: revision + 1, active: { ...catalogue.active, networkId: id } };
          return { sourceCatalogueRevision: revision, target, selection: { ...catalogue.active, address },
            assertCurrent() { assert.equal(catalogue.revision, revision + 1); assert.equal(catalogue.active.networkId, id); } };
        } }; },
      },
    };
    realAuthority = new NativeCustodyAuthority({ open: async () => runtime as never });
    Object.assign(realAuthority, { supportsAccountManagement: () => false, getAuthenticationStatus: controllers.authority.getAuthenticationStatus });
    realAuthority.subscribe(value => {
      state = value;
      networkLifecycle.phases?.push(value.phase);
      if (value.phase === 'authenticating') { networkLifecycle.onAuthenticating?.(); renderTransition?.(); }
    });
    controllers.authority = realAuthority as unknown as typeof controllers.authority;
  }
  const source = readFileSync(new NodeURL('../src/screens/NativeWallet.native.tsx', import.meta.url), 'utf8');
  const dependencies: Record<string, unknown> = Object.fromEntries([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => [match[1]!, {}]));
  const noteRestore = { cancel() {}, lock() {}, resume: () => false, step: { phase: 'select' }, exportStep: { phase: 'select' } as { phase: 'select' | 'saved'; noteCount?: number }, busy: false, error: '',
    begin(mode: string) { assert(depositMode && mode === 'export'); return true; } };
  Object.assign(dependencies, {
    ...walletScreenPorts,
    '../notifications/service': { nativeActivityNotifications: notificationPort, isNotificationPermissionPromptActive: () => false },
    '../platform/cameraPermission': { isCameraPermissionPromptActive: () => false },
    '../portfolio/nativePortfolio': { NativePortfolioController: class {
      getSnapshot = () => utxoResume && state.account ? { status: 'available', units: utxoResume.nativeUnits, account: { ...state.account, revision: state.revision } } : null;
      subscribe = () => () => {}; connect() { return () => {}; }
    }, sameNativePortfolioAccount },
    '../core/amounts': { formatBaseUnits },
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
    '../platform/localization': nativeTranslationFixture,
    '../../../../source/shared/smartAccountLinks.ts': { PALI_RECOVERY_ALERTS_URL },
    '../smartAccount/guardianRecovery': { getNativeGuardianRecoveryChoices },
    '../platform/security': root.idle.security, './IdleActivityBoundary': root.idle.components,
    react: root.hook, 'react-native': root.native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...root.ui, Header: 'Header', PaliMark: 'PaliMark' },
    '../platform/nativeFactory': { createNativeWalletControllers: () => controllers, createNativeRecoveryCoordinator: () => { throw Error('unused'); } },
    '../platform/privacyShield.native': { async ensurePrivacyShield() {} },
    '../core/utxoNetworks': { findUtxoNetwork, supportsUtxoSoftwareCustody },
    '../../../../source/shared/sptInventory': { supportsSptUtxoChain, sptBalanceTotalUnits },
    '../custody/nativeControllerLifecycle': { NativeControllerLifecycle }, '../custody/recoveryFlow': { NativeRecoveryFlow },
    '../custody/networkContext': networkContext,
    '../../../../source/shared/evmNetworks': { EVM_NETWORK_DEFINITIONS: [{ id: 'ethereum', name: 'Ethereum' }] },
    './NativeSend': { NativeSend: 'NativeSend' }, './NativeUtxoSend': { NativeUtxoSendScreen: 'NativeUtxoSendScreen' },
    './NativeTrezor': { NativeTrezor: 'NativeTrezor', NativeTrezorResumeNotice: 'NativeTrezorResumeNotice' },
    './trezorResumeDraft': { trezorResumeDraft },
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
    './useRealShell': { useRealShell: () => ({ tab: networkLifecycle?.tab ?? (depositMode ? 'tools' : 'wallet'), navigation: {}, goBack() {}, select(tab: string) { notificationRoutes.push({ tab, identity: 'tab-switch' }); }, restoreRoot(tab: string, identity: string) { notificationRoutes.push({ tab, identity }); } }) },
    './AllNetworksActivity': { AllNetworksActivity: 'AllNetworksActivity' },
  });
  if (restoreFailure) {
    const file = await createNoteBackupCodec({ crypto: globalThis.crypto, assertCurrent() {} }).encrypt({
      format: 'pali-private-notes', version: 1, createdAt: 1,
      notes: [{ note: 'tornado-eth-1-1-0x' + '01'.repeat(62), createdAt: 1 }],
    }, 'Portable test backup password');
    Object.assign(controllers, {
      async captureNoteFileOwner() { return async () => undefined; },
      async openNoteBackup(check: () => void) {
        check();
        return { begin: () => 'restore-preview', cancel() {}, async prepareImport() {
          check(); return { id: 'restore-preview', added: 1, duplicates: 0, guarded: 0, expiresAt: performance.now() + 10000 };
        }, async commitImport() { check(); restoreFailure.commits++; throw Error('BACKUP_COMMIT_UNCONFIRMED'); } };
      },
    });
    dependencies['./NativeNoteRestore'] = { NativeNoteRestore: 'NativeNoteRestore', NoteRestoreUnconfirmedNotice: 'NoteRestoreUnconfirmedNotice' };
    dependencies['./useNativeNoteBackup'] = evaluate(readFileSync(new NodeURL('../src/screens/useNativeNoteBackup.ts', import.meta.url), 'utf8'), {
      react: root.hook, 'react-native': root.native,
      '../custody/privateAuthentication': { createNativePrivateAuthenticationScope },
      './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
      '../platform/noteBackupPicker': { shouldLockWalletForNotePicker: () => false, pickNoteBackupFile: async () => file.slice() },
      '../custody/nativeNoteRestore': { createNativeNoteRestore },
    });
  }
  const Root = evaluate(source, dependencies).NativeWalletContent as (props: object) => Element;
  const props = { controllerRef: { current: null }, initialAccountId: publicNavigation?.initialAccountId, onExit() {} };
  const render = () => root.renderOwner(Root, props);
  render(); await new Promise((resolve) => setImmediate(resolve));
  if (realAuthority) { await realAuthority.unlock(); render(); renderTransition = render; }
  const unlock = async (error: string | null) => {
    nextError = error;
    const tree = render();
    press(button(tree, 'Open wallet'));
    await new Promise((resolve) => setImmediate(resolve));
    return render();
  };
  return { render, unlock, publish, noteRestore, notificationRoutes, publicViewLock: root.idle.security.publicViewLock,
    failBackup(error: Error) { backupFailure = error; },
    loseCredential() { credentialPresent = false; publish({}); }, get recoveryInventoryReads() { return recoveryInventoryReads; },
    selectedAccounts, selectedAddress: () => state.account?.address, requestAccount(id: string) { props.initialAccountId = id; return render(); }, selectedNetwork: () => state.account?.network, authority: realAuthority, dispose: root.dispose, emit: root.emit, hardware: root.hardware, releasePrompt: () => releasePrompt(), enrollments, configurations, backupAcknowledgements, lifecycle, get locks() { return locks; } };
}

async function nativeIdleFixture(clock: { minutes: number; time: number }) {
  return walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined,
    quietActivityNotifications, undefined, undefined, undefined, undefined, undefined, clock);
}
const lifecycleTick = () => new Promise<void>(resolve => setImmediate(resolve));

test('native background elapsed time cannot renew a configured privacy-lock deadline', async () => {
  const clock = { minutes: 5, time: 0 }, f = await nativeIdleFixture(clock);
  try {
    assert(all(f.render()).some(node => node.type === 'NativePortfolio'));
    clock.time = 10000; f.emit('change', 'background'); f.render();
    clock.time = 310000; f.emit('change', 'active'); await lifecycleTick();
    const returned = f.render();
    assert.equal(f.publicViewLock.getSnapshot().phase, 'locked');
    assert(!all(returned).some(node => node.type === 'NativePortfolio'));
    assert(button(returned, 'Unlock wallet'));
  } finally { f.dispose(); }
});

test('repeated short native returns preserve the original last-activity deadline', async () => {
  const clock = { minutes: 5, time: 0 }, f = await nativeIdleFixture(clock);
  try {
    for (const [background, foreground] of [[120000, 121000], [240000, 241000]] as const) {
      clock.time = background; f.emit('change', 'background'); f.render();
      clock.time = foreground; f.emit('change', 'active'); await lifecycleTick();
      assert(all(f.render()).some(node => node.type === 'NativePortfolio'));
      assert.equal(f.publicViewLock.getSnapshot().phase, 'unlocked');
    }
    clock.time = 299000; f.emit('change', 'background'); f.render();
    clock.time = 301000; f.emit('change', 'active'); await lifecycleTick();
    assert.equal(f.publicViewLock.getSnapshot().phase, 'locked');
    assert(button(f.render(), 'Unlock wallet'));
  } finally { f.dispose(); }
});

test('disabled native auto-lock still resumes the public view after a long background interval', async () => {
  const clock = { minutes: 0, time: 0 }, f = await nativeIdleFixture(clock);
  try {
    clock.time = 10000; f.emit('change', 'background'); f.render();
    clock.time = 86400000; f.emit('change', 'active'); await lifecycleTick();
    assert.equal(f.publicViewLock.getSnapshot().phase, 'unlocked');
    assert(all(f.render()).some(node => node.type === 'NativePortfolio'));
  } finally { f.dispose(); }
});

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

test('cancelled backup authorization returns to its introduction without locking the public wallet', async () => {
  const f = await walletFeedbackFixture(false, false, undefined, Promise.resolve());
  try {
    f.failBackup(new Error('CANCELLED'));
    let tree = await f.unlock(null);
    const home = all(tree).find(node => node.type === 'NativePortfolio'); assert(home);
    (home.props.onBackup as () => void)(); tree = f.render();
    const intro = all(tree).find(node => node.type === 'BackupIntroduction'); assert(intro);
    (intro.props.onStart as () => void)();
    await new Promise(resolve => setImmediate(resolve));
    tree = f.render();
    assert(all(tree).some(node => node.type === 'BackupIntroduction'));
    const returned = all(tree).find(node => node.type === 'BackupIntroduction'); assert(returned);
    assert.equal(returned.props.error, 'Request cancelled. You can try again.');
    assert.doesNotMatch(text(tree), /session was locked|abandon/);
    assert.equal(f.locks, 0);
  } finally { f.dispose(); }
});

test('automatic public entry selects the requested native account once without device authentication', async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, undefined,
    undefined, undefined, undefined, undefined, { initialAccountId: 'hd:60:1' });
  try {
    assert.deepEqual(f.selectedAccounts, ['hd:60:1']);
    assert.equal(f.selectedAddress(), '0x' + '22'.repeat(20));
    const tree = f.render(); const home = all(tree).find(node => node.type === 'NativePortfolio'); assert(home, text(tree));
    assert.equal((home.props.source as { getSnapshot(): { account: { address: string } } }).getSnapshot().account.address, f.selectedAddress());
    f.render(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.selectedAccounts, ['hd:60:1'], 'ordinary rerender must not replay account selection');
    assert.equal(f.enrollments.length, 0);
  } finally { f.dispose(); }
});

test('a changed requested native account is selected on the mounted public wallet', async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, undefined,
    undefined, undefined, undefined, undefined, { initialAccountId: 'hd:60:0' });
  try {
    assert.deepEqual(f.selectedAccounts, []);
    f.requestAccount('hd:60:1'); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.selectedAccounts, ['hd:60:1']);
    assert.equal(f.selectedAddress(), '0x' + '22'.repeat(20));
    f.requestAccount('hd:60:1'); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.selectedAccounts, ['hd:60:1']);
  } finally { f.dispose(); }
});

for (const phase of ['ready', 'backup-required'] as const) test(`missing device credential opens phrase recovery from ${phase} security`, async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm');
  try {
    const home = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(home);
    (home.props.onSecurity as () => void)(); f.render();
    f.loseCredential();
    f.publish({ phase, backup: phase === 'backup-required' ? 'unconfirmed' : 'confirmed' });
    await new Promise(resolve => setImmediate(resolve));
    const security = all(f.render()).find(node => node.type === 'NativeSecurity'); assert(security);
    assert.equal(typeof security.props.onRestoreAccess, 'function');
    (security.props.onRestoreAccess as () => void)();
    const recovery = f.render(); assert.equal(recovery.type, 'NativeRecovery');
    const flow = recovery.props.flow as NativeRecoveryFlow;
    flow.start(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(flow.getSnapshot().phase, 'scope');
    assert.equal(f.recoveryInventoryReads, 1);
    assert.equal(flow.getSnapshot().inventory?.status, 'needs-matching-phrase-verification');
    flow.cancel(); await new Promise(resolve => setImmediate(resolve));
  } finally { f.dispose(); }
});

test('wallet creation uses explicit device protection without offering a Pali PIN', async () => {
  const f = await walletFeedbackFixture(false, true);
  try {
    press(row(f.render(), 'Create a wallet')); const tree = f.render();
    assert.match(text(tree), /Protected by your phone/);
    assert.match(text(tree), /device’s biometrics or passcode/);
    assert.equal(all(tree).some(node => node.type === 'PinSetup' || node.type === 'PinEntryScreen'), false);
    assert.equal(button(tree, 'Create wallet').props.disabled, false);
    press(button(tree, 'Create wallet')); await new Promise(resolve => setImmediate(resolve));
    assert(!all(f.render()).some(node => node.type === 'PinSetup'));
  } finally { f.dispose(); }
});

test('actual native Sentry surface reviews once, copies only public data and retires held work on blur', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup();
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = {
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Row: 'Row' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const secure = evaluate(load('NoteBackupPasswordField'), common);
  const copied: string[] = [];
  const view = evaluate(load('NativeSentryKeys'), {
    ...common,
    './NativeSentrySettings': { NativeSentrySettings: () => null },
    './NoteBackupPasswordField': secure,
    '../../../../source/wallet/sentryKeyVault': { isAllowedSentryKeyRoleScheme },
    '../../../../source/utils/sentry/importBatch': { containsSentryPrivateKey, parseSentryKeyBatch },
    'expo-clipboard': { async setStringAsync(value: string) { copied.push(value); return true; } },
  }).NativeSentryKeys as (props: object) => Element;
  const secret = '13'.repeat(32), publicKey = '29'.repeat(48);
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
    isAuthenticating: () => false,
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
    async confirmImport(review) {
      assert.equal(review, importReview);
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
    async confirmRemoval(review, backedUp) {
      removalCount++;
      assert.equal(review, removeReview); assert.equal(backedUp, true);
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
    assert.equal(all(tree).some(node => node.props.accessibilityLabel === 'Wallet PIN'), false);
    assert.equal(button(tree, 'Save key').props.disabled, false);
    const save = button(render(), 'Save key');
    const savePending = activate(save); activate(save);
    await savePending;
    assert.equal(confirmCount, 1);
    openStored();
    await activate(button(render(), 'Copy public key'));
    assert.deepEqual(copied, [publicKey]);
    await activate(button(render(), 'Remove key'));
    tree = render();
    assert.equal(button(render(), 'Remove key').props.disabled, true);
    activate(button(render(), 'Remove key'));
    assert.equal(removalCount, 0);
    const checkbox = all(render()).find((item) => item.props.accessibilityRole === 'checkbox');
    assert.ok(checkbox); activate(checkbox);
    await activate(button(render(), 'Remove key'));
    assert.equal(removalCount, 1);
    assert.equal(keys.length, 0);

    await activate(draft());
    render();
    t.mock.timers.tick(90_000);
    assert.match(text(render()), /Review expired/);
    assert.equal(all(render()).filter((item) => item.type === 'TextInput').length, 0);
    assert.equal(confirmCount, 1);

    await activate(draft());
    const admitted = Promise.withResolvers<void>();
    busyConfirmation = admitted.promise;
    const blocked = activate(button(render(), 'Save key'));
    assert.equal(all(render()).some(node => node.props.accessibilityLabel === 'Wallet PIN'), false);
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

for (const interruption of ['owned', 'background', 'unowned'] as const) test(`Sentry keys distinguish ${interruption} biometric interruption from background`, async () => {
  const f = setup();
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = {
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Row: 'Row' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const view = evaluate(load('NativeSentryKeys'), {
    ...common, './NativeSentrySettings': { NativeSentrySettings: () => null },
    './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common),
    '../../../../source/wallet/sentryKeyVault': { isAllowedSentryKeyRoleScheme },
    '../../../../source/utils/sentry/importBatch': { containsSentryPrivateKey }, 'expo-clipboard': {},
  }).NativeSentryKeys as (props: object) => Element;
  const nativePrompt = new DeviceUnlockPrompt({
    state: () => f.native.AppState.currentState,
    subscribe(listener) {
      const changes = f.native.AppState.addEventListener('change', listener);
      const blur = f.native.AppState.addEventListener('blur', () => listener('blur'));
      const focus = f.native.AppState.addEventListener('focus', () => listener('focus'));
      return () => { changes.remove(); blur.remove(); focus.remove(); };
    },
  });
  const held = Promise.withResolvers<void>();
  const key = { id: 'key', network: 'mainnet', role: 'operator', scheme: 'bls-basic', label: 'Node', publicKey: '39'.repeat(48) } as const;
  let scope!: AbortSignal;
  let check: () => void = () => undefined;
  let proofOwned = false, writes = 0, retired = 0;
  let keys: readonly SentryKeySummary[] = [];
  const unused = async (): Promise<never> => { throw Error('Unexpected operation'); };
  const manager: NativeSentryKeyManagement = {
    isAuthenticating: () => credentialPromptActivityState('android', f.native.AppState.currentState, { isCredentialPromptActive: () => false }) !== 'background' && proofOwned && nativePrompt.isActive(scope),
    getSettings: unused, saveSettings: unused, list: async () => keys,
    prepareImport: async () => ({ network: 'mainnet', expiresAt: performance.now() + 90000, keys: [key] }),
    async confirmImport() {
      proofOwned = interruption !== 'unowned';
      try {
        await nativePrompt.run(scope, () => held.promise);
        check(); writes++; return keys = [key];
      } finally { proofOwned = false; }
    },
    prepareRemoval: unused, confirmRemoval: unused, cancel() {}, dispose() { retired++; },
  };
  const props = { networkLabel: 'Syscoin', onBack() {}, async open(signal: AbortSignal, guard: () => void) { scope = signal; check = guard; return manager; } };
  const render = () => f.expand(f.renderOwner(view, props)) as Element;
  const activate = (title: string) => (button(render(), title).props.onPress as () => unknown)();
  try {
    render(); await new Promise<void>(resolve => setImmediate(resolve));
    activate('Import key');
    (field(render(), 'Key label').props.onChangeText as (value: string) => void)('Node');
    (field(render(), 'Private key').props.onChangeText as (value: string) => void)('13'.repeat(32));
    await activate('Review key');
    const saving = activate('Save key');
    assert.equal(nativePrompt.isAnyPromptActive(), true);
    f.emit('change', 'inactive'); f.emit('blur');
    assert.equal(scope.aborted, interruption === 'unowned');
    if (interruption === 'background') f.emit('change', 'background');
    assert.equal(scope.aborted, interruption !== 'owned');
    f.emit('change', 'active'); f.emit('focus');
    held.resolve(); await saving;
    assert.equal(writes, interruption === 'owned' ? 1 : 0);
    assert.equal(retired, interruption === 'owned' ? 0 : 1);
    if (interruption === 'owned') assert.match(text(render()), /Sentry key saved/);
  } finally { held.resolve(); f.dispose(); }
});

test('Sentry batch paste reviews ordered public keys and rejects duplicates, oversize and stale clipboard results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup();
  const common = {
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Row: 'Row' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  let clipboard = '', pendingClipboard: Promise<string> | undefined, confirmed = 0;
  const view = evaluate(load('NativeSentryKeys'), {
    ...common,
    './NativeSentrySettings': { NativeSentrySettings: () => null },
    './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common),
    '../../../../source/wallet/sentryKeyVault': { isAllowedSentryKeyRoleScheme },
    '../../../../source/utils/sentry/importBatch': { containsSentryPrivateKey },
    'expo-clipboard': { getStringAsync: () => pendingClipboard ?? Promise.resolve(clipboard), setStringAsync: async () => true },
  }).NativeSentryKeys as (props: object) => Element;
  const manager: NativeSentryKeyManagement = {
    isAuthenticating: () => false,
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
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header', Row: 'Row' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  });
  const settingsView = evaluate(load('NativeSentrySettings'), {
    ...common(child), './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common(child)),
  }).NativeSentrySettings as (props: object) => Element;
  const parentView = evaluate(load('NativeSentryKeys'), {
    ...common(parent), './NativeSentrySettings': { NativeSentrySettings: 'SettingsChild' },
    './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common(parent)),
    '../../../../source/wallet/sentryKeyVault': { isAllowedSentryKeyRoleScheme },
    '../../../../source/utils/sentry/importBatch': { containsSentryPrivateKey },
    'expo-clipboard': {},
  }).NativeSentryKeys as (props: object) => Element;
  const held = Promise.withResolvers<void>();
  let readGuard!: () => void, cancelled = 0, closed = 0;
  const unused = async () => { throw Error('Unexpected key operation'); };
  const manager: NativeSentryKeyManagement = {
    isAuthenticating: () => false,
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
    assert.equal(cancelled, 1);
    assert.equal(closed, 0);
    assert.equal(parent.defaults(), 0);
    if (parentLast) held.reject(Error('Held read failed'));
    else held.resolve();
    await tick();
    assert.equal(cancelled, 2);
    assert.equal(closed, 0);
    assert.ok(button(renderParent(), 'Import key'));
  } finally { held.resolve(); child.dispose(); parent.dispose(); }
});

test('Sentry settings Back cannot return a replacement owner after its old read fails', async () => {
  const f = setup();
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = {
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const view = evaluate(load('NativeSentrySettings'), {
    ...common, './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common),
  }).NativeSentrySettings as (props: object) => Element;
  const held = Promise.withResolvers<{ serviceUrl: string; maxFeeSatoshis: string }>();
  let oldReturns = 0, newReturns = 0;
  const saveSettings = async () => { throw Error('Unexpected save'); };
  let props = { manager: { getSettings: async () => held.promise, saveSettings, isAuthenticating: () => false, cancel() {} }, assertCurrent() {},
    networkLabel: 'Syscoin', onBack() { oldReturns++; } };
  const render = () => f.expand(f.renderOwner(view, props)) as Element;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    render(); await tick();
    press(button(render(), 'Cancel'));
    assert.match(text(render()), /Closing service settings/);
    props = { ...props, manager: { getSettings: async () => ({ serviceUrl: 'https://new.example', maxFeeSatoshis: '200000' }), saveSettings, isAuthenticating: () => false, cancel() {} },
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
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const view = evaluate(load('NativeSentrySettings'), {
    ...common, './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common),
  }).NativeSentrySettings as (props: object) => Element;
  const held = Promise.withResolvers<void>();
  let saves = 0, returned = 0, writes = 0;
  const props = { manager: {
    isAuthenticating: () => false,
    cancel() {},
    getSettings: async () => ({ serviceUrl: 'https://sysnode.info', maxFeeSatoshis: '100000' }),
    async saveSettings(settings: { serviceUrl: string; maxFeeSatoshis: string }, check: () => void) {
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
    assert.equal(all(render()).some(node => node.props.accessibilityLabel === 'Confirm wallet PIN'), false);
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

test('Sentry settings Back cancels its device authorization before any write', async () => {
  const f = setup();
  const source = readFileSync(new NodeURL('../src/screens/NativeSentrySettings.tsx', import.meta.url), 'utf8');
  const view = evaluate(source, {
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  }).NativeSentrySettings as (props: object) => Element;
  let promptOwner: AbortSignal | null = null;
  let releasePrompt: (() => void) | undefined;
  const nativePrompt = new DeviceUnlockPrompt({ state: () => f.native.AppState.currentState, subscribe: () => () => {} });
  const lifetime = new AbortController();
  let writes = 0, returned = 0, requested = 0;
  const unused = async (): Promise<never> => { throw Error('Unexpected private key access'); };
  const manager = createNativeSentryKeyManagement({
    assertCurrent() {}, lifetime: lifetime.signal, network: 'mainnet', vaultId: 'a'.repeat(64),
    run: operation => operation(), derivePublicKey: unused, readSeed: unused,
    vaultHost: { crypto: () => globalThis.crypto, read: unused, write: unused },
    readSettings: async () => ({ serviceUrl: 'https://sysnode.info', maxFeeSatoshis: '100000' }),
    async authenticate(check, signal) {
      requested++; promptOwner = signal;
      await nativePrompt.run(signal, () => new Promise<void>((resolve, reject) => {
        const abort = () => reject(Error('CANCELLED'));
        signal.addEventListener('abort', abort, { once: true });
        releasePrompt = () => { signal.removeEventListener('abort', abort); resolve(); };
        if (signal.aborted) abort();
      }));
      check();
    },
    async writeSettings(_settings, check) { check(); writes++; },
  });
  const props = { manager: { ...manager,
    saveSettings(input: Parameters<typeof manager.saveSettings>[0], check: () => void) {
      return manager.saveSettings(structuredClone(input), check);
    },
  }, assertCurrent() {}, networkLabel: 'Syscoin', onBack() { returned++; } };
  const render = () => f.expand(f.renderOwner(view, props)) as Element;
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    render(); await tick(); press(button(render(), 'Save settings')); await tick();
    assert.equal(requested, 1); assert.equal(manager.isAuthenticating(), true);
    const held = promptOwner as AbortSignal | null; assert.ok(held); assert.equal(nativePrompt.isActive(held), true);
    press(button(render(), 'Cancel')); await tick();
    assert.equal(held.aborted, true); assert.equal(nativePrompt.isAnyPromptActive(), false);
    assert.equal(manager.isAuthenticating(), false); assert.equal(returned, 1); assert.equal(writes, 0);
    releasePrompt?.(); await tick(); assert.equal(writes, 0);
  } finally { manager.dispose(); f.dispose(); }
});

test('Sentry settings handles a synchronous stale-at-open failure without a read', async () => {
  const f = setup();
  const load = (name: string) => readFileSync(new NodeURL(`../src/screens/${name}.tsx`, import.meta.url), 'utf8');
  const common = {
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    react: f.hook, 'react-native': f.native, '../ui': { ...f.ui, Header: 'Header' },
    './IdleActivityBoundary': f.idle.components,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  };
  const view = evaluate(load('NativeSentrySettings'), {
    ...common, './NoteBackupPasswordField': evaluate(load('NoteBackupPasswordField'), common),
  }).NativeSentrySettings as (props: object) => Element;
  let writes = 0;
  const props = { manager: {
    isAuthenticating: () => false,
    cancel() {},
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


test('ambiguous note restore retains its recovery instructions on the public reopen screen', async () => {
  const failure = { commits: 0 };
  const f = await walletFeedbackFixture(false, false, undefined, undefined, true, undefined, undefined,
    quietActivityNotifications, undefined, undefined, failure);
  try {
    const tools = all(f.render()).find(node => node.type === 'RealTools'); assert(tools);
    (tools.props.onPrivateNotes as () => void)();
    const menu = f.render(); assert.equal(menu.type, 'NativeNoteFilesMenu');
    (menu.props.onRestore as () => void)();
    let restore = f.render(); assert.equal(restore.type, 'NativeNoteRestore');
    await (restore.props.onChoose as () => Promise<void>)();
    restore = f.render();
    assert.equal((restore.props.step as { phase: string }).phase, 'password');
    await (restore.props.onOpen as (password: string) => Promise<void>)('Portable test backup password');
    restore = f.render();
    const step = restore.props.step as { phase: string; preview: { id: string } };
    assert.equal(step.phase, 'review');
    await (restore.props.onRestore as (id: string) => Promise<void>)(step.preview.id);
    const locked = f.render();
    assert.equal(button(locked, 'Open wallet').props.disabled, false);
    assert(!all(locked).some(node => node.type === 'PinEntryScreen'));
    assert.equal(failure.commits, 1);
    assert.equal(f.locks, 1);
    const notices = all(locked);
    assert(notices.some(node => node.type === 'Notice' && node.props.title === 'Restore could not be confirmed'));
    assert(notices.some(node => String(node.props.body).includes('after unlocking')));
    assert(!notices.some(node => node.props.title === 'Notes restored'));
    const retry = await f.unlock('INVALID_CREDENTIAL');
    assert.equal(button(retry, 'Open wallet').props.disabled, false);
    assert(all(retry).some(node => node.props.title === 'Restore could not be confirmed'), 'a failed unlock must retain the restore warning');
    assert.equal(failure.commits, 1, 'unlock retry must not repeat the restore');
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

for (const family of ['evm'] as ('evm' | 'utxo')[]) test(`contextual ${family} network picker preserves Cancel draft and resets only after a proven selection`, async () => {
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

test('Tools uses the selected saved network label for custom EVM, renamed presets and UTXO', async () => {
  const ethereum = networkContext.getNativeNetwork('ethereum');
  const custom = networkContext.createNativeNetwork({ ...ethereum, id: 'custom-evm', name: 'Custom EVM', chainId: '31337', rpcUrl: 'https://custom.example/rpc' });
  const renamed = networkContext.createNativeNetwork({ ...ethereum, name: 'My Ethereum connection' });
  for (const { family, registration, expected } of [
    { family: 'evm' as const, registration: custom, expected: custom.name },
    { family: 'evm' as const, registration: renamed, expected: renamed.name },
    { family: 'evm' as const, registration: undefined, expected: ethereum.name },
    { family: 'utxo' as const, registration: undefined, expected: findUtxoNetwork('bitcoin')!.name },
  ]) {
    const f = await walletFeedbackFixture(false, false, undefined, undefined, true, family, undefined,
      quietActivityNotifications, undefined, undefined, undefined, registration);
    try {
      const tools = all(f.render()).find(node => node.type === 'RealTools'); assert(tools);
      assert.equal(tools.props.networkLabel, expected);
    } finally { f.dispose(); }
  }
});

test('UTXO Send opens its known network directly without a source selector', async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'utxo');
  try {
    const portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    (portfolio.props.onSend as () => void)();
    const send = f.render(); assert.equal(send.type, 'NativeUtxoSendScreen'); assert.equal(send.props.onChangeNetwork, undefined);
  } finally { f.dispose(); }
});

test('resumed Trezor SPT drafts never label native funds as tokens while native and fresh SPT availability stay exact', async () => {
  const asset = { assetGuid: '123456', symbol: 'SPT', decimals: 3 };
  for (const resumedAsset of [undefined, asset]) {
    const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'utxo', undefined, quietActivityNotifications, undefined, { nativeUnits: '125000001' });
    try {
      const home = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(home);
      ((home.props.hardwareRequest as Element).props.onResume as () => void)();
      const trezor = f.render(); assert.equal(trezor.type, 'NativeTrezor');
      const resume = {
        id: 'utxo-resume', accountId: 'hd:60:0', networkId: 'syscoin', kind: 'utxo',
        recipient: UTXO_ADDRESSES.syscoin, amount: '2', feeChoice: { kind: 'custom', satPerVbyte: '7' },
        ...(resumedAsset ? { asset: resumedAsset } : {}),
      } satisfies NativeTrezorResumeIntent;
      await (trezor.props.onResumeSend as (intent: NativeTrezorResumeIntent) => Promise<void>)(resume);
      const send = f.render(); assert.equal(send.type, 'NativeUtxoSendScreen');
      assert.deepEqual((send.props.initialDraft as { feeChoice: unknown }).feeChoice, resume.feeChoice);
      assert.equal(send.props.asset, resumedAsset);
      assert.equal(send.props.maximumAmount, undefined);
      assert.equal(send.props.availableAmount, resumedAsset ? undefined : '1.25000001');
      (send.props.onBack as () => void)();
      const returned = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(returned);
      (returned.props.onSendSpt as (holding: object) => void)({ ...asset, confirmedUnits: '20500', pendingDeltaUnits: '0' });
      const fresh = f.render(); assert.equal(fresh.type, 'NativeUtxoSendScreen');
      assert.equal(fresh.props.availableAmount, '20.5');
      assert.equal(fresh.props.maximumAmount, '20.5');
    } finally { f.dispose(); }
  }
});

test('same-network asset changes preserve recipient but clear amount, MAX, and advanced draft state', async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm');
  try {
    (all(f.render()).find(node => node.type === 'NativePortfolio')!.props.onSend as () => void)();
    const send = f.render(), asset = { contractAddress: '0x' + 'ab'.repeat(20), name: 'Saved token', symbol: 'TOK', decimals: 6 };
    (send.props.onChangeAsset as (form: unknown, token: unknown) => void)({ kind: 'evm', recipient: 'alice.eth', amount: '9', nonce: '7', max: true, advanced: true }, asset);
    await new Promise(resolve => setImmediate(resolve));
    const changed = f.render();
    assert.equal(changed.type, 'NativeSend'); assert.equal(changed.props.token, asset);
    assert.deepEqual(JSON.parse(JSON.stringify(changed.props.initialDraft)), { kind: 'evm', recipient: 'alice.eth', amount: '', nonce: '', max: false, advanced: false });
    assert.equal(f.selectedNetwork(), 'ethereum');
    (changed.props.onBack as () => void)();
    (send.props.onChangeAsset as (form: unknown) => void)({ kind: 'evm', recipient: 'stale.eth', amount: '9', nonce: '', max: false, advanced: false });
    await new Promise(resolve => setImmediate(resolve));
    assert(all(f.render()).some(node => node.type === 'NativePortfolio'));
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
    const consumePrevious = portfolio.props.onReceiveIntentConsumed as () => void;
    consumePrevious();
    portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    assert.equal(portfolio.props.initialReceive, undefined);
    (portfolio.props.onChangeReceiveNetwork as (value: object) => void)(continuation);
    picker = f.render();
    const view = picker.props.controller as ReturnType<typeof createNativeNetworkView>;
    const receipt = await view.select('bitcoin', view.getContextRevision(), view.getSnapshot()!.revision, () => {});
    (picker.props.selection as { onSelected(value: unknown): void }).onSelected(receipt);
    portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    assert.deepEqual(JSON.parse(JSON.stringify(portfolio.props.initialReceive)), {
      account: { address: UTXO_ADDRESSES.bitcoin, network: 'bitcoin', revision: 2 }, backupAcknowledged: false,
    });
    consumePrevious();
    portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    assert.equal((portfolio.props.initialReceive as typeof continuation).account.network, 'bitcoin', 'a stale consumer cannot clear a newer network continuation');
    (portfolio.props.onReceiveIntentConsumed as () => void)();
    assert.equal(all(f.render()).find(node => node.type === 'NativePortfolio')!.props.initialReceive, undefined);
  } finally { f.dispose(); }
});

function notificationTapPort(kind: 'transaction-confirmed' | 'recovery-started', wait = Promise.resolve(), accountType = 'HDAccount') {
  const eventId = `pali-alert-${'ab'.repeat(16)}`, network = networkContext.getNativeNetwork('syscoin-nevm');
  const scope = { id: 'native:hd:60:0:syscoin-nevm', accountId: 'hd:60:0', accountType, accountAddress: '0x' + '11'.repeat(20), network, guardian: false };
  let state = { ...quietActivityNotifications.getSnapshot(), pendingEventId: eventId as string | null };
  let resolutions = 0;
  const port: NotificationTestPort = {
    ...quietActivityNotifications, getSnapshot: () => state,
    async getPendingOwner() { return { accountId: scope.accountId, accountType }; },
    async resolveTapAfterUnlock(_id, validate) {
      resolutions++; await wait;
      if (!validate(scope)) return null;
      state = { ...state, pendingEventId: null };
      return { scopeId: scope.id, accountId: scope.accountId, accountType, networkId: network.id, kind, transactionHash: '0x' + 'ab'.repeat(32) };
    },
  };
  return { port, resolutions: () => resolutions };
}

for (const kind of ['transaction-confirmed', 'recovery-started'] as const) test(`native ${kind} tap selects its exact network before opening the public destination`, async () => {
  const tap = notificationTapPort(kind);
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, tap.port);
  try {
    f.render(); await new Promise(resolve => setImmediate(resolve)); f.render();
    assert.equal(f.selectedNetwork(), 'syscoin-nevm');
    assert.deepEqual(f.notificationRoutes, [{ tab: kind === 'transaction-confirmed' ? 'activity' : 'tools', identity: 'hd:60:0:syscoin-nevm' }]);
    assert.equal(tap.resolutions(), 1);
  } finally { f.dispose(); }
});

test('native tap resolution cannot select a network after background revocation', async () => {
  const held = Promise.withResolvers<void>(), tap = notificationTapPort('transaction-confirmed', held.promise);
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, tap.port);
  try {
    f.render(); await new Promise(resolve => setImmediate(resolve));
    f.emit('change', 'background'); held.resolve(); await new Promise(resolve => setImmediate(resolve)); f.render();
    assert.equal(f.selectedNetwork(), 'ethereum'); assert.deepEqual(f.notificationRoutes, []);
  } finally { f.dispose(); }
});

type RootNavigationAction = 'native' | 'token' | 'receive' | 'asset' | 'activity' | 'speed-up';
const navigationChoice = () => {
  const network = networkContext.getNativeNetwork('syscoin-nevm');
  return { label: 'Account 1', networkName: network.name, symbol: network.symbol,
    scope: { id: `native:hd:60:0:${network.id}`, accountId: 'hd:60:0', accountType: 'HDAccount',
      accountAddress: '0x' + '11'.repeat(20), network, guardian: false } };
};
const navigationHash = '0x' + 'ab'.repeat(32);
const navigationToken = { contractAddress: '0x' + 'cd'.repeat(20), name: 'Saved token', symbol: 'TOK', decimals: 6 };
function startRootNavigation(f: Awaited<ReturnType<typeof walletFeedbackFixture>>, action: RootNavigationAction, check: () => void) {
  const choice = navigationChoice();
  const surface = all(f.render()).find(node => node.type === (action === 'speed-up' ? 'AllNetworksActivity' : 'NativePortfolio'));
  assert(surface);
  const invoke = (name: string, ...args: unknown[]) => (surface.props[name] as (...values: unknown[]) => Promise<void>)(...args);
  if (action === 'speed-up') return invoke('onAction', { choice, row: { hash: navigationHash } }, 'speed-up', navigationHash, check);
  if (action === 'activity') return invoke('navigateActivity', choice, check);
  if (action === 'asset' || action === 'receive') return invoke('navigateDetail', choice, action === 'receive', action === 'asset' ? navigationToken.contractAddress : undefined, check);
  return invoke('sendFrom', choice, action === 'token' ? navigationToken : undefined, check);
}
const settleRootNavigation = async (f: Awaited<ReturnType<typeof walletFeedbackFixture>>) => {
  f.render(); await new Promise(resolve => setImmediate(resolve)); return f.render();
};

for (const action of ['native', 'token', 'receive', 'asset', 'activity', 'speed-up'] as const)
test(`root-owned ${action} navigation survives the real authority's transient authentication`, async () => {
  let viewAlive = true, checks = 0;
  const phases: string[] = [], transientAccounts: unknown[] = [];
  let f: Awaited<ReturnType<typeof walletFeedbackFixture>> | undefined;
  f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, quietActivityNotifications, {
    tab: action === 'speed-up' ? 'activity' : 'wallet', phases,
    onAuthenticating() { viewAlive = false; if (f) transientAccounts.push(f.authority!.getSnapshot().account); },
  });
  phases.length = 0; viewAlive = true;
  try {
    await startRootNavigation(f, action, () => { checks++; if (!viewAlive) throw Error('Public initiating view was unmounted'); });
    assert.deepEqual(transientAccounts, [null]);
    assert.deepEqual(phases, ['authenticating', 'ready']);
    assert.equal(checks, 1, 'the root owns the continuation after accepting the public view');
    assert.equal(f.authority!.getSnapshot().phase, 'ready');
    assert.equal(f.authority!.getSnapshot().account?.network, 'syscoin-nevm');
    assert.equal(f.authority!.getCatalogue()?.active.networkId, 'syscoin-nevm');
    const tree = await settleRootNavigation(f);
    if (action === 'activity') assert.deepEqual(f.notificationRoutes, [{ tab: 'activity', identity: 'hd:60:0:syscoin-nevm' }]);
    else if (action === 'receive' || action === 'asset') {
      const portfolio = all(tree).find(node => node.type === 'NativePortfolio'); assert(portfolio);
      assert.deepEqual(JSON.parse(JSON.stringify(portfolio.props.detail)), {
        accountId: 'hd:60:0', networkId: 'syscoin-nevm', receive: action === 'receive',
        ...(action === 'asset' ? { token: navigationToken.contractAddress } : {}),
      });
    } else {
      const send = all(tree).find(node => node.type === 'NativeSend'); assert(send);
      assert.equal((send.props.context as { networkId: string }).networkId, 'syscoin-nevm');
      if (action === 'token') assert.deepEqual(send.props.token, navigationToken);
      if (action === 'speed-up') assert.deepEqual(JSON.parse(JSON.stringify(send.props.replacement)), { hash: navigationHash, mode: 'speed-up' });
    }
  } finally { f.dispose(); }
});

for (const interruption of ['back', 'lock'] as const)
test(`root-owned navigation stops when ${interruption} interrupts real authority authentication`, async () => {
  const held = Promise.withResolvers<void>();
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, quietActivityNotifications, { wait: held.promise });
  try {
    const pending = startRootNavigation(f, 'native', () => {});
    const refused = assert.rejects(pending, /CANCELLED|OPERATION_FAILED/);
    assert.equal(f.authority!.getSnapshot().phase, 'authenticating');
    if (interruption === 'back') f.hardware(); else f.authority!.lock();
    held.resolve(); await refused;
    const tree = await settleRootNavigation(f);
    assert(!all(tree).some(node => node.type === 'NativeSend'));
    assert.equal(f.authority!.getSnapshot().phase, 'locked');
    assert.deepEqual(f.notificationRoutes, []);
  } finally { held.resolve(); f.dispose(); }
});

for (const interruption of ['back', 'tab', 'network-aba'] as const)
test(`root-owned queued send is cancelled by ${interruption} before its destination effect`, async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, quietActivityNotifications, {});
  try {
    const shell = all(f.render()).find(node => node.type === 'RealAppShell'); assert(shell);
    await startRootNavigation(f, 'native', () => {});
    assert.equal(f.authority!.getSnapshot().account?.network, 'syscoin-nevm');
    if (interruption === 'back') f.hardware();
    else if (interruption === 'tab') (shell.props.onTab as (tab: string) => void)('settings');
    else {
      for (const network of ['ethereum', 'syscoin-nevm']) {
        const state = f.authority!.getSnapshot(), catalogue = f.authority!.getCatalogue()!;
        await f.authority!.selectNetwork(network, state.revision, catalogue.revision, () => {});
      }
    }
    const tree = await settleRootNavigation(f);
    assert(!all(tree).some(node => node.type === 'NativeSend'));
    if (interruption === 'back') assert.equal(f.authority!.getSnapshot().phase, 'locked');
    else assert.equal(f.authority!.getSnapshot().phase, 'ready');
    if (interruption === 'network-aba') assert.equal(f.authority!.getSnapshot().account?.network, 'syscoin-nevm');
  } finally { f.dispose(); }
});

const currentNavigationChoice = () => {
  const choice = navigationChoice(), network = networkContext.getNativeNetwork('ethereum');
  return { ...choice, networkName: network.name, symbol: network.symbol,
    scope: { ...choice.scope, id: 'native:hd:60:0:ethereum', network } };
};

test('unbacked Receive can select another network without authorizing a send', async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, quietActivityNotifications, { backup: 'unconfirmed' });
  try {
    let portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    await (portfolio.props.navigateDetail as (...args: unknown[]) => Promise<void>)(currentNavigationChoice(), true, undefined, () => {});
    portfolio = all(await settleRootNavigation(f)).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    assert.deepEqual(JSON.parse(JSON.stringify(portfolio.props.detail)), { accountId: 'hd:60:0', networkId: 'ethereum', receive: true });
    const consumePrevious = portfolio.props.onReceiveIntentConsumed as () => void;
    consumePrevious();
    portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    assert.deepEqual(JSON.parse(JSON.stringify(portfolio.props.detail)), { accountId: 'hd:60:0', networkId: 'ethereum', receive: false });
    await (portfolio.props.navigateDetail as (...args: unknown[]) => Promise<void>)(currentNavigationChoice(), true, undefined, () => {});
    portfolio = all(await settleRootNavigation(f)).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    consumePrevious();
    assert.equal((all(f.render()).find(node => node.type === 'NativePortfolio')!.props.detail as { receive: boolean }).receive, true,
      'consuming the old request cannot swallow a newly requested Receive route');
    (portfolio.props.onReceiveIntentConsumed as () => void)();
    assert.equal(f.authority!.getSnapshot().phase, 'backup-required');
    await (portfolio.props.navigateDetail as (...args: unknown[]) => Promise<void>)(navigationChoice(), true, undefined, () => {});
    assert.equal(f.authority!.getSnapshot().phase, 'backup-required');
    assert.equal(f.authority!.getSnapshot().account?.network, 'syscoin-nevm');
    assert(!all(await settleRootNavigation(f)).some(node => node.type === 'NativeSend'));
  } finally { f.dispose(); }
});

test('unbacked Send selects the public network and opens a draft before requiring backup', async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, quietActivityNotifications, { backup: 'unconfirmed' });
  try {
    const portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    await (portfolio.props.sendFrom as (...args: unknown[]) => Promise<void>)(navigationChoice(), undefined, () => {});
    const tree = await settleRootNavigation(f);
    assert(!all(tree).some(node => node.type === 'BackupIntroduction'));
    const send = all(tree).find(node => node.type === 'NativeSend'); assert(send);
    assert.equal(typeof (send.props.beforeBackup as { onRequest: unknown }).onRequest, 'function');
    assert.equal(f.authority!.getSnapshot().account?.network, 'syscoin-nevm');
    assert.equal(f.authority!.getSnapshot().phase, 'backup-required');
  } finally { f.dispose(); }
});

test('same-network root Send uses the current authority without an authentication transition', async () => {
  const phases: string[] = [];
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, quietActivityNotifications, { phases });
  phases.length = 0;
  try {
    const portfolio = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(portfolio);
    await (portfolio.props.sendFrom as (...args: unknown[]) => Promise<void>)(currentNavigationChoice(), undefined, () => {});
    assert(all(await settleRootNavigation(f)).some(node => node.type === 'NativeSend'));
    assert.deepEqual(phases, []);
    assert.equal(f.authority!.getSnapshot().account?.network, 'ethereum');
  } finally { f.dispose(); }
});

for (const operation of ['speed-up', 'cancel', 'cancel-saved'] as const) test(`root Trezor ${operation} return retains routing and refuses stale account, network and lock state`, async () => {
  const f = await walletFeedbackFixture(false, false, undefined, undefined, false, 'evm', undefined, quietActivityNotifications, undefined, { nativeUnits: '1' });
  try {
    const home = all(f.render()).find(node => node.type === 'NativePortfolio'); assert(home);
    ((home.props.hardwareRequest as Element).props.onResume as () => void)();
    const trezor = f.render(); assert.equal(trezor.type, 'NativeTrezor');
    const resume = { id: 'replacement-resume', accountId: 'hd:60:0', networkId: 'ethereum', kind: 'evm' as const,
      unsignedTransaction: Transaction.from({ type: 2, chainId: 1, nonce: 7,
        to: operation === 'speed-up' ? null : '0x' + '11'.repeat(20),
        data: operation === 'speed-up' ? '0x6001600055' : '0x', value: 0,
        gasLimit: 50000, maxFeePerGas: 9, maxPriorityFeePerGas: 1 }).unsignedSerialized,
      replacement: { operation, originalHash: '0x' + 'ab'.repeat(32) } };
    const onResume = trezor.props.onResumeSend as (intent: NativeTrezorResumeIntent) => Promise<void>;
    await assert.rejects(onResume({ ...resume, accountId: 'other-account' }), /CANCELLED/);
    await assert.rejects(onResume({ ...resume, networkId: 'base' }), /CANCELLED/);
    await onResume(resume);
    const send = f.render(); assert.equal(send.type, 'NativeSend');
    assert.deepEqual(JSON.parse(JSON.stringify(send.props.replacement)), { hash: resume.replacement.originalHash, mode: operation });
    assert.equal(send.props.review, undefined); assert.equal(send.props.authentication, undefined);
    f.publish({ phase: 'locked', account: null });
    await assert.rejects(onResume(resume), /CANCELLED/);
  } finally { f.dispose(); }
});
