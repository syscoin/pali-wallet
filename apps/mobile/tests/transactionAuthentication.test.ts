import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeOperationCredential } from '../src/custody/types.ts';
import type { TransactionAuthenticationProps } from '../src/screens/TransactionAuthentication.tsx';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

function fixture(method: TransactionAuthenticationProps['method'] = 'biometric') {
  const confirmed: NativeOperationCredential[] = [];
  let cancelled = 0;
  const f = screenFixture(new URL('../src/screens/TransactionAuthentication.tsx', import.meta.url), 'TransactionAuthentication', {
    'react-native': { StyleSheet: { create: (value: unknown) => value }, Platform: { OS: 'ios' }, Keyboard: { dismiss() {} },
      ...Object.fromEntries(['KeyboardAvoidingView', 'Modal', 'ScrollView', 'View'].map(name => [name, name])) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { colors: {}, styles: {}, ...Object.fromEntries(['Button', 'Card', 'Icon', 'Text'].map(name => [name, name])) },
    './IdleActivityBoundary': { IdleTextInput: 'Input' },
  });
  let props: TransactionAuthenticationProps = { identity: 'review-1', method, busy: false,
    onConfirm: value => confirmed.push(value), onCancel: () => { cancelled++; } };
  return { confirmed, get cancelled() { return cancelled; }, close: f.close,
    render(next: Partial<TransactionAuthenticationProps> = {}) { props = { ...props, ...next }; return f.render(props); } };
}
function button(tree: ScreenElement, title: string) {
  const node = screenElements(tree).find(value => value.type === 'Button' && value.props.title === title);
  assert(node, `Missing ${title}`); return node;
}
function input(tree: ScreenElement) {
  const node = screenElements(tree).find(value => value.type === 'Input'); assert(node); return node;
}
function press(node: ScreenElement) { node.props.onPress(); }

test('biometrics are requested only by explicit confirmation and duplicate presses do not repeat', () => {
  const f = fixture(); const tree = f.render();
  assert.equal(tree.type, 'Modal'); assert.equal(tree.props.transparent, true);
  assert.equal(f.confirmed.length, 0);
  const confirm = button(tree, 'Confirm with biometrics');
  press(confirm); press(confirm);
  assert.equal(f.confirmed.length, 1); assert.equal(f.confirmed[0]?.method, 'biometric');
  assert.equal(f.cancelled, 0); f.close();
});

test('password fallback preserves the review and clears the credential immediately on submission', () => {
  const f = fixture(); press(button(f.render(), 'Use password'));
  let tree = f.render(); assert.equal(input(tree).props.secureTextEntry, true);
  assert.equal(button(tree, 'Confirm transaction').props.disabled, true);
  input(tree).props.onChangeText(' public password ');
  tree = f.render(); const confirm = button(tree, 'Confirm transaction');
  press(confirm); press(confirm);
  assert.equal(f.confirmed.length, 1);
  const credential = f.confirmed[0]; assert(credential?.method === 'password');
  assert.equal(credential.password, ' public password ');
  assert.equal(input(f.render()).props.value, '');
  assert.equal(f.cancelled, 0); f.close();
});

test('new review identity or preferred method cannot reuse typed password or stale callbacks', () => {
  const f = fixture('password'); let tree = f.render();
  input(tree).props.onChangeText('first password'); tree = f.render();
  const old = button(tree, 'Confirm transaction');
  tree = f.render({ identity: 'review-2' });
  assert.equal(input(tree).props.value, ''); press(old); assert.equal(f.confirmed.length, 0);
  input(tree).props.onChangeText('second password'); tree = f.render();
  const second = button(tree, 'Confirm transaction');
  tree = f.render({ method: 'biometric' });
  assert.equal(screenElements(tree).some(value => value.type === 'Input'), false);
  press(second); assert.equal(f.confirmed.length, 0); f.close();
});

test('cancel and unmount retire callbacks and clear password input', () => {
  const f = fixture('password'); let tree = f.render();
  input(tree).props.onChangeText('private input'); tree = f.render();
  const confirm = button(tree, 'Confirm transaction'); const cancel = button(tree, 'Cancel');
  press(cancel); press(cancel); press(confirm);
  assert.equal(f.cancelled, 1); assert.equal(f.confirmed.length, 0);
  assert.equal(input(f.render()).props.value, ''); f.close(); press(confirm);
  assert.equal(f.confirmed.length, 0);
});

test('busy authentication blocks input and confirmation, then permits a fresh credential after failure', () => {
  const f = fixture('password'); let tree = f.render();
  input(tree).props.onChangeText('first'); tree = f.render(); press(button(tree, 'Confirm transaction'));
  tree = f.render({ busy: true });
  assert.equal(input(tree).props.editable, false); input(tree).props.onChangeText('ignored');
  assert.equal(button(tree, 'Confirming…').props.disabled, true);
  f.render({ busy: false, error: 'Password not accepted' });
  tree = f.render(); assert.equal(input(tree).props.value, '');
  assert(screenElements(tree).some(value => value.props.accessibilityRole === 'alert'));
  input(tree).props.onChangeText('second'); press(button(f.render(), 'Confirm transaction'));
  assert.equal(f.confirmed.length, 2); f.close();
});

test('an immediate credential rejection permits retry when React never renders the busy state', () => {
  const f = fixture('password'); let tree = f.render();
  input(tree).props.onChangeText('first'); press(button(f.render(), 'Confirm transaction'));
  f.render({ error: 'Password not accepted' }); tree = f.render();
  assert.equal(input(tree).props.editable, true); assert.equal(input(tree).props.value, '');
  input(tree).props.onChangeText('second'); press(button(f.render(), 'Confirm transaction'));
  assert.equal(f.confirmed.length, 2); f.close();
});

test('Android Back and Cancel remain available during pending authentication and retire queued callbacks', () => {
  for (const action of ['back', 'cancel']) {
    const f = fixture('password'); let tree = f.render();
    input(tree).props.onChangeText('private password'); tree = f.render();
    const confirm = button(tree, 'Confirm transaction'); press(confirm);
    tree = f.render({ busy: true });
    assert.notEqual(button(tree, 'Cancel').props.disabled, true);
    if (action === 'back') tree.props.onRequestClose(); else press(button(tree, 'Cancel'));
    assert.equal(f.cancelled, 1); assert.equal(input(f.render()).props.value, '');
    press(confirm); assert.equal(f.confirmed.length, 1); f.close();
  }
});
