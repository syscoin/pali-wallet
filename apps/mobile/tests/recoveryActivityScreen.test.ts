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

type Element = { type: any; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; dependencies?: unknown[]; cleanup?: () => void };
const hash = '0x' + '11'.repeat(32);
function fixture(initialHash?: string, held = false, props: Record<string, unknown> = {}) {
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
    async setView() {},
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
    '../platform/balancePrivacy': { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden: privacyHidden, status: 'ready' }) },
    react,
    'react-native': {
      ...native,
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      StyleSheet: { create: (value: unknown) => value },
      Linking: {},
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': {},
    '../ui': { ...ui, colors: {}, styles: {} },
    './IdleActivityBoundary': { IdlePressable: 'IdlePressable' },
    '../core/amounts': { formatBaseUnits },
    '../activity/activityAmountLabel': { compactActivityAmountLabel },
    './ActivityListRow': { ActivityListRow: 'ActivityListRow', activityDate: () => ({ key: 'today', label: 'Today', time: '10:00' }) },
    './TransactionDetailLayout': { TransactionDetailLayout: 'TransactionDetailLayout' },
    '../activity/assetIcon': { activityAssetIcon },
    '../../../../source/shared/erc20': { formatTokenUnits: () => '0' },
    '../../../../source/shared/evmHistory': {
      getEvmHistoryDirection: () => 'unknown',
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
    assert.equal(list.props.renderItem({ item: row, index: 0 }).props.amount, '1.25 ETH');
    f.privacy(true);
    list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    const preview = list.props.renderItem({ item: row, index: 0 });
    assert.equal(preview.props.amount, '••••'); assert(!preview.props.label.includes('1.25'));
    preview.props.onPress(); await settle();
    const detail = all(f.render()).find(node => node.type === 'TransactionDetailLayout'); assert(detail);
    assert.equal(detail.props.amount, '1.25 ETH');
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
