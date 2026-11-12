import assert from 'node:assert/strict';
import test from 'node:test';
import { createWatchAccount } from '../src/core/watchOnlyAuthority.ts';
import { parseUtxoPublicIdentifier } from '../src/core/utxoIdentifier.ts';
import { getUtxoNetwork, isCustomUtxoNetworkId, UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

for (const platform of ['android', 'ios', 'web']) test(`add-watch keyboard space preserves separate review and save (${platform})`, async () => {
  const saved: unknown[] = [];
  const f = screenFixture(new URL('../src/screens/Onboarding.tsx', import.meta.url), 'AddWatchAccount', {
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', TextInput: 'TextInput',
      KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator', Platform: { OS: platform },
      StyleSheet: { create: (value: unknown) => value }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) } },
    '../ui': { Button: 'Button', Icon: 'Icon', colors: {} },
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'Input' },
    '../core/watchOnlyAuthority': { createWatchAccount }, '../core/utxoIdentifier': { parseUtxoPublicIdentifier },
    '../core/utxoNetworks': { getUtxoNetwork, isCustomUtxoNetworkId, UTXO_NETWORKS }, './WatchNetworks': {},
  });
  const props = { onAdd: async (value: unknown) => { saved.push({ ...(value as Record<string, unknown>) }); }, onCancel() {} };
  const render = () => screenElements(f.render(props));
  const press = (label: string) => render().find(node => node.type === 'Pressable' && screenElements(node).some(child => child.children.includes(label)))!.props.onPress();
  try {
    const form = render();
    assert.equal(form.find(node => node.type === 'KeyboardAvoidingView')!.props.behavior,
      platform === 'android' ? 'height' : platform === 'ios' ? 'padding' : undefined);
    assert.equal(form.find(node => node.type === 'ScrollView')!.props.keyboardShouldPersistTaps, 'handled');
    const input = form.find(node => node.type === 'Input' && node.props.accessibilityLabel === 'Public EVM address')!;
    input.props.onChangeText('0x1111111111111111111111111111111111111111');
    press('Review account');
    assert.deepEqual(saved, [], 'Opening review must not save the account');
    assert.equal(render().some(node => node.type === 'Input'), false);
    press('Confirm watch account');
    assert.deepEqual(saved, [{ name: 'Account 1', address: '0x1111111111111111111111111111111111111111', network: 'evm' }]);
    await Promise.resolve();
  } finally { f.close(); }
});

test('watch validation scrolls the rendered error and repeated failure without saving or using stale callbacks', async () => {
  let saves = 0;
  const scrolls: unknown[] = [];
  const f = screenFixture(new URL('../src/screens/Onboarding.tsx', import.meta.url), 'AddWatchAccount', {
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', TextInput: 'TextInput',
      KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'android' },
      StyleSheet: { create: (value: unknown) => value }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) } },
    '../ui': { Button: 'Button', Icon: 'Icon', colors: {} },
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'Input' },
    '../core/watchOnlyAuthority': { createWatchAccount }, '../core/utxoIdentifier': { parseUtxoPublicIdentifier },
    '../core/utxoNetworks': { getUtxoNetwork, isCustomUtxoNetworkId, UTXO_NETWORKS }, './WatchNetworks': {},
  });
  const props = { onAdd: async () => { saves++; throw Error('Save unavailable'); }, onCancel() {} };
  const render = () => screenElements(f.render(props));
  const press = (label: string) => render().find(node => node.type === 'Pressable' && screenElements(node).some(child => child.children.includes(label)))!.props.onPress();
  try {
    render().find(node => node.type === 'ScrollView')!.props.ref.current = { scrollTo() {}, scrollToEnd: (options: unknown) => scrolls.push({ ...(options as Record<string, unknown>) }) };
    press('Review account');
    const invalid = render();
    const error = invalid.find(node => node.props.accessibilityRole === 'alert')!;
    assert.match(error.children.join(''), /public address/);
    assert.equal(saves, 0);
    assert.equal(scrolls.length, 0, 'The first error must be laid out before scrolling');
    const firstLayout = invalid.find(node => node.props.accessibilityLiveRegion === 'polite')!.props.onLayout;
    firstLayout();
    assert.deepEqual(scrolls, [{ animated: true }]);
    press('Review account');
    assert.equal(scrolls.length, 2, 'The same error must remain reachable on repeated submission');
    assert.equal(saves, 0);
    invalid.find(node => node.type === 'Input' && node.props.accessibilityLabel === 'Public EVM address')!.props.onChangeText('0x1111111111111111111111111111111111111111');
    render(); firstLayout();
    assert.equal(scrolls.length, 2, 'A cleared error must not scroll a newer form');
    press('Review account'); press('Confirm watch account');
    await new Promise(resolve => setImmediate(resolve));
    const failedSave = render();
    assert.equal(saves, 1);
    assert(failedSave.some(node => node.props.accessibilityRole === 'alert' && node.children.includes('Save unavailable')));
    const lastLayout = failedSave.find(node => node.props.accessibilityLiveRegion === 'polite')!.props.onLayout;
    lastLayout(); assert.equal(scrolls.length, 3);
    f.close(); lastLayout();
    assert.equal(scrolls.length, 3, 'An unmounted error must not scroll');
  } finally { f.close(); }
});
