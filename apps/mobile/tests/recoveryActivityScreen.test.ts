import { walletUiFixture } from './walletUiFixture.ts';
import { englishI18n, languageMessages, nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW } from '../src/activity/types.ts';
import { NativeActivity, type NativeActivityRuntime } from '../src/activity/nativeActivity.ts';
import { activityAssetIcon } from '../src/activity/assetIcon.ts';
import { getEvmTransactionDisplayInfo } from '../../../source/shared/evmTransactionDisplay.ts';
import { mapEvmExplorerTokenTransfer, mapEvmExplorerTransaction } from '../../../source/shared/evmHistory.ts';
import { activityRowDirection, matchesActivityView, zeroOnlyActivity } from '../src/activity/activityFiltering.ts';
import { observeEvmTransaction } from '../../../source/shared/evmTransactionObservation.ts';

type Element = { type: any; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; dependencies?: unknown[]; cleanup?: () => void };
const hash = '0x' + '11'.repeat(32);
function fixture(initialHash?: string, held = false, props: Record<string, unknown> = {}, clipboard: (address: string) => Promise<boolean> = async () => true) {
  let hardwareBack: (() => boolean) | undefined;
  let privacyHidden = false;
  const cells = new Map<unknown, Cell[]>();
  let current: Cell[] = [],
    cursor = 0;
  const effects: (() => void)[] = [];
  const cell = () => current[cursor++] ?? (current[cursor - 1] = {});
  const effect = (fn: () => void | (() => void), deps?: unknown[]) => {
    const slot = cell();
    if (
      deps &&
      slot.dependencies &&
      deps.length === slot.dependencies.length &&
      deps.every((value, index) => value === slot.dependencies![index])
    )
      return;
    slot.dependencies = deps;
    effects.push(() => {
      slot.cleanup?.();
      slot.cleanup = fn() || undefined;
    });
  };
  const react = {
    createElement: (
      type: unknown,
      props: object | null,
      ...children: unknown[]
    ) => ({ type, props: props ?? {}, children }),
    useState(value: unknown) {
      const slot = cell();
      if (!Object.hasOwn(slot, 'value'))
        slot.value = typeof value === 'function' ? value() : value;
      return [
        slot.value,
        (next: any) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useRef(value: unknown) {
      const slot = cell();
      slot.value ??= { current: value };
      return slot.value;
    },
    useEffect: effect,
    useLayoutEffect: effect,
    useCallback: (value: unknown) => {
      cell();
      return value;
    },
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => {
      cell();
      return get();
    },
  };
  let snapshot: any = {
    status: 'ready',
    rows: [],
    view: DEFAULT_ACTIVITY_VIEW,
    accountAddress: '0x' + '22'.repeat(20),
    scopeKey: 'guardian:ethereum:1',
    chainId: '1',
    nativeSymbol: 'ETH',
    explorerUrl: null,
    loadingMore: false,
    hasMore: false,
    error: null,
    coverage: 'explorer-transfers',
    truncated: false,
    canViewSavedPending: true,
  };
  let loaded = 0,
    replays = 0,
    backs = 0,
    closedPending = 0,
    release!: () => void;
  const inspected: string[] = [];
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    connect: () => () => {},
    async loadSavedPending() {
      loaded++;
      if (held) await gate;
      snapshot = {
        ...snapshot,
        savedPending: {
          rows: [{ hash, checking: false, unavailable: false }],
          status: 'ready',
          hasMore: false,
        },
      };
    },
    inspect(value: string) {
      inspected.push(value);
    },
    closeSavedPending() { closedPending++; snapshot = { ...snapshot, savedPending: undefined }; },
    async setView(update: object) { snapshot = { ...snapshot, view: { ...snapshot.view, ...update } }; },
  };
  const ui = Object.fromEntries(
    ['Button', 'Card', 'Header', 'IconButton', 'Notice', 'SegmentedControl', 'Text'].map((name) => [name, name])
  );
  const native = Object.fromEntries(
    ['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'View'].map(
      (name) => [name, name]
    )
  );
  const dependencies: Record<string, unknown> = {
    '../platform/localization': nativeTranslationFixture,
    '../platform/balancePrivacy': { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden: privacyHidden, status: 'ready' }) },
    react,
    'react-native': {
      ...native,
      BackHandler: { addEventListener: (_name: string, handler: () => boolean) => { hardwareBack = handler; return { remove() { if (hardwareBack === handler) hardwareBack = undefined; } }; } },
      StyleSheet: { create: (value: unknown) => value },
      Linking: {},
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': { setStringAsync: clipboard },
    '../ui': { ...ui, colors: {}, styles: {} },
    './IdleActivityBoundary': { IdlePressable: 'IdlePressable' },
    '../core/amounts': { formatBaseUnits },
    '../activity/activityAmountLabel': { compactActivityAmountLabel },
    './ActivityListRow': { ActivityListRow: 'ActivityListRow', activityDate: () => ({ key: 'today', label: 'Today', time: '10:00' }) },
    './TransactionDetailLayout': { TransactionDetailLayout: 'TransactionDetailLayout' },
    '../activity/assetIcon': { activityAssetIcon },
    '../../../../source/shared/erc20': { formatTokenUnits: () => '0' },
    '../activity/activityFiltering': {
      activityRowDirection, matchesActivityView, zeroOnlyActivity,
    },
  };
  const module = {
    exports: {} as { NativeActivityScreen: (props: object) => Element },
  };
  const code = ts.transpileModule(
    readFileSync(
      new NodeURL('../src/screens/NativeActivity.tsx', import.meta.url),
      'utf8'
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }
  ).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    require(name: string) { const walletUi = walletUiFixture(name, dependencies); if (walletUi) return walletUi;
      assert(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
  });
  const renderOne = (fn: (props: object) => Element, props: object) => {
    current = cells.get(fn) ?? [];
    cells.set(fn, current);
    cursor = 0;
    const result = fn(props);
    effects.splice(0).forEach((run) => run());
    return result;
  };
  return {
    privacy(value: boolean) { privacyHidden = value; },
    rows(value: unknown[]) { snapshot = { ...snapshot, rows: value }; },
    state(value: object) { snapshot = { ...snapshot, ...value }; },
    render() {
      const parent = renderOne(module.exports.NativeActivityScreen, {
        controller,
        initialHash,
        accountLabel: 'Guardian',
        onBack() { backs++; },
        onReplay() {
          replays++;
        },
        ...props,
      });
      return renderOne(parent.type, parent.props);
    },
    back: () => { assert(hardwareBack); return hardwareBack(); },
    snapshot: () => snapshot,
    loaded: () => loaded,
    inspected: () => inspected,
    replays: () => replays,
    backs: () => backs,
    closedPending: () => closedPending,
    release,
    lock() {
      snapshot = { ...snapshot, status: 'locked', scopeKey: null };
    },
    ready() {
      snapshot = {
        ...snapshot,
        status: 'ready',
        scopeKey: 'guardian:ethereum:1',
      };
    },
    dispose() {
      for (const slots of cells.values())
        for (const slot of slots) slot.cleanup?.();
    },
  };
}
function all(value: unknown): Element[] {
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const node = value as Element;
  return [node, ...node.children.flat(Infinity).flatMap(all)];
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
test('actual Activity opens the saved record once and never replays it', async () => {
  const f = fixture(hash);
  try {
    f.render();
    await settle();
    const tree = f.render();
    assert.equal(f.loaded(), 1);
    assert.deepEqual(f.inspected(), [hash]);
    assert(
      all(tree).some(
        (node) =>
          node.type === 'Header' && node.props.title === 'Transaction details'
      )
    );
    f.render();
    await settle();
    assert.equal(f.loaded(), 1);
    assert.equal(f.replays(), 0);
  } finally {
    f.dispose();
  }
});
test('ordinary Activity does not open saved pending or select a transaction', async () => {
  const f = fixture();
  try {
    const tree = f.render();
    await settle();
    assert.equal(f.loaded(), 0);
    assert.deepEqual(f.inspected(), []);
    assert(
      all(tree).some(
        (node) => node.type === 'Header' && node.props.title === 'Activity'
      )
    );
  } finally {
    f.dispose();
  }
});
test('Activity waits for a ready scope and drops a late result after unmount', async () => {
  const f = fixture(hash, true);
  f.lock();
  f.render();
  await settle();
  assert.equal(f.loaded(), 0);
  f.ready();
  f.render();
  assert.equal(f.loaded(), 1);
  f.dispose();
  f.release();
  await settle();
  assert.deepEqual(f.inspected(), []);
  assert.equal(f.replays(), 0);
});


test('privacy masks Activity list quantities and accessibility labels but keeps opened transaction details exact', async () => {
  const f = fixture();
  const row = { hash, checking: false, unavailable: false, observation: { status: 'pending', timestamp: null,
    valueUnits: '1250000000000000000', feeUnits: null, nonce: '0', latestNonce: '0',
    from: '0x' + '22'.repeat(20), to: '0x' + '33'.repeat(20), events: [] } };
  f.rows([row]);
  try {
    let list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    assert.equal(list.props.renderItem({ item: row, index: 0 }).props.amount, '-1.25 ETH');
    f.privacy(true);
    list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    const preview = list.props.renderItem({ item: row, index: 0 });
    assert.equal(preview.props.amount, '••••'); assert(!preview.props.label.includes('1.25'));
    preview.props.onPress(); await settle();
    const detail = all(f.render()).find(node => node.type === 'TransactionDetailLayout'); assert(detail);
    assert.equal(detail.props.amount, '-1.25 ETH');
  } finally { f.dispose(); }
});

for (const [standard, tokenId, quantity] of [
  ['ERC-721', '0', '1'],
  ['ERC-1155', (2n ** 256n - 1n).toString(), (2n ** 255n).toString()],
] as const) test(`explorer-only ${standard} activity preserves token ID and exact quantity in details`, async () => {
  const contract = '0x' + '55'.repeat(20);
  const indexed = mapEvmExplorerTokenTransfer({
    hash, from: '0x' + '44'.repeat(20), to: '0x' + '22'.repeat(20),
    contractAddress: contract, value: quantity, tokenID: tokenId,
    tokenType: standard, tokenSymbol: 'ART', timeStamp: '1700000000',
    confirmations: '1', blockNumber: '123', txreceipt_status: '1',
  }, 1);
  const display = await getEvmTransactionDisplayInfo(indexed, 'ETH', { chainId: 1 });
  const row = { hash, indexed, display, indexedStatus: 'confirmed', checking: false, unavailable: false };
  const f = fixture();
  try {
    f.rows([row]);
    const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    const preview = list.props.renderItem({ item: row, index: 0 });
    assert(preview.props.label.includes(`#${tokenId}`));
    await preview.props.onPress();
    let tree = all(f.render());
    const detail = tree.find(node => node.type === 'TransactionDetailLayout'); assert(detail);
    assert(detail.props.amount.includes(`#${tokenId}`));
    assert.equal(detail.props.rows.find((item: { label: string }) => item.label === 'Token ID')?.value, tokenId);
    assert.equal(detail.props.rows.find((item: { label: string }) => item.label === 'Quantity')?.value, quantity);
    tree.find(node => node.type === 'Button' && node.props.title === 'Details')!.props.onPress();
    tree = all(f.render());
    assert(tree.some(node => node.children.includes(`${quantity} ART #${tokenId}`)));
  } finally { f.dispose(); }
});

const pendingScopedRow = (reviewNavigation?: { speedUp: boolean }) => ({ hash, checking: false, unavailable: false,
  local: { walletFingerprint: 'b'.repeat(64), accountId: 'hd:60:0', address: '0x' + '22'.repeat(20),
    networkId: 'ethereum', registrationHash: '0x' + '33'.repeat(32), chainId: '1', nonce: 0,
    createdAt: 1700000000000, recipient: '0x' + '44'.repeat(20), amountUnits: '1', maximumFeeUnits: '21000',
    phase: 'submitted', transactionType: 2, inspectionOnly: true, reviewNavigation },
  observation: { status: 'pending', timestamp: null, valueUnits: '1', feeUnits: null, nonce: '0',
    from: '0x' + '22'.repeat(20), to: '0x' + '44'.repeat(20), events: [] } });

test('single-network Activity retains self transfers in Sent and Received and preserves unknown rows', () => {
  const owner = '0x' + '22'.repeat(20), other = '0x' + '44'.repeat(20);
  const row = (digit: string, from: string, to: string) => ({ hash: '0x' + digit.repeat(64),
    indexed: { from, to }, checking: false, unavailable: false });
  const self = row('1', owner, owner), sent = row('2', owner, other), received = row('3', other, owner), unknown = row('4', other, other);
  const f = fixture();
  try {
    f.rows([self, sent, received, unknown]);
    for (const [filter, expected] of [['sent', [self, sent, unknown]], ['received', [self, received, unknown]]] as const) {
      const before = all(f.render()).find(node => node.type === 'FlatList'); assert(before);
      const control = all(before.props.ListHeaderComponent).find(node => node.type === 'SegmentedControl'); assert(control);
      control.props.onChange(filter);
      const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
      assert.deepEqual(list.props.data.map((item: { hash: string }) => item.hash), expected.map(item => item.hash));
    }
  } finally { f.dispose(); }
});

async function openFixtureRow(f: ReturnType<typeof fixture>, row: unknown) {
  f.rows([row]);
  const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
  await list.props.renderItem({ item: row, index: 0 }).props.onPress();
  return f.render();
}

test('Smart Activity details show the observed outer network fee and its actual payer', async () => {
  const payer = '0x' + '55'.repeat(20), blockHash = '0x' + '66'.repeat(32);
  const observation = await observeEvmTransaction({ chainId: '1', hash, from: payer, to: '0x' + '77'.repeat(20), nonce: '0' },
    async method => method === 'eth_chainId' ? '0x1' : method === 'eth_getTransactionReceipt'
      ? { transactionHash: hash, from: payer, to: '0x' + '77'.repeat(20), status: '0x1', blockNumber: '0x2', blockHash,
          gasUsed: '0x5208', effectiveGasPrice: '0x2' }
      : { number: '0x2', hash: blockHash, gasLimit: '0x100000' }, () => undefined);
  const base = pendingScopedRow();
  const local = { ...base.local, smartAccount: { payer, operations: [{ operationHash: hash, operationNonce: '0' }] } };
  for (const scenario of [
    { retainedObservation: observation, expected: '0.000000000000042 ETH' },
    { retainedObservation: { status: 'missing', latestNonce: '0' }, expected: 'Actual fee not verified' },
    { retainedObservation: observation, observation: base.observation, expected: 'Actual fee not verified' },
    { retainedObservation: observation, unavailable: true, expected: 'Actual fee not verified' },
    { retainedObservation: observation, indexed: {}, indexedStatus: 'pending', expected: 'Actual fee not verified' },
    { retainedObservation: observation, observation: { ...base.observation, status: 'confirmed', block: { hash: blockHash, number: '2' }, feeUnits: null }, expected: 'Actual fee not verified' },
    { retainedObservation: observation, observation: { ...base.observation, status: 'confirmed', block: { hash: blockHash, number: '2' }, feeUnits: '1' }, expected: '0.000000000000000001 ETH' },
  ]) {
    const { expected, ...fields } = scenario, f = fixture();
    try {
      const tree = await openFixtureRow(f, { ...base, observation: undefined, local, ...fields });
      const detail = all(tree).find(node => node.type === 'TransactionDetailLayout'); assert(detail);
      assert.equal(detail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('send.networkFee')).value, expected);
      assert.equal(detail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('transactions.feePayer')).value, payer);
    } finally { f.dispose(); }
  }
});

test('scoped retained actions navigate to a host review without invoking direct action callbacks', async () => {
  const navigation: [string, string][] = [];
  const direct = () => { throw Error('A read-only projection cannot invoke a direct action'); };
  const f = fixture(undefined, false, { onNavigateToReview: (action: string, value: string) => navigation.push([action, value]),
    onReplay: direct, onSpeedUpPending: direct, onCancelPending: direct, onCancelSaved: direct });
  try {
    const tree = await openFixtureRow(f, pendingScopedRow({ speedUp: true }));
    for (const title of ['Speed Up', 'Cancel pending transaction', 'Review resend']) {
      const button = all(tree).find(node => node.type === 'Button' && node.props.title === title); assert(button, title);
      button.props.onPress(); await settle();
    }
    assert.deepEqual(navigation, [['speed-up', hash], ['cancel', hash], ['saved', hash]]);
  } finally { f.dispose(); }
});

for (const outcome of ['confirmed', 'reverted'] as const)
  test(`a ${outcome} saved transaction offers resend only after a new pending observation`, async () => {
    const f = fixture();
    const pending = pendingScopedRow();
    const local = { ...pending.local, inspectionOnly: false };
    const hasResend = (tree: unknown) => all(tree).some(node =>
      node.type === 'Button' && node.props.title === 'Review resend');
    try {
      const tree = await openFixtureRow(f, {
        ...pending, local, observation: { ...pending.observation, status: outcome },
      });
      assert.equal(hasResend(tree), false);
      f.rows([{ ...pending, local }]);
      assert.equal(hasResend(f.render()), true, 'a reorg can make the saved transaction pending again');
    } finally { f.dispose(); }
  });

for (const savedPending of [false, true]) {
  for (const pendingObservation of [false, true]) {
    for (const operation of ['speed-up', 'cancel'] as const) test(`${savedPending ? 'saved-pending' : 'ordinary'} Activity keeps a replaced original distinct from its confirmed ${operation} with ${pendingObservation ? 'an older pending observation' : 'unavailable own details'}`, async () => {
      const pending = pendingScopedRow({ speedUp: true });
      const winnerHash = '0x' + '77'.repeat(32);
      const original = { ...pending, replacementStatus: 'replaced',
        observation: pendingObservation ? pending.observation : undefined,
        unavailable: !pendingObservation };
      const winner = { ...pending, hash: winnerHash,
        local: { ...pending.local, hash: winnerHash, originalHash: hash, operation, phase: 'confirmed',
          ...(operation === 'cancel' ? { recipient: pending.local.address, amountUnits: '0' } : {}) },
        observation: { ...pending.observation, hash: winnerHash, status: 'confirmed',
          block: { number: '7', hash: '0x' + '88'.repeat(32) }, feeUnits: '42000',
          ...(operation === 'cancel' ? { to: pending.local.address, valueUnits: '0' } : {}) } };
      const rows = [original, winner];
      const navigations: unknown[] = [];
      const forbidden = (...args: unknown[]) => { navigations.push(args); };
      const f = fixture(undefined, false, { savedPendingOnly: savedPending,
        onNavigateToReview: forbidden, onReplay: forbidden, onSpeedUpPending: forbidden,
        onCancelPending: forbidden, onCancelSaved: forbidden });
      try {
        f.rows(rows);
        if (savedPending) {
          f.render(); await settle();
          f.state({ savedPending: { rows, status: 'ready', hasMore: false } });
        }
        const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
        const preview = list.props.renderItem({ item: original, index: 0 });
        assert(preview.props.subtitle.includes(englishI18n.t('transactions.replaced')));
        await preview.props.onPress();
        let tree = all(f.render());
        const detail = tree.find(node => node.type === 'TransactionDetailLayout'); assert(detail);
        assert.equal(detail.props.status, englishI18n.t('transactions.replaced'));
        assert.equal(detail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('send.networkFee')).value,
          englishI18n.t('mobile.activityViews.nativeActivity.actualFeeNotVerified'));
        for (const title of ['Review resend', 'Speed Up', 'Cancel pending transaction', 'Cancel saved transaction'])
          assert(!tree.some(node => node.type === 'Button' && node.props.title === title), title);
        const winnerAction = operation === 'cancel' ? 'View cancellation attempt' : 'View Speed Up attempt';
        const navigate = tree.find(node => node.type === 'Button' && node.props.title === winnerAction); assert(navigate);
        navigate.props.onPress();
        tree = all(f.render());
        const winnerDetail = tree.find(node => node.type === 'TransactionDetailLayout'); assert(winnerDetail);
        assert.equal(winnerDetail.props.status, englishI18n.t('send.confirmed'));
        assert.equal(winnerDetail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('send.networkFee')).value,
          '0.000000000000042 ETH');
        assert.deepEqual(f.inspected(), [hash, winnerHash]);
        assert.deepEqual(navigations, []);
      } finally { f.dispose(); }
    });
  }

  for (const outcome of ['confirmed', 'reverted'] as const) {
    for (const retained of [false, true]) {
      test(`${savedPending ? 'saved-pending' : 'ordinary'} Activity prefers its own ${retained ? 'retained' : 'direct'} ${outcome} receipt over replacement status`, async () => {
        const pending = pendingScopedRow({ speedUp: true });
        const block = { number: '7', hash: '0x' + '88'.repeat(32) };
        const original = { ...pending, replacementStatus: 'replaced',
          observation: retained ? undefined : { ...pending.observation, status: outcome, block, feeUnits: '21000' },
          ...(retained ? { retainedObservation: { status: 'mined', outcome, block, feeUnits: '21000' } } : {}) };
        const f = fixture(undefined, false, { savedPendingOnly: savedPending });
        try {
          f.rows([original]);
          if (savedPending) {
            f.render(); await settle();
            f.state({ savedPending: { rows: [original], status: 'ready', hasMore: false } });
          }
          const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
          const preview = list.props.renderItem({ item: original, index: 0 });
          assert(preview.props.subtitle.includes(englishI18n.t(`send.${outcome}`)));
          await preview.props.onPress();
          const tree = all(f.render());
          const detail = tree.find(node => node.type === 'TransactionDetailLayout'); assert(detail);
          assert.equal(detail.props.status, englishI18n.t(`send.${outcome}`));
          assert.equal(detail.props.tone, outcome === 'confirmed' ? 'confirmed' : 'failed');
          assert.equal(detail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('send.networkFee')).value,
            '0.000000000000021 ETH');
          assert(!tree.some(node => node.type === 'Button' && node.props.title === 'Review resend'));
        } finally { f.dispose(); }
      });
    }
  }
}

for (const host of [false, true]) test(`read-only actions stay hidden without ${host ? 'canonical navigation eligibility' : 'an explicit host navigation callback'}`, async () => {
  const forbidden = () => { throw Error('Unexpected transaction action'); };
  const f = fixture(undefined, false, { onReplay: forbidden, onSpeedUpPending: forbidden,
    onCancelPending: forbidden, onCancelSaved: forbidden, ...(host ? { onNavigateToReview: forbidden } : {}) });
  try {
    const tree = await openFixtureRow(f, pendingScopedRow(host ? undefined : { speedUp: true }));
    assert(!all(tree).some(node => node.type === 'Button' && ['Speed Up', 'Cancel pending transaction', 'Review resend'].includes(node.props.title)));
  } finally { f.dispose(); }
});

test('a network saved-pending entry never falls back to ordinary history and Back returns through the host', async () => {
  const f = fixture(undefined, false, { savedPendingOnly: true });
  try {
    f.rows([pendingScopedRow({ speedUp: true })]);
    let tree = f.render();
    assert(all(tree).some(node => node.type === 'Header' && node.props.title === 'Saved pending'));
    assert.equal(all(tree).find(node => node.type === 'FlatList')?.props.data.length, 0);
    await settle(); tree = f.render();
    assert.equal(f.loaded(), 1);
    const list = all(tree).find(node => node.type === 'FlatList'); assert(list);
    await list.props.renderItem({ item: list.props.data[0], index: 0 }).props.onPress();
    tree = f.render();
    all(tree).find(node => node.type === 'Header')!.props.onBack();
    tree = f.render();
    assert(all(tree).some(node => node.type === 'Header' && node.props.title === 'Saved pending'));
    assert.equal(f.backs(), 0);
    all(tree).find(node => node.type === 'Header')!.props.onBack();
    assert.equal(f.backs(), 1); assert.equal(f.closedPending(), 1);
  } finally { f.dispose(); }
});


test('localized transaction status preserves semantic tones and exact amounts', async () => {
  englishI18n.addResourceBundle('fr', 'translation', languageMessages('fr'), true, true);
  await englishI18n.changeLanguage('fr');
  try {
    for (const [status, tone] of [['pending', 'pending'], ['confirmed', 'confirmed'], ['reverted', 'failed']] as const) {
      const f = fixture();
      try {
        const row = { ...pendingScopedRow(), observation: { ...pendingScopedRow().observation, status } };
        const detail = all(await openFixtureRow(f, row)).find(node => node.type === 'TransactionDetailLayout');
        assert(detail);
        assert.equal(detail.props.status, englishI18n.t(`send.${status}`));
        assert.equal(detail.props.tone, tone);
        assert.equal(detail.props.amount, '-0.000000000000000001 ETH');
      } finally { f.dispose(); }
    }
  } finally { await englishI18n.changeLanguage('en'); }
});

test('scoped Smart Activity exposes replacement navigation without direct signer callbacks', async () => {
  const navigation: [string, string][] = [];
  const f = fixture(undefined, false, { onNavigateToReview: (action: string, value: string) => navigation.push([action, value]) });
  try {
    const row = pendingScopedRow({ speedUp: true });
    Object.assign(row.local, { accountId: 'smart:60:0', smartAccount: { payer: row.local.address,
      operations: [{ operationHash: '0x' + 'ab'.repeat(32), operationNonce: '0' }] } });
    const tree = await openFixtureRow(f, row);
    for (const title of ['Speed Up', 'Cancel pending transaction']) {
      const button = all(tree).find(node => node.type === 'Button' && node.props.title === title); assert(button, title);
      button.props.onPress(); await settle();
    }
    assert.deepEqual(navigation, [['speed-up', hash], ['cancel', hash]]);
  } finally { f.dispose(); }
});

for (const scenario of [
  { name: 'a historical cancellation paid by a different EOA', samePayer: false, descendant: false, sameChain: true, allowed: true },
  { name: 'a cancellation paid by the same EOA', samePayer: true, descendant: false, sameChain: true, allowed: false },
  { name: 'a cancellation of a same-payer speed-up descendant', samePayer: true, descendant: true, sameChain: true, allowed: false },
  { name: 'a cancellation on another chain', samePayer: true, descendant: false, sameChain: false, allowed: true },
]) test(`Smart replacement actions account for ${scenario.name}`, async () => {
  const payer = '0x' + 'ab'.repeat(20);
  const otherPayer = '0x' + 'cd'.repeat(20);
  const speedUpHash = '0x' + '44'.repeat(32);
  const cancelledOriginalHash = scenario.samePayer ? hash : '0x' + '55'.repeat(32);
  const row = pendingScopedRow({ speedUp: true });
  Object.assign(row.local, { accountId: 'smart:60:0', smartAccount: {
    payer, operations: [{ operationHash: '0x' + 'ab'.repeat(32), operationNonce: '0' }],
  } });
  row.observation.from = payer;
  const cancellation = {
    ...row, hash: '0x' + '66'.repeat(32),
    local: { ...row.local, hash: '0x' + '66'.repeat(32), operation: 'cancel', phase: 'confirmed',
      originalHash: scenario.descendant ? speedUpHash : cancelledOriginalHash,
      chainId: scenario.sameChain ? '1' : '2', smartAccount: {
        payer: scenario.samePayer ? payer.toUpperCase().replace('0X', '0x') : otherPayer,
        operations: [{ operationHash: '0x' + (scenario.samePayer && scenario.sameChain ? 'ab' : 'ef').repeat(32), operationNonce: '0' }], cancellation: true,
      } },
    observation: { ...row.observation, from: scenario.samePayer ? payer : otherPayer, status: 'confirmed' },
  };
  const speedUp = { ...row, hash: speedUpHash,
    local: { ...row.local, hash: speedUpHash, originalHash: hash, operation: 'speed-up' } };
  const navigation: [string, string][] = [];
  const f = fixture(undefined, false, {
    onNavigateToReview: (action: string, value: string) => navigation.push([action, value]),
  });
  try {
    await openFixtureRow(f, row);
    f.rows([row, ...(scenario.descendant ? [speedUp] : []), cancellation]);
    const tree = all(f.render());
    for (const title of ['Speed Up', 'Cancel pending transaction']) {
      const button = tree.find(node => node.type === 'Button' && node.props.title === title);
      assert.equal(!!button, scenario.allowed, title);
      if (button) { button.props.onPress(); await settle(); }
    }
    assert.deepEqual(navigation, scenario.allowed ? [['speed-up', hash], ['cancel', hash]] : []);
  } finally { f.dispose(); }
});

test('failed first Activity page has one error and an accurately named retry', () => {
  const f = fixture();
  try {
    f.state({ error: 'feed-unavailable', hasMore: true });
    let list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    assert.equal(all(list.props.ListHeaderComponent).filter(node => node.type === 'Notice').length, 1);
    assert.equal(all(list.props.ListEmptyComponent).filter(node => node.type === 'Notice').length, 0);
    assert(all(list.props.ListFooterComponent).some(node => node.type === 'Button' && node.props.title === 'Retry activity'));
    f.state({ error: null, hasMore: false });
    list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    assert.equal(all(list.props.ListFooterComponent).filter(node => node.type === 'Button').length, 0);
    assert(all(list.props.ListEmptyComponent).some(node => node.type === 'Text' && node.children.includes('No activity to show')));
    f.state({ hasMore: true });
    list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    assert(all(list.props.ListFooterComponent).some(node => node.type === 'Button' && node.props.title === 'Load older activity'));
  } finally { f.dispose(); }
});

test('an in-flight first Activity page is loading, not a completed empty history', () => {
  const f = fixture();
  try {
    f.state({ loadingMore: true, hasMore: true });
    let list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    assert(!all(list.props.ListEmptyComponent).some(node => node.type === 'Text' && node.children.includes('No activity to show')));
    assert(all(list.props.ListFooterComponent).some(node => node.type === 'Text' && node.children.includes(englishI18n.t('mobile.activityViews.nativeActivity.loadingActivity'))));
    f.rows([{ hash, checking: false, unavailable: false }]);
    list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    assert(all(list.props.ListFooterComponent).some(node => node.type === 'Text' && node.children.includes(englishI18n.t('mobile.activityViews.nativeActivity.loadingOlderActivity'))));
    f.state({ rows: [], loadingMore: false, hasMore: false });
    list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    assert(all(list.props.ListEmptyComponent).some(node => node.type === 'Text' && node.children.includes('No activity to show')));
  } finally { f.dispose(); }
});


function openOptions(f: ReturnType<typeof fixture>) {
  const header = all(f.render()).find(node => node.type === 'Header' && node.props.title === 'Activity'); assert(header);
  const options = all(header.props.right).find(node => node.type === 'IconButton' && node.props.label === 'Activity options'); assert(options);
  options.props.onPress();
}
function dialog(f: ReturnType<typeof fixture>, label: string) {
  const tree = f.render(), nodes = all(tree);
  assert.equal(nodes.some(node => node.type === 'Modal'), false, 'Activity overlays must stay in the existing window');
  const underlay = nodes.find(node => node.props.testID === 'activity-underlay'); assert(underlay);
  assert.equal(underlay.props.pointerEvents, 'none');
  assert.equal(underlay.props.accessibilityElementsHidden, true);
  assert.equal(underlay.props['aria-hidden'], true);
  assert.equal(underlay.props.importantForAccessibility, 'no-hide-descendants');
  const overlay = nodes.find(node => node.props.role === 'dialog' && node.props.accessibilityLabel === label); assert(overlay);
  assert.equal(overlay.props.accessibilityViewIsModal, true);
  return overlay;
}
function openRecipientCopy(f: ReturnType<typeof fixture>) {
  const detail = all(f.render()).find(node => node.type === 'TransactionDetailLayout'); assert(detail);
  const recipient = detail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('send.to')); assert(recipient?.onPress);
  recipient.onPress();
}
for (const close of ['done', 'back'] as const) test(`in-window Activity options ${close} preserves the list, filter and saved position`, () => {
  const immersive: boolean[] = [];
  const f = fixture(undefined, false, { navigation: { registerBack: () => () => {}, registerLeave: () => () => {}, beginNavigation() {}, setImmersive: (value: boolean) => immersive.push(value) } });
  const row = pendingScopedRow(); f.rows([row]);
  f.state({ view: { ...DEFAULT_ACTIVITY_VIEW, filter: 'sent', anchor: hash, offset: 27 } });
  try {
    openOptions(f); const overlay = dialog(f, 'Activity options');
    assert.equal(immersive.at(-1), true, 'tabs must not remain interactive below options');
    if (close === 'back') assert.equal(f.back(), true);
    else all(overlay).find(node => node.type === 'Button' && node.props.title === 'Done')!.props.onPress();
    const nodes = all(f.render());
    assert.equal(nodes.some(node => node.props.role === 'dialog'), false);
    assert.equal(nodes.find(node => node.props.testID === 'activity-underlay')?.props.pointerEvents, 'auto');
    assert.equal(immersive.at(-1), false);
    assert.equal(f.backs(), 0); assert.equal(f.loaded(), 0); assert.equal(f.inspected().length, 0);
    assert.deepEqual(f.snapshot().view, { ...DEFAULT_ACTIVITY_VIEW, filter: 'sent', anchor: hash, offset: 27 });
    assert.deepEqual(nodes.find(node => node.type === 'FlatList')?.props.data, [row]);
  } finally { f.dispose(); }
});
test('in-window Activity option toggle changes only its filter preference', () => {
  const f = fixture(); f.state({ view: { ...DEFAULT_ACTIVITY_VIEW, anchor: hash, offset: 31 } });
  try {
    openOptions(f); const overlay = dialog(f, 'Activity options');
    all(overlay).find(node => node.type === 'Button' && node.props.title === 'Show zero-value token activity')!.props.onPress();
    assert.equal(all(f.render()).some(node => node.props.role === 'dialog'), false);
    assert.deepEqual(f.snapshot().view, { ...DEFAULT_ACTIVITY_VIEW, anchor: hash, offset: 31, showZero: true });
    assert.equal(f.backs(), 0);
  } finally { f.dispose(); }
});
for (const close of ['cancel', 'back'] as const) test(`in-window Activity copy ${close} returns to the selected transaction`, async () => {
  const f = fixture();
  try {
    await openFixtureRow(f, pendingScopedRow()); openRecipientCopy(f); const overlay = dialog(f, 'Copy this address?');
    if (close === 'back') assert.equal(f.back(), true);
    else all(overlay).find(node => node.type === 'Button' && node.props.title === 'Cancel')!.props.onPress();
    const nodes = all(f.render());
    assert.equal(nodes.some(node => node.props.role === 'dialog'), false);
    assert(nodes.some(node => node.type === 'TransactionDetailLayout'));
    assert.equal(f.backs(), 0);
  } finally { f.dispose(); }
});
test('in-window Activity copy holds Back during clipboard work and returns to the same detail after success', async () => {
  const copied: string[] = []; let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(undefined, false, {}, async address => { copied.push(address); await waiting; return true; });
  try {
    await openFixtureRow(f, pendingScopedRow()); openRecipientCopy(f); const overlay = dialog(f, 'Copy this address?');
    const copying = all(overlay).find(node => node.type === 'Button' && node.props.title === 'Copy full address')!.props.onPress();
    dialog(f, 'Copy this address?'); // Commit the busy UI before the next native Back event.
    assert.equal(f.back(), true);
    const pending = dialog(f, 'Copy this address?');
    assert(all(pending).filter(node => node.type === 'Button').every(node => node.props.disabled));
    release(); await copying;
    const nodes = all(f.render());
    assert.equal(nodes.some(node => node.props.role === 'dialog'), false);
    assert(nodes.some(node => node.type === 'TransactionDetailLayout'));
    assert.equal(copied.length, 1); assert.equal(f.backs(), 0); assert.equal(f.replays(), 0);
  } finally { release(); f.dispose(); }
});

function localizedController(mode: 'ready' | 'initial' | 'partial' | 'older' | 'position' | 'no-explorer') {
  const owner = '0x' + '22'.repeat(20);
  const scope = createActivityScope('a'.repeat(64), 'hd:60:0', owner, mode === 'no-explorer' ? 'base' : 'ethereum');
  let failing = true, cacheCalls = 0, pageCalls = 0;
  const candidate = (index: number) => {
    const rowHash = '0x' + index.toString(16).padStart(64, '0');
    return { hash: rowHash, blockNumber: String(1000 - index), timestamp: 1700000000000 - index * 1000, tokenHint: false,
      indexed: mapEvmExplorerTransaction({ hash: rowHash, from: owner, to: '0x' + '33'.repeat(20), value: '1',
        blockNumber: String(1000 - index), timeStamp: String(1700000000 - index), nonce: String(index), isError: '0', input: '0x' }, 1) };
  };
  const runtime: NativeActivityRuntime = {
    async load(check) {
      check();
      if (mode === 'initial' && failing) throw Error('fixture load unavailable');
      return { scope, saved: { archived: [], candidates: [], view: DEFAULT_ACTIVITY_VIEW, truncated: false }, locals: [] };
    },
    async saveCache(_scope, _rows, check) {
      check();
      if (++cacheCalls > 1 && mode === 'older' && failing) throw Error('fixture cache unavailable');
    },
    async saveView(_scope, _view, check) {
      check();
      if (mode === 'position' && failing) throw Error('fixture position unavailable');
    },
  };
  const controller = new NativeActivity({ getSnapshot: () => ({ phase: 'ready', revision: 1 }), subscribe: () => () => {} }, () => runtime, {
    async page(_scope, feed, page, _signal, check) {
      check(); pageCalls++;
      if (mode === 'partial') {
        if (feed === 'txlist' && failing) throw Error('fixture feed unavailable');
        return feed === 'tokentx' ? [candidate(1)] : [];
      }
      return feed === 'txlist' && page <= 2 ? Array.from({ length: 20 }, (_, index) => candidate((page - 1) * 20 + index + 1)) : [];
    },
  }, { async read() { throw Error('Localization must not start detail reads'); } });
  return { controller, recover() { failing = false; }, pages: () => pageCalls };
}

for (const language of ['fr', 'ja']) test(`production Activity controller messages render in ${language} without changing history or retry`, async (t) => {
  const messages = languageMessages(language).mobile.activityViews.nativeActivity;
  const english = languageMessages('en').mobile.activityViews.nativeActivity;
  englishI18n.addResourceBundle(language, 'translation', languageMessages(language), true, true);
  await englishI18n.changeLanguage(language);
  const prefix = 'mobile.activityViews.nativeActivity.';
  const list = (f: ReturnType<typeof fixture>) => {
    const result = all(f.render()).find(node => node.type === 'FlatList'); assert(result); return result;
  };
  const error = (f: ReturnType<typeof fixture>, key: string) => {
    const notices = all(list(f).props.ListHeaderComponent).filter(node => node.type === 'Notice');
    assert.equal(notices.length, 1);
    assert.equal(notices[0]!.props.title, messages.someActivityIsUnavailable);
    assert.equal(notices[0]!.props.body, messages[key]);
    assert.notEqual(notices[0]!.props.body, english[key]);
    assert.equal(all(list(f).props.ListEmptyComponent).filter(node => node.type === 'Notice').length, 0);
  };
  try {
    for (const mode of ['ready', 'initial', 'partial', 'older', 'position', 'no-explorer'] as const) await t.test(mode, async () => {
      const c = localizedController(mode); await c.controller.refresh();
      const f = fixture(undefined, false, { controller: c.controller, externallyConnected: true });
      try {
        const hashes = c.controller.getSnapshot().rows.map(row => row.hash);
        if (mode === 'ready' || mode === 'no-explorer') {
          const key = mode === 'ready' ? 'explorerCoverage' : 'discoveryUnavailable';
          const header = all(f.render()).find(node => node.type === 'Header'); assert(header);
          const button = all(header.props.right).find(node => node.props.label === englishI18n.t(prefix + 'activityOptions')); assert(button);
          button.props.onPress();
          assert(all(f.render()).some(node => node.type === 'Text' && node.children.includes(messages[key])));
          assert.notEqual(messages[key], english[key]);
          assert.equal(c.controller.getSnapshot().error, null);
          if (mode === 'no-explorer') assert.equal(c.pages(), 0);
        } else if (mode === 'initial') {
          assert.equal(c.controller.getSnapshot().error, 'load-incomplete'); error(f, 'loadIncomplete');
          const header = all(f.render()).find(node => node.type === 'Header'); assert(header);
          const refresh = all(header.props.right).find(node => node.props.label === englishI18n.t(prefix + 'refreshActivity')); assert(refresh);
          c.recover(); refresh.props.onPress(); await settle();
          assert.equal(c.controller.getSnapshot().error, null); assert.equal(c.controller.getSnapshot().rows.length, 20);
        } else if (mode === 'position') {
          await c.controller.setView({ offset: 20 }); error(f, 'positionNotSaved');
          assert.deepEqual(c.controller.getSnapshot().rows.map(row => row.hash), hashes);
        } else {
          if (mode === 'older') {
            assert.equal(hashes.length, 20);
            const more = all(list(f).props.ListFooterComponent).find(node => node.type === 'Button'); assert(more);
            assert.equal(more.props.title, messages.loadOlderActivity); await more.props.onPress();
          } else assert.equal(hashes.length, 1);
          assert.equal(c.controller.getSnapshot().error, mode === 'older' ? 'older-unavailable' : 'feed-unavailable');
          error(f, mode === 'older' ? 'olderUnavailable' : 'feedUnavailable');
          assert(hashes.every(value => c.controller.getSnapshot().rows.some(row => row.hash === value)));
          const retry = all(list(f).props.ListFooterComponent).find(node => node.type === 'Button'); assert(retry);
          assert.equal(retry.props.title, englishI18n.t('mobile.activityViews.allNetworksActivity.retryActivity'));
          c.recover(); await retry.props.onPress();
          assert.equal(c.controller.getSnapshot().error, null);
          assert(hashes.every(value => c.controller.getSnapshot().rows.some(row => row.hash === value)));
        }
      } finally { f.dispose(); c.controller.invalidate(); }
    });
  } finally { await englishI18n.changeLanguage('en'); }
});
