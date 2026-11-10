import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeOperationCredential } from '../src/custody/types.ts';
import type { TransactionAuthenticationProps } from '../src/screens/TransactionAuthentication.tsx';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

function fixture(method: TransactionAuthenticationProps['method'] = 'biometric') {
  const confirmed: NativeOperationCredential[] = [];
  let cancelled = 0;
  const f = screenFixture(new URL('../src/screens/TransactionAuthentication.tsx', import.meta.url), 'TransactionAuthentication', {
    'react-native': { Modal: 'Modal' },
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
    '../ui': { Button: 'Button' },
    './PinEntry': { PinEntryScreen: 'PinEntry', genericBiometrics: { label: 'biometrics', icon: 'fingerprint' }, isWalletPin: (pin: string) => /^\d{6}$/.test(pin) },
  });
  let props: TransactionAuthenticationProps = { identity: 'review-1', method, busy: false,
    onConfirm: value => confirmed.push(value), onCancel: () => { cancelled++; } };
  return { confirmed, get cancelled() { return cancelled; }, close: f.close,
    render(next: Partial<TransactionAuthenticationProps> = {}) { props = { ...props, ...next }; return f.render(props); } };
}
function entry(tree: ScreenElement) { const found = screenElements(tree).find(value => value.type === 'PinEntry'); assert(found); return found; }
function biometric(tree: ScreenElement) { const found = screenElements(tree).find(value => value.type === 'Button'); assert(found); return found; }

test('biometrics require an explicit action and submit once', () => {
  const f = fixture(), tree = f.render();
  assert.equal(tree.type, 'Modal'); assert.equal(f.confirmed.length, 0);
  assert.equal(biometric(tree).props.title, 'Use biometrics');
  biometric(tree).props.onPress(); biometric(tree).props.onPress();
  assert.equal(JSON.stringify(f.confirmed), JSON.stringify([{ method: 'biometric' }])); f.close();
});

test('six-digit PIN fallback submits once without a password input', () => {
  const f = fixture(), pin = entry(f.render());
  pin.props.onComplete('12345'); pin.props.onComplete('password'); assert.equal(f.confirmed.length, 0);
  pin.props.onComplete('123456'); pin.props.onComplete('654321');
  assert.equal(JSON.stringify(f.confirmed), JSON.stringify([{ method: 'pin', pin: '123456' }])); f.close();
});

test('replaced review or method retires old callbacks and keypad identity', () => {
  const f = fixture('pin'), first = entry(f.render());
  const second = entry(f.render({ identity: 'review-2' }));
  first.props.onComplete('123456'); assert.equal(f.confirmed.length, 0);
  const third = entry(f.render({ method: 'biometric' }));
  assert.notEqual(second.props.key, third.props.key);
  second.props.onComplete('123456'); assert.equal(f.confirmed.length, 0);
  third.props.onComplete('654321'); assert.equal(f.confirmed.length, 1); f.close();
});

test('Back and native modal close invalidate pending callbacks even while busy', () => {
  for (const fromModal of [false, true]) {
    const f = fixture(), tree = f.render({ busy: true }), pin = entry(tree);
    pin.props.onComplete('123456'); assert.equal(f.confirmed.length, 0);
    if (fromModal) tree.props.onRequestClose(); else pin.props.onBack();
    pin.props.onBack(); biometric(tree).props.onPress();
    assert.equal(f.cancelled, 1); assert.equal(f.confirmed.length, 0);
    f.close(); pin.props.onComplete('123456'); assert.equal(f.confirmed.length, 0);
  }
});

test('failed authentication resets keypad and allows fresh entry', () => {
  const f = fixture('pin');
  const first = entry(f.render()); first.props.onComplete('123456');
  f.render({ busy: true });
  f.render({ busy: false, error: 'PIN not accepted' });
  const next = entry(f.render());
  assert.notEqual(first.props.resetKey, next.props.resetKey);
  next.props.onComplete('654321');
  assert.equal(f.confirmed.length, 2); f.close();
});

test('immediate authentication failure without a busy render still permits retry', () => {
  const f = fixture('pin'); entry(f.render()).props.onComplete('123456');
  entry(f.render({ error: 'PIN not accepted' })).props.onComplete('654321');
  assert.equal(f.confirmed.length, 2); f.close();
});

test('biometric cancellation permits explicit retry or PIN without automatically opening a prompt', () => {
  const f = fixture();
  const initial = f.render(); assert.equal(f.confirmed.length, 0);
  biometric(initial).props.onPress(); assert.equal(f.confirmed.length, 1);
  const first = f.render({ busy: true });
  assert.equal(biometric(first).props.disabled, true);
  f.render({ busy: false, error: 'Biometric confirmation cancelled' }); f.render();
  assert.equal(f.confirmed.length, 1);
  entry(f.render()).props.onComplete('123456'); assert.equal(f.confirmed.length, 2);
  const next = f.render({ identity: 'fresh-review', error: '' }); assert.equal(f.confirmed.length, 2);
  biometric(next).props.onPress(); assert.equal(f.confirmed.length, 3);
  f.close();
});


test('detected Face ID names the existing one-shot biometric action', () => {
  const f = fixture(), tree = f.render({ biometrics: { label: 'Face ID', icon: 'face-id' } });
  const action = biometric(tree);
  assert.equal(action.props.title, 'Use Face ID'); assert.equal(action.props.icon, 'face-id');
  action.props.onPress(); action.props.onPress();
  assert.equal(JSON.stringify(f.confirmed), JSON.stringify([{ method: 'biometric' }])); f.close();
});
