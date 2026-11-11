import assert from 'node:assert/strict';
import test from 'node:test';
import * as idlePolicy from '../../../source/shared/idleLockPolicy.ts';
import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import * as privateAuthenticationLifecycle from '../src/screens/privateAuthenticationLifecycle.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

function fixture(mode: 'custody' | 'watch' = 'custody') {
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; });
  const calls: any[][] = [];
  const appState = { currentState: 'active' };
  const saved = { version: 1, custodyIdleMinutes: 5, watchIdleMinutes: 5 };
  const screen = screenFixture(new URL('../src/screens/AutoLockSettings.tsx', import.meta.url), 'AutoLockSettings', {
    'react-native': { AppState: appState, BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/shared/idleLockPolicy': idlePolicy,
    '../custody/privateAuthentication': privateAuthentication,
    './privateAuthenticationLifecycle': privateAuthenticationLifecycle,
    '../platform/security': { securityPreferences: { subscribe: () => () => {}, getSnapshot: () => ({ value: saved }) } },
    './IdleActivityBoundary': { IdlePressable: 'IdlePressable', IdleTextInput: 'IdleTextInput' },
    '../ui': Object.fromEntries(['Button', 'Card', 'Header', 'Icon', 'Notice', 'Screen', 'Text'].map(name => [name, name]).concat([['colors', {}], ['styles', { screen: {} }]] as any)),
  }, { AbortController });
  const props = { mode, onBack() {}, save: async (...args: any[]) => { calls.push(args); await pending; args[4](); } };
  const render = () => screenElements(screen.render(props));
  const press = (title: string) => {
    const button = render().find(e => e.type === 'Button' && e.props.title === title);
    assert.ok(button); assert.notEqual(button.props.disabled, true); button.props.onPress();
  };
  const change = (minutes: string) => {
    const input = render().find(e => e.type === 'IdleTextInput'); assert.ok(input); input.props.onChangeText(minutes);
  };
  return { screen, calls, appState, render, press, change, resolve };
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

for (const mode of ['custody', 'watch'] as const) test(`${mode} auto-lock delegates once without retaining an inline credential`, async () => {
  const f = fixture(mode);
  try {
    f.change('30');
    assert.equal(f.render().some(e => e.type === 'PinField'), false);
    f.press('Save auto-lock');
    assert.equal(f.calls.length, 1);
    const [expected, minutes, signal, scope] = f.calls[0]!;
    assert.equal(expected.custodyIdleMinutes, 5); assert.equal(minutes, 30);
    assert.equal(signal.aborted, false); assert.equal(scope.isAuthenticating(), false);
    const pendingButton = f.render().find(e => e.type === 'Button' && e.props.title === 'Saving auto-lock…');
    assert.equal(pendingButton?.props.disabled, true); pendingButton?.props.onPress(); assert.equal(f.calls.length, 1);
    f.resolve(); await flush();
    assert.ok(f.render().some(e => e.type === 'Text' && e.children.includes('Auto-lock setting saved.')));
    assert.equal(signal.aborted, true);
  } finally { f.screen.close(); }
});

for (const close of ['back', 'unmount'] as const) test(`auto-lock ${close} aborts the exact pending request and rejects a late result`, async () => {
  const f = fixture(); f.change('30'); f.press('Save auto-lock');
  const signal = f.calls[0]![2];
  if (close === 'back') f.press('Cancel'); else f.screen.close();
  assert.equal(signal.aborted, true);
  f.resolve(); await flush();
  assert.equal(f.render().some(e => e.type === 'Text' && e.children.includes('Auto-lock setting saved.')), false);
  if (close === 'back') f.screen.close();
});

test('disabling auto-lock still requires the explicit consequence acknowledgement', () => {
  const f = fixture();
  try {
    f.change('0');
    assert.equal(f.render().find(e => e.type === 'Button' && e.props.title === 'Save auto-lock')?.props.disabled, true);
    f.press('I understand the Off setting'); f.press('Save auto-lock'); assert.equal(f.calls[0]![1], 0);
    f.resolve();
  } finally { f.screen.close(); }
});
