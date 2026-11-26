import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeUtxoReplacement } from '../src/custody/utxoSend.ts';
import type { UtxoActivityRow, UtxoActivityState } from '../src/core/utxoActivity.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { formatSyscoinTokenAmount } from '../../../source/shared/utxoTokenAmounts.ts';
import { createUtxoActivityReader } from '../src/core/utxoActivity.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';

function fixture(row: UtxoActivityRow, replacement?: {
  availableReplacements(txid: string, check: () => void): Promise<readonly NativeUtxoReplacement['mode'][]>;
  onReplace(replacement: NativeUtxoReplacement): void;
}) {
  const context = { accountId: 'watch', networkId: 'syscoin' as const, address: 'sys1public', generation: 1 };
  let state: UtxoActivityState = { status: 'ready', context, rows: [row], detail: null,
    firstPage: 1, page: 1, hasMore: false, hasNewer: false, windowed: false };
  let olderRow: UtxoActivityRow | undefined;
  class Activity {
    subscribe = () => () => {};
    getSnapshot = () => state;
    activate() {}
    isCurrent() { return true; }
    selectDetail(txid: string) {
      const selected = state.rows.find(entry => entry.txid === txid)!;
      state = { ...state, detail: { txid, row: selected, from: ['sender'], to: ['recipient'], status: 'ready' } };
    }
    loadMore() {
      assert(olderRow);
      state = { ...state, rows: [...state.rows, olderRow], page: 2, hasMore: false };
    }
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
    '../../../../source/shared/utxoTokenAmounts': { formatSyscoinTokenAmount },
    '../core/amounts': { formatBaseUnits },
    '../core/utxoActivity': { UtxoActivity: Activity },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'IconButton', 'Notice', 'SegmentedControl', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
    './ActivityListRow': { ActivityListRow: 'ActivityListRow', activityDate: () => ({ key: 'day', label: 'Today', time: '' }) },
    './TransactionDetailLayout': { TransactionDetailLayout: 'TransactionDetailLayout' },
    '../activity/activityAmountLabel': { compactActivityAmountLabel },
    '../activity/assetIcon': { utxoActivityAssetIcon: () => undefined },
  });
  const props = { initialHash: undefined as string | undefined, onInitialTargetOpened: undefined as (() => void) | undefined,
    authority: {}, selectedNetwork: { id: 'syscoin', name: 'Syscoin', symbol: 'SYS', decimals: 8, chainId: 57 },
    ...replacement, accountLabel: 'Daily', navigation: { registerBack: () => () => {}, registerLeave: () => () => {}, beginNavigation() {}, setImmersive() {} }, onBack() {} };
  const render = () => screenElements(host.render(props));
  return {
    render, close: host.close,
    target(hash?: string, opened?: () => void) { props.initialHash = hash; props.onInitialTargetOpened = opened; },
    setStatus(status: UtxoActivityState['status']) { state = { ...state, status }; },
    addOlderRow(older: UtxoActivityRow) { olderRow = older; state = { ...state, hasMore: true }; },
    row() {
      const list = render().find(item => item.type === 'FlatList')!;
      return screenElements(list.props.renderItem({ item: row, index: 0 })).find(item => item.type === 'ActivityListRow')!;
    },
  };
}

test('UTXO Activity waits for a successful page and keeps the target details after acknowledgment', async () => {
  const txid = 'e'.repeat(64);
  const row: UtxoActivityRow = { txid, block: null, observedConfirmations: 0, receivedUnits: '0', spentUnits: '10000',
    netUnits: '-10000', transactionFeeUnits: '100', hasAssetData: false, zdag: false, assetAmount: null, nativeTransfer: null };
  const f = fixture(row);
  let opened = 0;
  const acknowledge = () => { opened++; };
  try {
    f.setStatus('unavailable');
    f.target(txid, acknowledge);
    f.render();
    await Promise.resolve();
    assert.equal(opened, 0);
    f.setStatus('ready');
    f.render();
    await Promise.resolve();
    assert.equal(opened, 1);
    f.target();
    assert(f.render().some(item => item.type === 'TransactionDetailLayout'));
    f.render().find(item => item.type === 'Header')!.props.onBack();
    assert(!f.render().some(item => item.type === 'TransactionDetailLayout'));
    f.target(txid, acknowledge);
    f.render();
    await Promise.resolve();
    assert.equal(opened, 2, 'a new deliberate visit can open the same transaction');
  } finally { f.close(); }
});

test('a notification outside the loaded UTXO page leaves older activity for the user to open', async () => {
  const row: UtxoActivityRow = { txid: 'a'.repeat(64), block: null, observedConfirmations: 0,
    receivedUnits: '0', spentUnits: '10000', netUnits: '-10000', transactionFeeUnits: '100',
    hasAssetData: false, zdag: false, assetAmount: null, nativeTransfer: null };
  const older = { ...row, txid: 'b'.repeat(64) };
  const f = fixture(row);
  let handled = 0;
  const list = () => f.render().find(item => item.type === 'FlatList')!;
  try {
    f.addOlderRow(older);
    f.target(older.txid, () => { handled++; });
    list();
    await Promise.resolve();
    assert.equal(handled, 1);
    f.target();
    const before = list();
    assert(screenElements(before.props.ListHeaderComponent).some(item => item.type === 'Notice' && item.props.body === 'Load older activity'));
    screenElements(before.props.ListFooterComponent).find(item => item.props.title === 'Older activity')!.props.onPress();
    const after = list();
    assert.deepEqual(after.props.data.map((entry: UtxoActivityRow) => entry.txid), [row.txid, older.txid]);
    assert(!screenElements(after.props.ListHeaderComponent).some(item => item.type === 'Notice'));
    assert(!f.render().some(item => item.type === 'TransactionDetailLayout'));
    screenElements(after.props.renderItem({ item: older, index: 1 })).find(item => item.type === 'ActivityListRow')!.props.onPress();
    assert(f.render().some(item => item.type === 'TransactionDetailLayout'));
    assert.equal(handled, 1);
  } finally { f.close(); }
});

test('UTXO Activity exposes only the admitted replacement actions for its current pending detail', async () => {
  const txid = 'e'.repeat(64);
  const row: UtxoActivityRow = { txid, block: null, observedConfirmations: 0, receivedUnits: '0', spentUnits: '10000',
    netUnits: '-10000', transactionFeeUnits: '100', hasAssetData: false, zdag: false, assetAmount: null, nativeTransfer: null };
  const targets: NativeUtxoReplacement[] = [];
  const f = fixture(row, {
    async availableReplacements(hash, check) { check(); assert.equal(hash, txid); return ['cancel']; },
    onReplace(target) { targets.push(target); },
  });
  const action = (title: string) => f.render().find(item => item.type === 'Button' && item.props.title === title);
  try {
    f.row().props.onPress();
    assert.equal(action('Cancel pending transaction'), undefined);
    await Promise.resolve();
    assert.equal(action('Speed Up'), undefined);
    const cancel = action('Cancel pending transaction');
    assert(cancel);
    cancel.props.onPress();
    assert.equal(targets[0]?.txid, txid);
    assert.equal(targets[0]?.mode, 'cancel');
    f.render().find(item => item.type === 'Header')!.props.onBack();
    cancel.props.onPress();
    assert.equal(targets.length, 1);
  } finally { f.close(); }
});

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


for (const [amount, direction, expected] of [
  ['1.23456789', 'sent', '−1.23456789 TSPT'],
  ['9007199254740993.12345678', 'received', '+9007199254740993.12345678 TSPT'],
  ['0', undefined, '0 TSPT'],
] as const) test(`expanded SPT detail preserves exact selectable quantity ${amount}`, () => {
  const row: UtxoActivityRow = { txid: 'c'.repeat(64), block: null, observedConfirmations: 0,
    receivedUnits: '0', spentUnits: '180', netUnits: '-180', transactionFeeUnits: '180',
    hasAssetData: true, zdag: false, assetAmount: { amount, decimals: 8, direction, scope: 'account', symbol: 'TSPT' }, nativeTransfer: null };
  const f = fixture(row);
  try {
    f.row().props.onPress();
    const initial = f.render();
    const hero = initial.find(item => item.type === 'TransactionDetailLayout')!;
    const sign = direction === 'sent' ? '−' : direction === 'received' ? '+' : '';
    assert.equal(hero.props.amount, `${sign}${formatSyscoinTokenAmount(amount, 8)} TSPT`);
    initial.find(item => item.type === 'Button' && item.props.expanded === false)!.props.onPress();
    const exact = f.render().find(item => item.type === 'Text' && item.props.selectable && item.children.join('').endsWith(' TSPT'))!;
    assert.equal(exact.children.join(''), expected);
    assert.equal(exact.props.accessibilityLabel, expected);
    assert.equal(exact.props.selectable, true);
    assert.equal(exact.props.numberOfLines, undefined);
  } finally { f.close(); }
});

test('expanded asset detail keeps an unavailable quantity distinct from known zero', () => {
  const row: UtxoActivityRow = { txid: 'd'.repeat(64), block: null, observedConfirmations: 0,
    receivedUnits: '0', spentUnits: '180', netUnits: '-180', transactionFeeUnits: '180',
    hasAssetData: true, zdag: false, assetAmount: null, nativeTransfer: null };
  const f = fixture(row);
  try {
    f.row().props.onPress();
    f.render().find(item => item.type === 'Button' && item.props.expanded === false)!.props.onPress();
    const exact = f.render().find(item => item.type === 'Text' && item.props.selectable && item.children.join('') === 'Asset amount unavailable')!;
    assert.equal(exact.children.join(''), 'Asset amount unavailable');
    assert.equal(exact.props.accessibilityLabel, 'Asset amount unavailable');
  } finally { f.close(); }
});

for (const kind of ['sent', 'self', 'received'] as const)
  test(`UTXO ${kind} list and detail use the real reader's transfer amount and direction`, async () => {
    const network = getUtxoNetwork('syscoin');
    const address = 'sys1qw508d6qejxtdg4y5r3zarvary0c5xw7kyhct58';
    const incoming = kind === 'received', self = kind === 'self';
    const tx = { txid: 'e'.repeat(64), blockHeight: 190, blockHash: 'f'.repeat(64), confirmations: 11,
      blockTime: 1700000000, fees: '100000',
      valueIn: incoming ? '100100000' : '200000000', value: incoming ? '100000000' : '199900000',
      addressValueIn: incoming ? '0' : '200000000', addressValueOut: incoming ? '100000000' : self ? '199900000' : '99900000',
      vin: [{ value: incoming ? '100100000' : '200000000', isOwn: !incoming }],
      vout: incoming ? [{ value: '100000000', isOwn: true }] : self ? [{ value: '199900000', isOwn: true }]
        : [{ value: '99900000', isOwn: true }, { value: '100000000', isOwn: false }],
    };
    const reader = createUtxoActivityReader({ fetch: async (url) => {
      const path = new URL(url).pathname;
      const body = path === '/api/v2/'
        ? { blockbook: { coin: network.blockbookCoin, network: network.symbol, decimals: 8, initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 200 }, backend: { chain: 'main' } }
        : path === '/api/v2/block-index/0' ? { blockHash: network.genesisHash }
          : { address, txs: 1, unconfirmedTxs: 0, page: 1, totalPages: 1, itemsOnPage: 20, transactions: [tx] };
      return Response.json(body);
    } });
    const page = await reader.readPage({ context: { accountId: 'watch', networkId: 'syscoin', address, generation: 1 }, identifier: address, isAccount: false }, { page: 1 }, new AbortController().signal);
    const row = page.rows[0]!;
    assert.equal(row.nativeTransfer?.kind, self ? 'self' : incoming ? 'received' : 'external');
    assert.equal(row.transactionFeeUnits, '100000');
    const f = fixture(row);
    try {
      const item = f.row();
      assert.equal(item.props.direction, kind);
      assert.equal(item.props.title, self ? 'Self transfer' : incoming ? 'Received' : 'Sent');
      assert.equal(item.props.amount, self ? '1.999 SYS' : incoming ? '+1 SYS' : '-1 SYS');
      item.props.onPress();
      const detail = f.render().find(item => item.type === 'TransactionDetailLayout')!;
      assert.equal(detail.props.amount, self ? '1.999 SYS' : incoming ? '+1.0 SYS' : '−1.0 SYS');
      assert.equal(detail.props.direction, item.props.title);
      assert.equal(detail.props.rows.find((entry: { label: string }) => entry.label === 'Network Fee').value, '0.001 SYS');
    } finally { f.close(); }
  });

test('indexed UTXO replacement titles distinguish a Speed Up and Cancellation from a plain self-transfer', () => {
  const self = { txid: '5'.repeat(64), block: null, observedConfirmations: 0, receivedUnits: '9000', spentUnits: '10000',
    netUnits: '-1000', transactionFeeUnits: '1000', hasAssetData: false, zdag: false, assetAmount: null,
    nativeTransfer: { kind: 'self' as const, amount: '9000' } };
  for (const [kind, title] of [[undefined, 'Self transfer'], ['speed-up', 'Speed Up'], ['cancel', 'Cancellation']] as const) {
    const f = fixture({ ...self, ...(kind ? { replacementKind: kind } : {}) });
    try {
      const row = f.row();
      assert.equal(row.props.title, title);
      if (kind) assert.match(row.props.label, new RegExp(`^${title}\\.`));
      row.props.onPress();
      const detail = f.render().find(item => item.type === 'TransactionDetailLayout');
      assert.equal(detail?.props.direction, title);
    } finally { f.close(); }
  }
});
