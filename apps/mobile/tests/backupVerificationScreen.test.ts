import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

function fixture() {
  const confirmed: readonly string[][] = [];
  const f = screenFixture(new URL('../src/screens/BackupVerification.tsx', import.meta.url), 'BackupVerification', {
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { Button: 'Button', Card: 'Card', Header: 'Header', Screen: 'Screen', Text: 'Text', colors: {} },
    './IdleActivityBoundary': { IdlePressable: 'Slot' },
  }, { crypto: webcrypto });
  let props = { presentation: { id: 'first', words: ['one', 'two', 'one'] }, busy: false, error: '', onBack() {}, onConfirm: (words: string[]) => { (confirmed as string[][]).push(words); } };
  return { confirmed, close: f.close, render(patch: Partial<typeof props> = {}) { props = { ...props, ...patch }; return screenElements(f.render(props)); } };
}
function action(tree: ScreenElement[], title: string, key?: number) {
  const found = tree.find(value => value.type === 'Button' && value.props.title === title && (key === undefined || value.props.key === key));
  assert(found, title); return found;
}

test('all numbered slots must be selected and duplicate words retain their identity', () => {
  const f = fixture(); let tree = f.render();
  assert.equal(action(tree, 'Confirm backup').props.disabled, true);
  for (const [word, id] of [['one', 0], ['two', 1], ['one', 2]] as const) { action(tree, word, id).props.onPress(); tree = f.render(); }
  const confirm = action(tree, 'Confirm backup'); assert.equal(confirm.props.disabled, false);
  confirm.props.onPress(); confirm.props.onPress();
  assert.equal(f.confirmed.length, 1); assert.equal(f.confirmed[0]!.join(' '), 'one two one'); f.close();
});

test('a new phrase cannot inherit selected words or callbacks from the old phrase', () => {
  const f = fixture(), old = f.render(), oldWord = action(old, 'one', 0);
  oldWord.props.onPress(); f.render();
  let next = f.render({ presentation: { id: 'second', words: ['new', 'phrase', 'words'] } });
  oldWord.props.onPress(); next = f.render();
  assert.equal(action(next, 'Confirm backup').props.disabled, true);
  assert(!next.some(value => value.type === 'Slot' && value.props.accessibilityLabel.endsWith(', selected')));
  f.close(); oldWord.props.onPress(); assert.equal(f.confirmed.length, 0);
});

test('selected slot labels expose the chosen word and position while removal is a separate hint', () => {
  const f = fixture(); let tree = f.render();
  action(tree, 'two', 1).props.onPress(); tree = f.render();
  action(tree, 'one', 2).props.onPress(); tree = f.render();
  const slots = tree.filter(value => value.type === 'Slot');
  assert.equal(slots[0]!.props.accessibilityLabel, 'Word 1, two, selected');
  assert.equal(slots[1]!.props.accessibilityLabel, 'Word 2, one, selected');
  assert.equal(slots[0]!.props.accessibilityHint, 'Remove this and later words.');
  slots[0]!.props.onPress(); tree = f.render();
  assert.deepEqual(tree.filter(value => value.type === 'Slot').map(value => value.props.accessibilityLabel), ['Word 1, empty', 'Word 2, empty', 'Word 3, empty']);
  f.close();
});
