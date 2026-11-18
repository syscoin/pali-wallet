import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';

function fixture(hidden = false) {
  const selected: string[] = [];
  const f = screenFixture(new URL('../src/screens/NetworkSourceSheet.tsx', import.meta.url), 'NetworkSourceSheet', {
    'react-native': { FlatList: 'FlatList', View: 'View', StyleSheet: { absoluteFill: {}, create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../platform/localization': nativeTranslationFixture,
    '../platform/balancePrivacy': { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden }) },
    '../activity/activityAmountLabel': { compactActivityAmountLabel },
    '../ui': { Coin: 'Coin', Icon: 'Icon', Text: 'Text', colors: {} },
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'TextInput' },
  });
  const rows = (options: readonly Record<string, unknown>[], selectedId = '', purpose = 'send') => {
    const list = screenElements(f.render({ purpose, options, selectedId, onSelect: (id: string) => selected.push(id), onClose() {} }))
      .find(node => node.type === 'FlatList')!;
    return options.map((item, index) => screenElements(list.props.renderItem({ item, index })));
  };
  return { rows, selected, close: () => f.close() };
}

for (const purpose of ['send', 'receive', 'filter']) test(`${purpose} rows visibly distinguish identical network names by exact chain ID`, () => {
  const f = fixture();
  try {
    const choices = [31337, 31338].map(chainId => ({ id: `custom:${chainId}`, name: 'Shared network', symbol: 'ABC', chainId: String(chainId), available: '1' }));
    const rows = f.rows(choices, choices[1]!.id, purpose);
    for (let i = 0; i < rows.length; i++) {
      const radio = rows[i]!.find(node => node.props.accessibilityRole === 'radio')!;
      assert(radio.props.accessibilityLabel.includes(choices[i]!.chainId));
      const identity = rows[i]!.find(node => node.props.testID === `network-source-identity-${choices[i]!.id}`)!;
      assert.equal(identity.children.join(''), `Chain ID ${choices[i]!.chainId}`);
      radio.props.onPress();
    }
    assert.deepEqual(f.selected, choices.map(choice => choice.id));
  } finally { f.close(); }
});

for (const hidden of [false, true]) test(`saved token identities remain complete and distinct with balances ${hidden ? 'hidden' : 'visible'}`, () => {
  const f = fixture(hidden);
  try {
    // The difference is in the middle: prefix/suffix truncation would hide it.
    const addresses = ['0x11111111111111111111aa111111111111111111', '0x11111111111111111111bb111111111111111111'];
    const options = addresses.map(contractAddress => ({ id: contractAddress, name: 'Example Token', symbol: 'EX', contractAddress, available: '1' }));
    const rows = f.rows(options);
    for (let i = 0; i < rows.length; i++) {
      const radio = rows[i]!.find(node => node.props.accessibilityRole === 'radio')!;
      assert(radio.props.accessibilityLabel.includes(addresses[i]!));
      const identity = rows[i]!.find(node => node.props.testID === `network-source-identity-${addresses[i]}`)!;
      assert.equal(identity.children.join(''), addresses[i]);
      assert.equal(identity.props.numberOfLines, undefined, 'small screens and larger text can wrap the complete contract');
      radio.props.onPress();
    }
    assert.deepEqual(f.selected, addresses);
  } finally { f.close(); }
});
