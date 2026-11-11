import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddress } from 'ethers/address';
import { createNativePrivateAuthenticationScope, createNativePrivateAuthenticationChild, bindNativePrivateAuthentication, bindNativePrivateAuthenticationChild, withNativePrivateAuthentication, type NativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { createNativeNoteRestore } from '../src/custody/nativeNoteRestore.ts';
import { createNoteBackupCodec } from '../../../source/wallet/noteBackup.ts';
import type { useNativeNoteBackup } from '../src/screens/useNativeNoteBackup.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const note = Object.freeze({ amount: '1', createdAt: 1 });
type Kind = 'Inventory' | 'Capacity' | 'Maintenance' | 'Import' | 'Deposit' | 'Withdrawal';
function fixture(kind: Kind, owned = true) {
  let state = 'active', backs = 0, walletCurrent = true, completed = 0;
  const listeners = new Map<string, Set<(state: string) => void>>();
  const subscribe = (name: string, listener: (state: string) => void) => {
    const list = listeners.get(name) ?? new Set(); list.add(listener); listeners.set(name, list);
    return () => list.delete(listener);
  };
  const prompt = new DeviceUnlockPrompt({ state: () => state, subscribe: listener => {
    const remove = ['change', 'blur', 'focus'].map(name => subscribe(name, listener));
    return () => remove.forEach(fn => fn());
  } });
  let held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), authenticateCheck = false;
  let scope: NativePrivateAuthenticationScope | undefined;
  let lastGuard: (() => void) | undefined;
  const scopes: NativePrivateAuthenticationScope[] = [];
  const hostGuard = () => { if (!walletCurrent) throw Error('CANCELLED'); };
  const acquire = async <T>(check: () => void, authentication: NativePrivateAuthenticationScope, value: T): Promise<T> => {
    scope = authentication;
    lastGuard = check;
    scopes.push(authentication);
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: hostGuard, isPromptActive: owner => prompt.isActive(owner) });
    const work = async (owner: AbortSignal | null = null) => prompt.run(owner, async () => {
      entered.resolve(); await held.promise; check(); completed++; return value;
    });
    return owned ? withNativePrivateAuthentication(binding, new AbortController().signal, hostGuard, work) : work();
  };
  const native = { AppState: { get currentState() { return state; }, addEventListener(name: string, listener: (value: string) => void) { return { remove: subscribe(name, listener) }; } },
    Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value },
    BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} },
    View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator' };
  const file = kind === 'Deposit' ? 'NativePrivateDeposit' : kind === 'Withdrawal' ? 'NativePrivateWithdrawal' : `NativeNote${kind}`;
  const view = screenFixture(new URL(`../src/screens/${file}.tsx`, import.meta.url), file, {
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(value => [value, value])), colors: {}, styles: {} },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope, createNativePrivateAuthenticationChild },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    './NativeNoteReveal': { NativeNoteReveal: 'NativeNoteReveal' }, './NativePrivateWithdrawal': { NativePrivateWithdrawal: 'NativePrivateWithdrawal' },
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' }, './PinEntry': { PinField: 'PinField' },
    '../platform/localization': { useNativeTranslation: () => ({ t: (value: string) => value }) },
    '../platform/security': { recordIdleActivity: () => true }, '../core/amounts': { formatBaseUnits: (value: string) => value },
    '../../../../source/wallet/privateVaultEnvelope': { PRIVATE_VAULT_CAPACITIES: [8], capacityBudget: () => ({}) },
    '../../../../source/utils/privacy/registry': { PRIVACY_POOLS: [{ id: 'eth-1', amount: '1' }] },
    'ethers/address': { getAddress },
  }, { AbortController, performance });
  const controller = { async dispose() {} };
  const authentication = createNativePrivateAuthenticationScope();
  const readInventory = (check: () => void, scope: NativePrivateAuthenticationScope) => acquire(check, scope, {
    notes: [note], revealNote: async () => { throw Error('Unexpected reveal'); },
    checkNote: async (_note: unknown, check: () => void) => {
      check(); return authenticateCheck ? acquire(check, scope, { phase: 'verified' }) : { phase: 'verified' };
    },
    openWithdrawal: async (_note: unknown, _signal: AbortSignal, check: () => void, supplied: NativePrivateAuthenticationScope) => {
      bindNativePrivateAuthenticationChild(bindNativePrivateAuthentication(scope, { assertCurrent: hostGuard, isPromptActive: owner => prompt.isActive(owner) }), supplied);
      check(); return controller;
    },
  });
  const props = { onBack() { backs++; }, onLock() { walletCurrent = false; }, onBackup() {}, note, authentication,
    readInventory,
    openCapacity: async (check: () => void, scope: NativePrivateAuthenticationScope) => ({
      getCapacity: () => acquire(check, scope, { capacity: 8, count: 0 }), setCapacity: () => { throw Error('Unexpected save'); },
    }),
    openImport: async (check: () => void, scope: NativePrivateAuthenticationScope) => ({
      ...controller, importNote: () => acquire(check, scope, { amount: '1', phase: 'verified' }),
    }),
    open: async (...args: [AbortSignal, () => void, NativePrivateAuthenticationScope]) => {
      const [, check, scope] = args;
      if (kind === 'Maintenance') return { ...controller, getNotes: () => acquire(check, scope, { notes: [] }) };
      return acquire(check, scope, controller);
    },
  };
  const render = () => view.render(props);
  return { render, get entered() { return entered.promise; }, scopes, get scope() { return scope; }, get backs() { return backs; }, get completed() { return completed; },
    holdCheck() { held = Promise.withResolvers<void>(); entered = Promise.withResolvers<void>(); authenticateCheck = true; },
    laterProof() {
      assert(scope); assert(lastGuard);
      held = Promise.withResolvers<void>(); entered = Promise.withResolvers<void>();
      return acquire(lastGuard, scope, undefined);
    },
    replaceInventory() { props.readInventory = (check, scope) => readInventory(check, scope); render(); },
    emit(next: string) { if (next !== 'blur' && next !== 'focus') state = next; for (const listener of [...listeners.get(next === 'blur' || next === 'focus' ? next : 'change') ?? []]) listener(next); },
    release() { held.resolve(); }, revoke() { walletCurrent = false; },
    close() { held.resolve(); view.close(); } };
}

function press(tree: ReturnType<ReturnType<typeof fixture>['render']>, title: string) {
  const button = screenElements(tree).find(value => value.props.title === title); assert(button, title); button.props.onPress();
}
async function start(f: ReturnType<typeof fixture>, kind: Kind) {
  f.render(); await tick();
  if (kind === 'Import') {
    const input = screenElements(f.render()).find(value => value.type === 'Input'); assert(input);
    input.props.onChangeText('tornado-eth-1-1-0x' + '01'.repeat(62));
    press(f.render(), 'Import note');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([f.entered, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('Authentication was not reached')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

for (const kind of ['Inventory', 'Capacity', 'Maintenance', 'Import', 'Deposit', 'Withdrawal'] as const)
  test(`${kind} retains only its own pending biometric proof across inactive and blur`, async () => {
    const f = fixture(kind);
    try {
      await start(f, kind); assert.equal(f.scope?.isAuthenticating(), true);
      f.emit('inactive'); f.emit('blur');
      assert.equal(f.scope?.isAuthenticating(), true); assert.equal(f.backs, 0); assert.equal(f.completed, 0);
      f.emit('active'); f.emit('focus'); f.release(); await tick();
      assert.equal(f.completed, 1); assert.equal(f.scope?.isAuthenticating(), false);
    } finally { f.close(); }
  });

for (const kind of ['Deposit', 'Withdrawal'] as const) test(`${kind} keeps its mounted owner during a subsequent signing proof`, async () => {
  const f = fixture(kind);
  try {
    await start(f, kind); f.release(); await tick(); f.render();
    const signing = f.laterProof(); await f.entered;
    f.emit('inactive'); f.emit('blur');
    assert.equal(f.scope?.isAuthenticating(), true); assert.equal(f.backs, 0);
    f.emit('active'); f.emit('focus'); f.release(); await signing;
    assert.equal(f.scope?.isAuthenticating(), false); assert.equal(f.completed, 2);
  } finally { f.close(); }
});

test('Inventory does not borrow an unrelated active OS prompt', async () => {
  const f = fixture('Inventory', false);
  try {
    await start(f, 'Inventory'); assert.equal(f.scope?.isAuthenticating(), false);
    f.emit('inactive'); f.emit('active'); f.release(); await tick();
    assert.equal(f.completed, 0);
    assert.equal(screenElements(f.render()).some(value => value.props.title === '1 ETH pool'), false);
  } finally { f.close(); }
});

test('Inventory replacement retires the old proof and permits a fresh explicit read', async () => {
  const f = fixture('Inventory');
  try {
    await start(f, 'Inventory'); const original = f.scope!;
    f.replaceInventory(); await tick();
    assert.equal(original.isAuthenticating(), false);
    f.release(); await tick();
    assert.equal(screenElements(f.render()).some(value => value.props.title === '1 ETH pool'), false);
    press(f.render(), 'Retry'); await tick();
    assert.equal(f.completed, 1); assert.notEqual(f.scope, original);
  } finally { f.close(); }
});

test('returning from Withdrawal replaces its retired parent scope before reloading inventory', async () => {
  const f = fixture('Inventory');
  try {
    await start(f, 'Inventory'); f.release(); await tick();
    const openWithdrawal = async () => {
      const row = screenElements(f.render()).find(value => value.props.title === '1 ETH pool'); assert(row); row.props.onPress();
      press(f.render(), 'Check pool status'); await tick();
      press(f.render(), 'Withdraw');
      const child = screenElements(f.render()).find(value => value.type === 'NativePrivateWithdrawal'); assert(child);
      const effectScope = createNativePrivateAuthenticationChild(child.props.authentication);
      await child.props.open(new AbortController().signal, () => undefined, effectScope);
      return child;
    };
    const first = await openWithdrawal(), oldScope = first.props.authentication;
    oldScope.retire(); first.props.onBack(); await tick();
    const second = await openWithdrawal();
    assert.notEqual(second.props.authentication, oldScope);
    assert.equal(f.completed, 2);
    f.emit('background');
    assert.equal(second.props.authentication.isAuthenticating(), false);
  } finally { f.close(); }
});

test('Back from a pending note check cancels its proof before refreshing the list', async () => {
  const f = fixture('Inventory');
  try {
    await start(f, 'Inventory'); f.release(); await tick();
    const row = screenElements(f.render()).find(value => value.props.title === '1 ETH pool'); assert(row); row.props.onPress();
    f.holdCheck(); press(f.render(), 'Check pool status'); await f.entered;
    const oldScope = f.scope!;
    const header = screenElements(f.render()).find(value => value.type === 'Header'); assert(header); header.props.onBack();
    assert.equal(oldScope.isAuthenticating(), false);
    f.release(); await tick(); await tick();
    assert.equal(f.completed, 2);
    assert(screenElements(f.render()).some(value => value.props.title === '1 ETH pool'));
  } finally { f.close(); }
});

for (const scenario of ['owned-proof', 'background', 'picker-handoff'] as const) test(`restore preview preserves only its current scope: ${scenario}`, async () => {
  const background = scenario === 'background';
  let state = 'active';
  const prompt = new DeviceUnlockPrompt({ state: () => state, subscribe: () => () => undefined });
  const held = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const picked = Promise.withResolvers<Uint8Array | null>();
  const createdScopes: NativePrivateAuthenticationScope[] = [];
  let scope!: NativePrivateAuthenticationScope;
  const file = await createNoteBackupCodec({ crypto: globalThis.crypto, assertCurrent: () => undefined }).encrypt({
    format: 'pali-private-notes', version: 1, createdAt: 1, notes: [{ note: 'tornado-eth-1-1-0x' + '01'.repeat(62), createdAt: 1 }],
  }, 'Portable test backup password');
  const ready = { phase: 'ready' };
  const owner = { authority: { getSnapshot: () => ready, lock() {} },
    captureNoteFileOwner: async () => async () => undefined,
    async openNoteBackup(check: () => void, authentication: NativePrivateAuthenticationScope) {
      scope = authentication;
      const binding = bindNativePrivateAuthentication(authentication, { assertCurrent: () => undefined, isPromptActive: owner => prompt.isActive(owner) });
      return { begin: () => 'preview', cancel() {}, async prepareImport() {
        return withNativePrivateAuthentication(binding, new AbortController().signal, () => undefined, async owner => prompt.run(owner, async () => {
          entered.resolve(); await held.promise; check();
          return { id: 'preview', added: 1, duplicates: 0, guarded: 0, expiresAt: performance.now() + 10000 };
        }));
      } };
    } };
  const f = screenFixture(new URL('../src/screens/useNativeNoteBackup.ts', import.meta.url), 'useNativeNoteBackup', {
    'react-native': { AppState: { get currentState() { return state; } } },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope() {
      const scope = createNativePrivateAuthenticationScope(); createdScopes.push(scope); return scope;
    } },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../platform/noteBackupPicker': { shouldLockWalletForNotePicker: () => false,
      pickNoteBackupFile: async () => scenario === 'picker-handoff' ? picked.promise : file.slice() },
    '../custody/nativeNoteRestore': { createNativeNoteRestore },
  });
  const render = () => f.render(() => owner, () => undefined) as unknown as ReturnType<typeof useNativeNoteBackup>;
  try {
    const hook = render();
    assert.equal(hook.begin(), true);
    const choosing = hook.choose();
    if (scenario === 'picker-handoff') {
      await tick();
      const before = createdScopes.at(-1)!;
      state = 'background'; hook.lock();
      state = 'active'; assert.equal(hook.resume(), true);
      assert.equal(createdScopes.at(-1), before, 'busy picker must not rebind its pending operation');
      picked.resolve(file.slice()); await choosing;
      assert.notEqual(createdScopes.at(-1), before);
      assert.throws(() => bindNativePrivateAuthentication(before, { assertCurrent() {}, isPromptActive: () => false }), /CANCELLED/);
    } else await choosing;
    const pending = hook.open('Portable test backup password'); await entered.promise;
    state = background ? 'background' : 'inactive';
    if (background) hook.lock();
    assert.equal(scope.isAuthenticating(), !background);
    state = 'active'; held.resolve(); await pending;
    assert.equal(render().step.phase === 'review', !background);
  } finally { held.resolve(); render().cancel(); f.close(); }
});

for (const boundary of ['background', 'back', 'wallet'] as const)
  test(`Inventory never publishes after ${boundary} retires the authentication owner`, async () => {
    const f = fixture('Inventory');
    try {
      await start(f, 'Inventory');
      if (boundary === 'background') f.emit('background');
      if (boundary === 'back') {
        const header = screenElements(f.render()).find(value => value.type === 'Header'); assert(header); header.props.onBack();
      }
      if (boundary === 'wallet') f.revoke();
      f.emit('active'); f.release(); await tick();
      assert.equal(f.scope?.isAuthenticating(), false);
      assert.equal(screenElements(f.render()).some(value => value.props.title === '1 ETH pool'), false);
    } finally { f.close(); }
  });
