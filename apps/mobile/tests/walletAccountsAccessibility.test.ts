import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { accountIdentity, projectAccounts } from '../src/core/accountDirectory.ts';
import { getNetwork } from '../src/core/networks.ts';
import { createEvmWatchAccount } from '../src/core/watchOnlyAuthority.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

for (const shared of [false, true]) test(`same-name watch account actions include complete identities and selected state (${shared ? 'seven EVM networks' : 'one network'})`, async () => {
  const first = '0x1111111111111111111111111111111111111111';
  const second = '0x1111111111111111111111111111111111112222';
  const selections: unknown[] = [];
  const f = screenFixture(new URL('../src/screens/WalletAccounts.tsx', import.meta.url), 'WalletAccounts', {
    '../platform/localization': nativeTranslationFixture,
    react: {},
    'react-native': { View: 'View', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'IconButton', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'Input' },
    '../core/accountDirectory': { accountIdentity, projectAccounts }, '../core/networks': { getNetwork },
    './Onboarding': { AddWatchAccount: 'AddWatchAccount' },
  });
  try {
    const tree = screenElements(f.render({ catalogue: null, active: { kind: 'watch', id: 'first' },
      watch: { status: 'ready', busy: false, accounts: shared ? [
        createEvmWatchAccount('first', 'Savings', first), createEvmWatchAccount('second', 'Savings', second),
      ] : [
        { id: 'first', name: 'Savings', addresses: { ethereum: first } },
        { id: 'second', name: 'Savings', addresses: { ethereum: second } },
      ] }, onSelect: (selection: unknown) => { selections.push(selection); }, onBack() {} }));
    const select = tree.filter(node => node.type === 'Pressable');
    assert.equal(select.length, 2);
    for (const [index, address] of [first, second].entries()) {
      const network = shared ? 'Public EVM address' : 'Ethereum';
      assert.equal(select[index]!.props.accessibilityLabel, `Select Savings (watch-only), ${network}, ${address}${index === 0 ? ', selected' : ''}`);
      assert.equal(select[index]!.props.accessibilityLabel.split(address).length - 1, 1);
      assert.equal(select[index]!.props.accessibilityState.selected, index === 0);
      for (const action of ['Rename', 'Remove']) assert(tree.some(node => node.type === 'IconButton' && node.props.label === `${action} Savings (watch-only), ${network}, ${address}`));
    }
    await select[1]!.props.onPress();
    assert.deepEqual(selections, [{ kind: 'watch', id: 'second' }]);
  } finally { f.close(); }
});

for (const platform of ['android', 'ios', 'web']) test(`watch rename reserves keyboard space and keeps the existing save binding (${platform})`, async () => {
  const renamed: unknown[] = [];
  let finish!: () => void;
  const saving = new Promise<void>(resolve => { finish = resolve; });
  const f = screenFixture(new URL('../src/screens/WalletAccounts.tsx', import.meta.url), 'WalletAccounts', {
    '../platform/localization': nativeTranslationFixture,
    'react-native': { View: 'View', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: platform }, StyleSheet: { create: (value: unknown) => value }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'IconButton', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'Input' },
    '../core/accountDirectory': { accountIdentity, projectAccounts }, '../core/networks': { getNetwork },
    './Onboarding': { AddWatchAccount: 'AddWatchAccount' },
  });
  const props = { catalogue: null, active: null,
    watch: { status: 'ready', busy: false, accounts: [createEvmWatchAccount('watched', 'Savings', '0x1111111111111111111111111111111111111111')] },
    onRename: async (...args: unknown[]) => { renamed.push(args); await saving; }, onSelect() {}, onBack() {} };
  const render = () => screenElements(f.render(props));
  const behavior = (tree: ReturnType<typeof render>) => tree.find(node => node.type === 'KeyboardAvoidingView')!.props.behavior;
  try {
    const initial = render();
    assert.equal(behavior(initial), platform === 'ios' ? 'padding' : undefined);
    initial.find(node => node.type === 'IconButton' && node.props.icon === 'edit')!.props.onPress();
    const form = render();
    assert.equal(behavior(form), platform === 'ios' ? 'padding' : platform === 'android' ? 'height' : undefined);
    assert.equal(form.find(node => node.type === 'KeyboardAvoidingView')!.props.keyboardVerticalOffset ?? 0, 0, 'Rename already includes its SafeAreaView position');
    const input = form.find(node => node.type === 'Input')!;
    assert.equal(input.props.value, 'Savings');
    assert.equal(input.props.editable, true);
    input.props.onChangeText('Travel');
    const edited = render();
    const footer = edited.find(node => node.type === 'Screen')!.props.footer;
    assert.equal(footer.props.title, 'Save name');
    assert.equal(footer.props.disabled, false);
    footer.props.onPress();
    assert.deepEqual(renamed, [['watched', 'Travel']]);
    const busy = render();
    assert.equal(busy.find(node => node.type === 'Input')!.props.editable, false);
    assert.equal(busy.find(node => node.type === 'Screen')!.props.footer.props.disabled, true);
    finish(); await saving; await new Promise(resolve => setImmediate(resolve));
    assert.equal(behavior(render()), platform === 'ios' ? 'padding' : undefined);
  } finally { finish(); f.close(); }
});

test('Android keyboard avoidance stays scoped to rename rather than add or remove', () => {
  const f = screenFixture(new URL('../src/screens/WalletAccounts.tsx', import.meta.url), 'WalletAccounts', {
    '../platform/localization': nativeTranslationFixture,
    'react-native': { View: 'View', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'IconButton', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'Input' },
    '../core/accountDirectory': { accountIdentity, projectAccounts }, '../core/networks': { getNetwork },
    './Onboarding': { AddWatchAccount: 'AddWatchAccount' },
  });
  const props = { catalogue: null, active: null,
    watch: { status: 'ready', busy: false, accounts: [createEvmWatchAccount('watched', 'Savings', '0x1111111111111111111111111111111111111111')] },
    onSelect() {}, onBack() {} };
  const render = () => screenElements(f.render(props));
  try {
    render().find(node => node.type === 'IconButton' && node.props.icon === 'trash')!.props.onPress();
    const removal = render();
    assert.equal(removal.find(node => node.type === 'KeyboardAvoidingView')!.props.behavior, undefined);
    removal.find(node => node.type === 'Header')!.props.onBack();
    const addTitle = nativeTranslationFixture.useNativeTranslation().t('mobile.welcome.watch');
    render().find(node => node.type === 'Button' && node.props.title === addTitle)!.props.onPress();
    const adding = render();
    assert(adding.some(node => node.type === 'AddWatchAccount'));
    assert.equal(adding.find(node => node.type === 'KeyboardAvoidingView')!.props.behavior, undefined);
  } finally { f.close(); }
});
