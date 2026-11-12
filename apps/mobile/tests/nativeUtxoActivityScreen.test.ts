import assert from 'node:assert/strict';
import test from 'node:test';
import type { UtxoActivityRow, UtxoActivityState } from '../src/core/utxoActivity.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

function fixture(row: UtxoActivityRow) {
  const context = { accountId: 'watch', networkId: 'syscoin' as const, address: 'sys1public', generation: 1 };
  let state: UtxoActivityState = { status: 'ready', context, rows: [row], detail: null,
    firstPage: 1, page: 1, hasMore: false, hasNewer: false, windowed: false };
  class Activity {
    subscribe = () => () => {};
    getSnapshot = () => state;
    activate() {}
    isCurrent() { return true; }
    selectDetail() { state = { ...state, detail: { txid: row.txid, row, from: ['sender'], to: ['recipient'], status: 'ready' } }; }
    clearDetail() { state = { ...state, detail: null }; }
    dispose() {}
    revoke() {}
    setFocused() {}
  }
  const host = screenFixture(new URL('../src/screens/UtxoActivityScreen.tsx', import.meta.url), 'UtxoActivityScreen', {
    '../platform/balancePrivacy': { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden: false }) },
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'ScrollView', 'View'].map(name => [name, name])),
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' },
      StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': { setStringAsync() { throw Error('No clipboard read during status render'); } },
    '../../../../source/shared/utxoTokenAmounts': { formatSyscoinTokenAmount: (value: string) => value },
    '../core/amounts': { formatBaseUnits: (value: string) => value },
    '../core/utxoActivity': { UtxoActivity: Activity },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'IconButton', 'Notice', 'SegmentedControl', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
    './ActivityListRow': { ActivityListRow: 'ActivityListRow', activityDate: () => ({ key: 'day', label: 'Today', time: '' }) },
    './TransactionDetailLayout': { TransactionDetailLayout: 'TransactionDetailLayout' },
    '../activity/activityAmountLabel': { compactActivityAmountLabel },
    '../activity/assetIcon': { utxoActivityAssetIcon: () => undefined },
  });
  const props = { authority: {}, selectedNetwork: { id: 'syscoin', name: 'Syscoin', symbol: 'SYS', decimals: 8, chainId: 57 },
    accountLabel: 'Daily', navigation: { registerBack: () => () => {}, registerLeave: () => () => {}, setImmersive() {} }, onBack() {} };
  const render = () => screenElements(host.render(props));
  return { render, close: host.close, row() {
    const list = render().find(item => item.type === 'FlatList')!;
    return screenElements(list.props.renderItem({ item: row, index: 0 })).find(item => item.type === 'ActivityListRow')!;
  } };
}

for (const kind of ['zdag', 'pending', 'confirmed'] as const) test(`actual UTXO list and detail render ${kind} without promoting pending to mined`, () => {
  const row: UtxoActivityRow = { txid: 'a'.repeat(64), block: kind === 'confirmed' ? { height: 190, hash: 'b'.repeat(64), timestamp: 1700000000 } : null,
    observedConfirmations: kind === 'confirmed' ? 1 : 0, receivedUnits: '0', spentUnits: '1', netUnits: '-1', transactionFeeUnits: '1',
    hasAssetData: true, zdag: kind === 'zdag', assetAmount: { amount: '1', scope: 'transaction', symbol: 'SPT' }, nativeTransfer: null };
  const f = fixture(row);
  try {
    const item = f.row(), expected = kind === 'zdag' ? 'Z-DAG confirmed' : kind === 'confirmed' ? 'Confirmed' : 'Pending';
    assert.equal(item.props.subtitle, `Syscoin · ${expected}`);
    assert(item.props.label.includes(kind === 'confirmed' ? '1 confirmation' : expected));
    item.props.onPress();
    const detail = f.render().find(item => item.type === 'TransactionDetailLayout')!;
    assert.equal(detail.props.status, expected);
    assert.equal(detail.props.tone, kind === 'confirmed' ? 'confirmed' : 'pending');
    assert.equal(row.block === null, kind !== 'confirmed');
  } finally { f.close(); }
});
