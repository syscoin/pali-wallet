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
