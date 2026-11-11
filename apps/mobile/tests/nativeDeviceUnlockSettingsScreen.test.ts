import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationAuthentication, isOperationAuthenticationCancellation, type OperationAuthenticationPrompt } from '../src/core/operationAuthentication.ts';
import * as authentication from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

function fixture(enabled = false, available = true) {
  let prompt: OperationAuthenticationPrompt | null = null, activeProof: AbortSignal | undefined;
  let holdProof = false, holdOperation = false, holdRefresh = false, rejectOperation = false, rejectRefresh = false;
  let backs = 0, refreshed = 0, published = 0;
  const proof = Promise.withResolvers<void>(), operation = Promise.withResolvers<void>(), refresh = Promise.withResolvers<void>();
  const calls: { enabled: boolean; signal: AbortSignal; scope: authentication.NativePrivateAuthenticationScope; check(): void }[] = [];
  const listeners = new Map<string, Set<(state: string) => void>>();
  const appState = { currentState: 'active', addEventListener(event: string, listener: (state: string) => void) {
    const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group);
    return { remove() { group.delete(listener); } };
  } };
  const broker = new OperationAuthentication();
  const detach = broker.attach(value => { prompt = value; });
  const screen = screenFixture(new URL('../src/screens/NativeDeviceUnlockSettings.tsx', import.meta.url), 'NativeDeviceUnlockSettings', {
    'react-native': { AppState: appState, BackHandler: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' }, View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../core/operationAuthentication': { isOperationAuthenticationCancellation },
    '../custody/privateAuthentication': authentication,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../ui': { styles: {}, ...Object.fromEntries(['Button', 'Header', 'Screen', 'Text'].map(name => [name, name])) },
  }, { AbortController });
  const props = { enabled, available, label: 'Face ID',
    async configure(next: boolean, signal: AbortSignal, scope: authentication.NativePrivateAuthenticationScope, check: () => void) {
      calls.push({ enabled: next, signal, scope, check }); check();
      const binding = authentication.bindNativePrivateAuthentication(scope, { assertCurrent: check, isPromptActive: owner => activeProof === owner });
      await authentication.withNativePrivateAuthentication(binding, signal, check, owner => broker.request({
        id: `device-unlock-${calls.length}`, purpose: 'account-change', biometricsEnabled: enabled,
      }, owner, check, async (credential, current) => {
        if (credential.method === 'pin' && credential.pin !== '123456') return { accepted: false, reason: 'INVALID_CREDENTIAL' };
        activeProof = owner;
        try { if (holdProof) await proof.promise; current(); return { accepted: true }; }
        finally { activeProof = undefined; }
      }));
      if (holdOperation) await operation.promise;
      check(); if (rejectOperation) throw new Error('OPERATION_FAILED');
    },
    onBack() { backs++; },
    async onConfigured(check: () => void) {
      check();
      refreshed++; assert.equal(calls.at(-1)!.signal.aborted, false);
      if (holdRefresh) await refresh.promise;
      check();
      if (rejectRefresh) throw new Error('STATUS_UNAVAILABLE');
      published++;
    },
  };
  const render = () => screenElements(screen.render(props));
  const press = (title: string) => {
    const button = render().find(node => node.type === 'Button' && node.props.title === title);
    assert(button, title); assert.notEqual(button.props.disabled, true); button.props.onPress();
  };
  return { render, press, calls, props,
    get prompt() { return prompt; }, get backs() { return backs; }, get refreshed() { return refreshed; }, get published() { return published; },
    holdProof() { holdProof = true; }, releaseProof() { proof.resolve(); },
    holdOperation() { holdOperation = true; }, finishOperation(fail = false) { rejectOperation = fail; operation.resolve(); },
    holdRefresh() { holdRefresh = true; }, finishRefresh(fail = false) { rejectRefresh = fail; refresh.resolve(); },
    emit(state: string) {
      if (state !== 'blur' && state !== 'focus') appState.currentState = state;
      for (const listener of [...listeners.get(state === 'blur' || state === 'focus' ? state : 'change') ?? []]) listener(state);
    },
    close() { proof.resolve(); operation.resolve(); refresh.resolve(); screen.close(); detach(); },
  };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function currentPrompt(f: ReturnType<typeof fixture>): OperationAuthenticationPrompt {
  const prompt = f.prompt; assert(prompt); return prompt;
}

for (const enabled of [false, true]) test(`${enabled ? 'disable' : 'enable'} opens shared authentication only after the explicit settings action`, async () => {
  const f = fixture(enabled);
  try {
    assert.equal(f.render().some(node => ['PinField', 'PinEntryScreen', 'TransactionAuthentication'].includes(String(node.type))), false);
    assert.equal(f.calls.length, 0); assert.equal(f.prompt, null);
    f.press(enabled ? 'Turn off Face ID' : 'Enable Face ID');
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.enabled, !enabled);
    const prompt = currentPrompt(f);
    assert.equal(prompt.request.biometricsEnabled, enabled);
    prompt.confirm({ method: 'pin', pin: '123456' }); await settle();
    assert.equal(f.refreshed, 1); assert.equal(f.calls[0]!.signal.aborted, true);
  } finally { f.close(); }
});

test('shared Cancel preserves the settings draft and allows a fresh request', async () => {
  const f = fixture();
  try {
    f.press('Enable Face ID'); const first = f.calls[0]!; f.prompt!.cancel(); await settle();
    assert.equal(first.signal.aborted, true); assert.equal(f.backs, 0); assert.equal(f.refreshed, 0);
    assert.equal(f.render().some(node => node.props.accessibilityRole === 'alert'), false);
    f.press('Enable Face ID'); assert.equal(f.calls.length, 2); assert.notEqual(f.calls[1]!.scope, first.scope);
  } finally { f.close(); }
});

test('a rejected PIN stays in shared authentication without changing settings', async () => {
  const f = fixture();
  try {
    f.press('Enable Face ID'); f.prompt!.confirm({ method: 'pin', pin: '000000' }); await settle();
    assert.equal(f.prompt?.error, 'PIN not accepted. Try again.'); assert.equal(f.refreshed, 0);
    f.prompt!.confirm({ method: 'pin', pin: '123456' }); await settle(); assert.equal(f.refreshed, 1);
  } finally { f.close(); }
});

test('the exact active biometric proof survives inactive and blur until foreground delivery', async () => {
  const f = fixture(true);
  try {
    f.holdProof(); f.press('Turn off Face ID'); f.prompt!.confirm({ method: 'biometric' });
    assert.equal(f.calls[0]!.scope.isAuthenticating(), true);
    f.emit('inactive'); f.emit('blur'); assert.equal(f.calls[0]!.signal.aborted, false);
    f.emit('active'); f.emit('focus'); f.releaseProof(); await settle(); assert.equal(f.refreshed, 1);
  } finally { f.close(); }
});

test('background cancels even the matching active biometric proof', async () => {
  const f = fixture(true);
  try {
    f.holdProof(); f.press('Turn off Face ID'); f.prompt!.confirm({ method: 'biometric' });
    assert.equal(f.calls[0]!.scope.isAuthenticating(), true);
    f.emit('background'); assert.equal(f.calls[0]!.signal.aborted, true);
    f.emit('active'); f.releaseProof(); await settle(); assert.equal(f.refreshed, 0);
  } finally { f.close(); }
});

for (const boundary of ['inactive', 'blur', 'background', 'back', 'unmount']) test(`${boundary} cancels an unprotected pending request and suppresses its late result`, async () => {
  const f = fixture();
  try {
    f.press('Enable Face ID'); const stale = f.prompt!;
    if (boundary === 'back') f.press('Cancel'); else if (boundary === 'unmount') f.close(); else f.emit(boundary);
    assert.equal(f.calls[0]!.signal.aborted, true); assert.equal(f.prompt, null);
    stale.confirm({ method: 'pin', pin: '123456' }); await settle(); assert.equal(f.refreshed, 0);
  } finally { f.close(); }
});

test('the original setting and request remain owned through mutation, prop publication, and status refresh', async () => {
  const f = fixture();
  try {
    f.holdOperation(); f.holdRefresh(); f.press('Enable Face ID'); f.prompt!.confirm({ method: 'pin', pin: '123456' }); await settle();
    f.props.enabled = true;
    const button = f.render().find(node => node.type === 'Button' && node.props.title === 'Updating…');
    assert.equal(button?.props.disabled, true); button?.props.onPress();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.enabled, true); assert.equal(f.calls[0]!.signal.aborted, false);
    f.finishOperation(); await settle(); assert.equal(f.refreshed, 1); assert.equal(f.calls[0]!.signal.aborted, false);
    f.finishRefresh(); await settle(); assert.equal(f.calls[0]!.signal.aborted, true);
  } finally { f.close(); }
});

test('successful status refresh may unmount the screen before completing', async () => {
  const f = fixture();
  try {
    let refreshed = false;
    f.props.onConfigured = async () => {
      assert.equal(f.calls[0]!.signal.aborted, false);
      refreshed = true; f.close();
    };
    f.press('Enable Face ID'); f.prompt!.confirm({ method: 'pin', pin: '123456' }); await settle();
    assert.equal(refreshed, true); assert.equal(f.calls[0]!.signal.aborted, true);
  } finally { f.close(); }
});

for (const boundary of ['back', 'unmount']) test(`${boundary} during status refresh prevents its late publication`, async () => {
  const f = fixture();
  try {
    f.holdRefresh(); f.press('Enable Face ID'); currentPrompt(f).confirm({ method: 'pin', pin: '123456' }); await settle();
    assert.equal(f.refreshed, 1); assert.equal(f.published, 0);
    if (boundary === 'back') f.press('Cancel'); else f.close();
    assert.equal(f.calls[0]!.signal.aborted, true);
    f.finishRefresh(); await settle();
    assert.equal(f.published, 0);
  } finally { f.close(); }
});

for (const failure of ['mutation', 'refresh']) test(`${failure} uncertainty requires reopening settings before another change`, async () => {
  const f = fixture();
  try {
    f.holdOperation(); f.holdRefresh(); f.press('Enable Face ID'); f.prompt!.confirm({ method: 'pin', pin: '123456' }); await settle();
    f.finishOperation(failure === 'mutation'); await settle();
    if (failure === 'refresh') { f.finishRefresh(true); await settle(); }
    const tree = f.render();
    assert(tree.some(node => node.props.accessibilityRole === 'alert'));
    assert.equal(tree.find(node => node.type === 'Button' && node.props.title === 'Enable Face ID')?.props.disabled, true);
    assert.equal(f.calls[0]!.signal.aborted, true);
  } finally { f.close(); }
});

test('an unavailable device blocks enabling but still allows disabling an existing enrollment', () => {
  const unavailable = fixture(false, false), enrolled = fixture(true, false);
  try {
    assert.equal(unavailable.render().find(node => node.props.title === 'Enable Face ID')?.props.disabled, true);
    enrolled.press('Turn off Face ID'); assert.equal(enrolled.calls[0]!.enabled, false);
  } finally { unavailable.close(); enrolled.close(); }
});
