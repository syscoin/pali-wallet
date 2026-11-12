import { englishI18n, languageMessages, nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { DEFAULT_ACTIVITY_VIEW } from '../src/activity/types.ts';
import { activityAssetIcon } from '../src/activity/assetIcon.ts';
import { getEvmTransactionDisplayInfo } from '../../../source/shared/evmTransactionDisplay.ts';
import { mapEvmExplorerTokenTransfer } from '../../../source/shared/evmHistory.ts';
import { activityRowDirection, matchesActivityView, zeroOnlyActivity } from '../src/activity/activityFiltering.ts';

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
    coverage: '',
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
    require(name: string) {
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
      operationHash: '0x' + 'ab'.repeat(32), operationNonce: '0' } });
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
    payer, operationHash: '0x' + 'ab'.repeat(32), operationNonce: '0',
  } });
  row.observation.from = payer;
  const cancellation = {
    ...row, hash: '0x' + '66'.repeat(32),
    local: { ...row.local, hash: '0x' + '66'.repeat(32), operation: 'cancel', phase: 'confirmed',
      originalHash: scenario.descendant ? speedUpHash : cancelledOriginalHash,
      chainId: scenario.sameChain ? '1' : '2', smartAccount: {
        payer: scenario.samePayer ? payer.toUpperCase().replace('0X', '0x') : otherPayer,
        operationHash: '0x' + (scenario.samePayer && scenario.sameChain ? 'ab' : 'ef').repeat(32),
        operationNonce: '0', cancellation: true,
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
    f.state({ error: 'One activity feed is unavailable.', hasMore: true });
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
  const f = fixture(undefined, false, { navigation: { registerBack: () => () => {}, registerLeave: () => () => {}, setImmersive: (value: boolean) => immersive.push(value) } });
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
