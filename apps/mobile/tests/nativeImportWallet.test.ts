import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeImportWalletProps } from '../src/screens/NativeImportWallet.tsx';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

const phrase = [...Array<string>(11).fill('abandon'), 'about'].join(' ');
const rows = [{ label: 'Ethereum', address: '0x1111111111111111111111111111111111111111' }, { label: 'Bitcoin', address: 'bc1q-public-preview' }];
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(preview: NativeImportWalletProps['preview'] = async () => rows) {
  const calls: string[] = [], confirmed: string[] = [], events = new Map<string, (...args: any[]) => void>();
  let backs = 0;
  const f = screenFixture(new URL('../src/screens/NativeImportWallet.tsx', import.meta.url), 'NativeImportWallet', {
    'react-native': { StyleSheet: { create: (value: unknown) => value }, Platform: { OS: 'android' }, Keyboard: { dismiss() {} },
      AppState: { currentState: 'active', addEventListener(event: string, callback: (...args: any[]) => void) { events.set(event, callback); return { remove() { events.delete(event); } }; } },
      BackHandler: { addEventListener(_event: string, callback: () => boolean) { events.set('back', callback); return { remove() { events.delete('back'); } }; } },
      View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { colors: {}, ...Object.fromEntries(['Button', 'Card', 'Header', 'Icon', 'Notice', 'Screen', 'SegmentedControl', 'Text'].map(name => [name, name])) },
    './IdleActivityBoundary': { IdleTextInput: 'Input' },
  });
  const props: NativeImportWalletProps = {
    preview: async (value, check) => { calls.push(value); return preview(value, check); },
    onConfirmed(value) { confirmed.push(value); }, onBack() { backs++; },
  };
  return { calls, confirmed, events, close: f.close, get backs() { return backs; },
    render: () => f.render(props),
  };
}
const elements = (tree: ScreenElement) => screenElements(tree);
function button(tree: ScreenElement, title: string) {
  const value = elements(tree).find(row => row.type === 'Button' && row.props.title === title); assert(value, title); return value;
}
function field(tree: ScreenElement, index = 1) {
  const value = elements(tree).find(row => row.type === 'Input' && row.props.accessibilityLabel === `Recovery word ${index}`); assert(value); return value;
}
function back(tree: ScreenElement) {
  const header = elements(tree).find(row => row.type === 'Header'); assert(header); header.props.onBack();
}

test('explicit phrase input fills numbered fields, previews only on Check, and confirms once with only returned addresses', async () => {
  const f = fixture(); let tree = f.render();
  assert.equal(elements(tree).filter(row => row.type === 'Input').length, 12);
  assert.equal(button(tree, 'Check phrase').props.disabled, true);
  field(tree).props.onChangeText(phrase.toUpperCase()); tree = f.render();
  assert.equal(field(tree, 12).props.value, 'about'); assert.deepEqual(f.calls, []);
  button(tree, 'Check phrase').props.onPress(); await tick(); tree = f.render();
  assert.deepEqual(f.calls, [phrase]); assert.equal(elements(tree).some(row => row.type === 'Input'), false);
  for (const row of rows) assert(elements(tree).some(node => node.children.includes(row.address)));
  const confirm = button(tree, 'Continue to security setup'); confirm.props.onPress(); confirm.props.onPress();
  assert.deepEqual(f.confirmed, [phrase]);
  tree = f.render(); assert.equal(field(tree).props.value, ''); f.close();
});

test('24-word selection and complete first-field paste are supported without reading the clipboard', () => {
  const f = fixture(); let tree = f.render();
  field(tree).props.onChangeText('abandon'); tree = f.render();
  const selector = elements(tree).find(row => row.type === 'SegmentedControl'); assert(selector);
  selector.props.onChange('24'); tree = f.render();
  assert.equal(elements(tree).filter(row => row.type === 'Input').length, 24);
  assert.equal(field(tree).props.value, '');
  field(tree).props.onChangeText([...Array<string>(23).fill('abandon'), 'art'].join(' ')); tree = f.render();
  assert.equal(field(tree, 24).props.value, 'art'); assert.equal(button(tree, 'Check phrase').props.disabled, false);
  assert.deepEqual(f.calls, []); f.close();
});

test('Back retires a held preview and returns from confirmation to an empty phrase form', async () => {
  const held = Promise.withResolvers<void>(); let check!: () => void;
  const f = fixture(async (_phrase, current) => { check = current; await held.promise; return rows; });
  let tree = f.render(); field(tree).props.onChangeText(phrase); tree = f.render();
  button(tree, 'Check phrase').props.onPress(); back(f.render());
  assert.equal(f.backs, 1); assert.throws(check, /CANCELLED/);
  held.resolve(); await tick(); tree = f.render();
  assert.equal(field(tree).props.value, ''); assert.equal(elements(tree).some(row => row.children.includes(rows[0]!.address)), false); f.close();
  const ready = fixture(); tree = ready.render(); field(tree).props.onChangeText(phrase);
  button(ready.render(), 'Check phrase').props.onPress(); await tick(); tree = ready.render();
  const oldConfirm = button(tree, 'Continue to security setup'); back(tree); oldConfirm.props.onPress();
  assert.deepEqual(ready.confirmed, []); assert.equal(ready.backs, 0); assert.equal(field(ready.render()).props.value, ''); ready.close();
});

test('background and unmount clear local words and reject late public preview results', async () => {
  const held = Promise.withResolvers<void>(); let check!: () => void;
  const f = fixture(async (_phrase, current) => { check = current; await held.promise; return rows; });
  let tree = f.render(); field(tree).props.onChangeText(phrase); button(f.render(), 'Check phrase').props.onPress();
  f.events.get('change')!('background'); assert.throws(check, /CANCELLED/);
  tree = f.render(); assert.equal(field(tree).props.value, ''); f.close();
  held.resolve(); await tick(); assert.deepEqual(f.confirmed, []); assert.throws(check, /CANCELLED/);
});

test('empty preview results cannot reach confirmation and errors do not echo the phrase', async () => {
  const f = fixture(async () => []); let tree = f.render(); field(tree).props.onChangeText(phrase);
  button(f.render(), 'Check phrase').props.onPress(); await tick(); tree = f.render();
  assert.equal(elements(tree).some(row => row.props.title === 'Continue to security setup'), false);
  const error = elements(tree).find(row => row.props.accessibilityRole === 'alert'); assert(error);
  assert(!JSON.stringify(error.children).includes(phrase)); f.close();
});
