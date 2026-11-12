import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

test('public address offers the same exact guarded action on tap and hold', () => {
  let copied = 0;
  const onCopy = () => { copied++; };
  const f = screenFixture(new URL('../src/screens/CopyableAddress.tsx', import.meta.url), 'CopyableAddress', {
    '../platform/localization': nativeTranslationFixture,
    'react-native': { StyleSheet: { create: (x: unknown) => x } },
    './IdleActivityBoundary': { IdlePressable: 'Pressable' },
    '../ui': { Text: 'Text', Icon: 'Icon', colors: {} },
  });
  try {
    const address = `0x${'ab'.repeat(20)}`;
    let nodes = screenElements(f.render({ address, onCopy, testID: 'receive-address' }));
    const action = nodes.find(node => node.type === 'Pressable')!;
    assert.equal(action.props.onPress, onCopy); assert.equal(action.props.onLongPress, onCopy);
    assert(action.props.accessibilityLabel.includes(address)); assert.equal(action.props.accessibilityRole, 'button');
    assert(nodes.some(node => node.type === 'Icon' && node.props.name === 'copy'));
    assert(nodes.some(node => node.type === 'Text' && node.children.includes(address)));
    action.props.onPress(); action.props.onLongPress(); assert.equal(copied, 2);
    nodes = screenElements(f.render({ address, onCopy, disabled: true }));
    assert.equal(nodes.find(node => node.type === 'Pressable')!.props.disabled, true);
  } finally { f.close(); }
});
