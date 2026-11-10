import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

const components = (names: string[]) => Object.fromEntries(names.map(name => [name, name]));
function environment() {
  const listeners = new Set<(state: string) => void>();
  const native = {
    ...components(['KeyboardAvoidingView', 'View', 'Modal']),
    AppState: { currentState: 'active', addEventListener(_event: string, callback: (state: string) => void) {
      listeners.add(callback); return { remove() { listeners.delete(callback); } };
    } },
    BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} },
    Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value },
  };
  return {
    ports: {
      'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../ui': { ...components(['Button', 'Card', 'Header', 'Icon', 'Notice', 'PaliMark', 'Row', 'Screen', 'Text']), colors: {}, styles: {} },
      './IdleActivityBoundary': { IdlePressable: 'IdlePressable' },
      '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
      '../core/biometricPresentation': { genericBiometrics: { label: 'biometrics', icon: 'fingerprint' } },
      './PinEntry': { PinField: 'PinField' }, './NoteBackupPasswordField': { NoteBackupPasswordField: 'FilePassword' },
    },
    background() { native.AppState.currentState = 'background'; [...listeners].forEach(callback => callback('background')); },
  };
}
function find(tree: unknown, type: unknown, label?: string) {
  const value = screenElements(tree).find(node => node.type === type && (!label || node.props.label === label || node.props.title === label));
  assert(value, `Missing ${String(type)} ${label ?? ''}`); return value;
}
// The file form is a private child component; execute it with the same hook owner.
function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== 'object' || !('type' in value)) return value;
  const element = value as ScreenElement;
  if (typeof element.type === 'function') return expand(element.type({ ...element.props, children: element.children }));
  return { ...element, children: element.children.map(expand), props: { ...element.props, footer: expand(element.props.footer) } };
}

test('PIN field accepts a completed PIN through a fresh inline callback and retires closed callbacks', () => {
  const env = environment(), received: string[] = [];
  const f = screenFixture(new URL('../src/screens/PinEntry.tsx', import.meta.url), 'PinField', env.ports);
  const render = () => f.render({ label: 'Wallet PIN', value: '', busy: false, onChange: (pin: string) => received.push(pin) });
  try {
    find(render(), 'Button', 'Enter PIN').props.onPress();
    let tree = render();
    const first = find(tree, 'Modal').children[0] as ScreenElement;
    first.props.onComplete('123456');
    first.props.onComplete('654321');
    assert.deepEqual(received, ['123456']);
    tree = render(); assert.equal(screenElements(tree).some(node => node.type === 'Modal'), false);
    find(tree, 'Button', 'Enter PIN').props.onPress(); tree = render();
    const stale = (find(tree, 'Modal').children[0] as ScreenElement).props.onComplete;
    find(tree, 'Modal').props.onRequestClose(); render(); stale('654321');
    assert.deepEqual(received, ['123456']);
    find(render(), 'Button', 'Enter PIN').props.onPress(); tree = render();
    const backgrounded = (find(tree, 'Modal').children[0] as ScreenElement).props.onComplete;
    env.background(); backgrounded('654321');
    assert.deepEqual(received, ['123456', '']);
  } finally { f.close(); }
});

test('note export uses a PIN only for wallet authorization and keeps independent file passwords', () => {
  const env = environment(), saved: string[][] = [];
  const f = screenFixture(new URL('../src/screens/NativeNoteExport.tsx', import.meta.url), 'NativeNoteExport', env.ports);
  const props = { step: { phase: 'passwords' }, busy: false, error: '', onChoose() {}, onShowVerify() {}, onVerify() {}, onBack() {},
    onSave(...values: string[]) { saved.push(values); } };
  const render = () => expand(f.render(props));
  try {
    let tree = render();
    assert.equal(screenElements(tree).filter(node => node.type === 'PinField').length, 1);
    assert.equal(screenElements(tree).filter(node => node.type === 'FilePassword').length, 2);
    find(tree, 'PinField', 'Wallet PIN').props.onChange('123456');
    tree = render(); find(tree, 'FilePassword', 'Backup password').props.onChange('A separate long file password');
    tree = render(); find(tree, 'FilePassword', 'Confirm backup password').props.onChange('A separate long file password');
    tree = render(); const save = find(tree, 'Button', 'Save encrypted backup'); assert.equal(save.props.disabled, false); save.props.onPress();
    assert.deepEqual(saved, [['123456', 'A separate long file password']]);
    tree = render(); assert.equal(find(tree, 'PinField', 'Wallet PIN').props.value, '');
    assert.equal(find(tree, 'FilePassword', 'Backup password').props.value, '');
  } finally { f.close(); }
});

for (const review of [false, true]) test(`note restore ${review ? 'wallet authorization uses PIN' : 'file opening retains the file password'}`, () => {
  const env = environment(), submitted: unknown[][] = [];
  const f = screenFixture(new URL('../src/screens/NativeNoteRestore.tsx', import.meta.url), 'NativeNoteRestore', env.ports);
  const props = { step: review ? { phase: 'review', preview: { id: 'preview-1', added: 1, duplicates: 0 } } : { phase: 'password' }, busy: false, error: '',
    onChoose() {}, onBack() {}, onOpen(...values: unknown[]) { submitted.push(values); }, onRestore(...values: unknown[]) { submitted.push(values); } };
  const render = () => expand(f.render(props));
  try {
    let tree = render();
    const kind = review ? 'PinField' : 'FilePassword', label = review ? 'Wallet PIN' : 'Backup password';
    assert.equal(screenElements(tree).filter(node => node.type === (review ? 'FilePassword' : 'PinField')).length, 0);
    find(tree, kind, label).props.onChange(review ? '123456' : 'A separate long file password');
    tree = render(); find(tree, 'Button', review ? 'Restore notes' : 'Open backup').props.onPress();
    assert.deepEqual(submitted, [review ? ['preview-1', '123456'] : ['A separate long file password']]);
    assert.equal(find(render(), kind, label).props.value, '');
  } finally { f.close(); }
});


test('verifying a portable note backup asks only for its file password', () => {
  const env = environment(), verified: string[] = [];
  const f = screenFixture(new URL('../src/screens/NativeNoteExport.tsx', import.meta.url), 'NativeNoteExport', env.ports);
  const props = { step: { phase: 'verify', noteCount: 1 }, busy: false, error: '', onChoose() {}, onShowVerify() {}, onBack() {},
    onSave() { assert.fail('Verify must not save'); }, onVerify(password: string) { verified.push(password); } };
  const render = () => expand(f.render(props));
  try {
    let tree = render();
    assert.equal(screenElements(tree).filter(node => node.type === 'PinField').length, 0);
    assert.equal(screenElements(tree).filter(node => node.type === 'FilePassword').length, 1);
    find(tree, 'FilePassword', 'Backup password').props.onChange('A separate long file password');
    tree = render(); find(tree, 'Button', 'Verify backup').props.onPress();
    assert.deepEqual(verified, ['A separate long file password']);
  } finally { f.close(); }
});
