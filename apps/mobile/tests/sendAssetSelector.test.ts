import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { getNativeSendContext } from '../src/custody/networkContext.ts';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';

const items = [{ metadata: { contractAddress: '0x' + 'ab'.repeat(20), name: 'USD Coin', symbol: 'USDC', decimals: 6 }, units: '12000000', status: 'available' },
  { metadata: { contractAddress: '0x' + 'cd'.repeat(20), name: 'Dai', symbol: 'DAI', decimals: 18 }, units: '4000000000000000000', status: 'available' }];
function fixture(token = undefined as typeof items[number]['metadata'] | undefined) {
  const selected: unknown[] = []; let closed = 0;
  const screen = screenFixture(new URL('../src/screens/SendAssetSelector.tsx', import.meta.url), 'SendAssetSelector', {
    'react-native': { View: 'View', Modal: 'Modal', StyleSheet: { create: (value: unknown) => value } },
    '../platform/localization': nativeTranslationFixture, '../platform/balancePrivacy': { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden: false }) },
    '../activity/activityAmountLabel': { compactActivityAmountLabel }, '../../../../source/shared/erc20': { formatTokenUnits },
    '../ui': { Text: 'Text', Coin: 'Coin', Icon: 'Icon', colors: {} }, './IdleActivityBoundary': { IdlePressable: 'Pressable' },
    './NetworkSourceSheet': { NetworkSourceSheet: 'NetworkSourceSheet' },
  });
  const render = () => screenElements(screen.render({ context: getNativeSendContext('ethereum'), token, items, nativeAvailable: '1.234', open: true,
    busy: false, loading: false, onOpen() {}, onClose() { closed++; }, onSelect(value: unknown) { selected.push(value); } })).find(node => node.type === 'NetworkSourceSheet')!;
  return { screen, render, selected, closed: () => closed };
}

test('asset search filters saved metadata within the fixed network without selecting an account', () => {
  const f = fixture();
  try {
    const sheet = f.render(); assert.equal(sheet.props.subtitle, 'Ethereum'); assert.equal(sheet.props.options.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(sheet.props.options[1].assetIcon)), { kind: 'evm', chainId: '1', contractAddress: items[0]!.metadata.contractAddress, decimals: 6 });
    assert.equal(sheet.props.options[1].iconRegistrationHash, getNativeSendContext('ethereum').registrationHash);
    sheet.props.search.onChange('usdc');
    const searched = f.render(); assert.equal(searched.props.options.length, 1); assert.equal(searched.props.options[0].name, 'USD Coin');
    searched.props.onSelect(items[0]!.metadata.contractAddress); assert.equal(f.selected[0], items[0]!.metadata);
  } finally { f.screen.close(); }
});

test('selecting the active asset only dismisses while selecting native returns the native choice', () => {
  const f = fixture(items[0]!.metadata);
  try {
    f.render().props.onSelect(items[0]!.metadata.contractAddress); assert.equal(f.closed(), 1); assert.deepEqual(f.selected, []);
    f.render().props.onSelect('native'); assert.deepEqual(f.selected, [undefined]);
    f.render().props.onSelect('unknown'); assert.equal(f.selected.length, 1);
  } finally { f.screen.close(); }
});
