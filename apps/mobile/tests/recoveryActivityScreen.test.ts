import { walletUiFixture } from './walletUiFixture.ts';
import { englishI18n, languageMessages, nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { AbiCoder, id } from 'ethers';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { createActivityScope, DEFAULT_ACTIVITY_VIEW } from '../src/activity/types.ts';
import { activityRowTimestamp, NativeActivity, type NativeActivityRuntime } from '../src/activity/nativeActivity.ts';
import { ActivityExplorerReader } from '../src/activity/explorerReader.ts';
import { activityAssetIcon } from '../src/activity/assetIcon.ts';
import { getEvmTransactionDisplayInfo, type EvmDisplayTokenMetadata } from '../../../source/shared/evmTransactionDisplay.ts';
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
  };
  let loaded = 0,
    replays = 0,
    backs = 0,
    release!: () => void;
  const inspected: string[] = [];
  const inspectedOperations: string[] = [];
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    connect: () => () => {},
    async loadTarget() {
      loaded++;
      if (held) await gate;
      snapshot = {
        ...snapshot,
        rows: [{ hash, checking: false, unavailable: false }],
      };
    },
    inspect(value: string) {
      inspected.push(value);
    },
    async inspectSmartAuthorization(operationHash: string, guard: () => void) {
      guard();
      inspectedOperations.push(operationHash);
    },
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
      AppState: { currentState: 'active' },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': { setStringAsync: clipboard },
    '../ui': { ...ui, colors: {}, styles: {} },
    './IdleActivityBoundary': { IdlePressable: 'IdlePressable' },
    '../core/amounts': { formatBaseUnits },
    '../activity/activityAmountLabel': { compactActivityAmountLabel },
    './ActivityListRow': { ActivityListRow: 'ActivityListRow', activityDate: () => ({ key: 'today', label: 'Today', time: '10:00' }) },
    './TransactionDetailLayout': { TransactionDetailLayout: 'TransactionDetailLayout' },
    '../activity/nativeActivity': { activityRowTimestamp },
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
    AbortController,
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
    inspectedOperations: () => inspectedOperations,
    replays: () => replays,
    backs: () => backs,
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
async function indexedHistory(body: Record<string, unknown> | null, event?: Record<string, unknown>, assets: readonly EvmDisplayTokenMetadata[] = []) {
  const scope = createActivityScope('a'.repeat(64), 'hd:60:0', '0x' + '22'.repeat(20), 'ethereum');
  const requests: string[] = [];
  const explorer = new ActivityExplorerReader(async (url, init) => {
    assert.equal(init.body, undefined, 'list history never starts RPC'); requests.push(url);
    return Response.json({ status: '1', message: 'OK', result: new URL(url).searchParams.get('action') === 'tokentx' ? event ? [event] : [] : body ? [body] : [] });
  });
  const runtime: NativeActivityRuntime = {
    async load(check) { check(); return { scope, locals: [], assets, saved: { archived: [], candidates: [], view: DEFAULT_ACTIVITY_VIEW, truncated: false } }; },
    async saveCache(_scope, _rows, check) { check(); }, async saveView(_scope, _view, check) { check(); },
  };
  const controller = new NativeActivity({ getSnapshot: () => ({ phase: 'ready', revision: 1 }), subscribe: () => () => {} }, () => runtime,
    explorer, { async read() { throw Error('No detail RPC expected'); } });
  await controller.refresh();
  return { controller, requests };
}

test('saved scoped metadata supplies the shared ERC20 amount while another chain remains unknown', async () => {
  const owner = '0x' + '22'.repeat(20), recipient = '0x' + '33'.repeat(20), contract = '0x' + '44'.repeat(20);
  const body = { hash, from: owner, to: contract, value: '0', blockNumber: '123', timeStamp: '1700000000', nonce: '0', isError: '0',
    input: id('transfer(address,uint256)').slice(0, 10) + AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [recipient, '2000000']).slice(2) };
  const event = { ...body, to: recipient, contractAddress: contract, value: '2000000', tokenSymbol: 'USDC', tokenDecimal: '6' };
  for (const scenario of [{ chainId: 1, eventOnly: false }, { chainId: 137, eventOnly: false }, { chainId: 137, eventOnly: true }]) {
    const { controller, requests } = await indexedHistory(scenario.eventOnly ? null : body, event,
      [{ chainId: scenario.chainId, contractAddress: contract, decimals: 6, symbol: 'USDC' }]);
    const f = fixture(undefined, false, { controller, externallyConnected: true });
    try {
      const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
      const row = controller.getSnapshot().rows[0]!;
      const preview = list.props.renderItem({ item: row, index: 0 });
      if (scenario.chainId === 1 || scenario.eventOnly) {
        assert.equal(preview.props.amount, '-2 USDC'); assert.equal(preview.props.title, 'Sent');
        assert.match(preview.props.label, /2(?:\.0+)? USDC/);
      } else { assert.equal(preview.props.amount, ''); assert.equal(row.display?.hasUnknownDecimals, true); }
      assert.equal(requests.length, 2);
    } finally { f.dispose(); }
  }
});

test('native-to-token swaps retain the displayed ETH debit and Received filtering preserves genuine self transfers', async () => {
  const owner = '0x' + '22'.repeat(20), router = '0x' + '33'.repeat(20), pool = '0x' + '44'.repeat(20), contract = '0x' + '55'.repeat(20);
  for (const kind of ['swap', 'ordinary', 'self'] as const) {
    const body = { hash, from: owner, to: kind === 'self' ? owner : router, value: '1000000000000000000',
      blockNumber: '123', timeStamp: '1700000000', nonce: '0', isError: '0',
      input: kind === 'swap' ? id('swapExactETHForTokens(uint256,address[],address,uint256)').slice(0, 10) +
        AbiCoder.defaultAbiCoder().encode(['uint256', 'address[]', 'address', 'uint256'], ['0', [router, contract], owner, '2000000000']).slice(2) : '0x' };
    const event = { ...body, from: pool, to: owner, contractAddress: contract, value: '2000000', tokenSymbol: 'USDC', tokenDecimal: '6' };
    const { controller, requests } = await indexedHistory(body, kind === 'swap' ? event : undefined);
    const f = fixture(undefined, false, { controller, externallyConnected: true });
    try {
      let list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
      const preview = list.props.renderItem({ item: controller.getSnapshot().rows[0], index: 0 });
      assert.equal(preview.props.title, kind === 'self' ? 'Self transfer' : 'Sent');
      assert.equal(preview.props.amount, kind === 'self' ? '1 ETH' : '-1 ETH');
      await controller.setView({ filter: 'received' });
      list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
      assert.equal(list.props.data.length, kind === 'self' ? 1 : 0);
      assert.equal(requests.length, 2);
    } finally { f.dispose(); }
  }
});
test('an already loaded indexed transaction opens without waiting for saved inventory', async () => {
  const owner = '0x' + '22'.repeat(20);
  const scope = createActivityScope('a'.repeat(64), 'hd:60:0', owner, 'ethereum');
  const indexed = mapEvmExplorerTransaction({ hash, from: owner, to: '0x' + '33'.repeat(20), value: '1',
    blockNumber: '123', timeStamp: '1700000000', nonce: '0', isError: '0', input: '0x' }, 1);
  let savedReads = 0, detailReads = 0;
  const held = new Promise<never>(() => {});
  const runtime: NativeActivityRuntime = {
    async load(check) { check(); return { scope, locals: [], saved: { archived: [], candidates: [], view: DEFAULT_ACTIVITY_VIEW, truncated: false } }; },
    async loadTarget() { savedReads++; return held; },
    async saveCache(_scope, _rows, check) { check(); },
    async saveView(_scope, _view, check) { check(); },
  };
  const controller = new NativeActivity({ getSnapshot: () => ({ phase: 'ready', revision: 1 }), subscribe: () => () => {} }, () => runtime,
    { async page(_scope, feed) { return feed === 'txlist' ? [{ hash, blockNumber: '123', timestamp: 1700000000000, tokenHint: false, indexed }] : []; } },
    { async read() { detailReads++; return null; } });
  await controller.refresh();
  const f = fixture(hash, true, { controller, detailOnly: true, externallyConnected: true });
  try {
    f.render();
    await settle();
    const tree = f.render();
    assert.equal(savedReads, 0);
    assert.equal(detailReads, 1);
    assert(all(tree).some(node => node.type === 'TransactionDetailLayout'));
  } finally { f.dispose(); }
});

test('a pending Activity arrival cannot replace manually opened details', async () => {
  const recent = { hash: '0x' + 'bb'.repeat(32), checking: false, unavailable: false };
  let acknowledged = 0;
  const f = fixture(hash, true, { onInitialTargetOpened: () => { acknowledged++; } });
  try {
    f.rows([recent]);
    const list = all(f.render()).find(node => node.type === 'FlatList')!;
    assert.equal(f.loaded(), 1);
    list.props.renderItem({ item: recent, index: 0 }).props.onPress();
    await settle();
    assert.equal(acknowledged, 1);
    f.release();
    await settle();
    assert.deepEqual(f.inspected(), [recent.hash]);
  } finally { f.dispose(); }
});

test('a watch notification opens when its transaction arrives on the first explorer page', async () => {
  const owner = '0x' + '22'.repeat(20);
  const scope = createActivityScope('a'.repeat(64), 'hd:60:0', owner, 'ethereum');
  const indexed = mapEvmExplorerTransaction({ hash, from: '0x' + '33'.repeat(20), to: owner, value: '1',
    blockNumber: '123', timeStamp: '1700000000', nonce: '0', isError: '0', input: '0x' }, 1);
  const entered = Promise.withResolvers<void>(), page = Promise.withResolvers<void>();
  const runtime: NativeActivityRuntime = {
    async load() { return { scope, locals: [], saved: { archived: [], candidates: [], view: DEFAULT_ACTIVITY_VIEW, truncated: false } }; },
    async saveCache() {}, async saveView() {},
  };
  let opened = 0, detailReads = 0;
  const controller = new NativeActivity({ getSnapshot: () => ({ phase: 'ready', revision: 1 }), subscribe: () => () => {} }, () => runtime,
    { async page(_scope, feed) {
      entered.resolve(); await page.promise;
      return feed === 'txlist' ? [{ hash, blockNumber: '123', timestamp: 1700000000000, tokenHint: false, indexed }] : [];
    } }, { async read() { detailReads++; return null; } });
  const f = fixture(hash, false, { controller, externallyConnected: true, onInitialTargetOpened: () => { opened++; } });
  try {
    const refresh = controller.refresh(); await entered.promise;
    f.render(); await settle(); assert.equal(opened, 0);
    page.resolve(); await refresh;
    f.render(); await settle();
    assert(all(f.render()).some(node => node.type === 'TransactionDetailLayout'));
    assert.equal(opened, 1); assert.equal(detailReads, 1);
  } finally { page.resolve(); f.dispose(); }
});

test('actual Activity opens the saved record once and never replays it', async () => {
  let opened = 0;
  const f = fixture(hash, false, { onInitialTargetOpened: () => { opened++; } });
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
    assert.equal(opened, 1);
  } finally {
    f.dispose();
  }
});
test('two visits to the same unresolved hash share its read and acknowledge the current visit', async () => {
  const opened: string[] = [];
  const props = { onInitialTargetOpened: () => { opened.push('first'); } };
  const f = fixture(hash, true, props);
  try {
    f.render();
    props.onInitialTargetOpened = () => { opened.push('second'); };
    f.render();
    assert.equal(f.loaded(), 1);
    f.release(); await settle();
    assert.deepEqual(opened, ['second']);
    assert.deepEqual(f.inspected(), [hash]);
  } finally { f.dispose(); }
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

test('common Activity accessibility labels retain localized direction with visible and hidden amounts', () => {
  const owner = '0x' + '22'.repeat(20), other = '0x' + '33'.repeat(20);
  for (const [from, to, movement] of [[owner, other, 'Sent'], [other, owner, 'Received'], [owner, owner, 'Self transfer'], [other, other, 'Activity']]) {
    const row = { hash, checking: false, unavailable: false, observation: { from, to, status: 'confirmed', timestamp: 1700000000000,
      valueUnits: '1000000000000000000', feeUnits: '21000', nonce: '0', block: { hash, number: '1' }, events: [] } };
    const f = fixture();
    try {
      f.rows([row]);
      for (const hidden of [false, true]) {
        f.privacy(hidden);
        const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
        const preview = list.props.renderItem({ item: row, index: 0 });
        assert.equal(preview.props.title, movement);
        assert(preview.props.label.startsWith(`${movement}. `));
        assert.equal(preview.props.label.includes('ETH'), !hidden);
        assert.equal(preview.props.label.includes('Amount hidden'), hidden);
      }
    } finally { f.dispose(); }
  }
});

test('decoded ERC1155 batches retain total units and per-token quantities in Activity with privacy controls', async () => {
  const owner = '0x' + '22'.repeat(20), recipient = '0x' + '33'.repeat(20), contract = '0x' + '55'.repeat(20);
  const input = id('safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)').slice(0, 10) +
    AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint256[]', 'uint256[]', 'bytes'],
      [owner, recipient, ['7', '8'], ['2', '5'], '0x']).slice(2);
  const indexed = mapEvmExplorerTransaction({ hash, from: owner, to: contract, value: '0', input,
    blockNumber: '123', timeStamp: '1700000000', nonce: '0', isError: '0' }, 1);
  const display = await getEvmTransactionDisplayInfo(indexed, 'ETH', {
    chainId: 1, assets: [{ chainId: 1, contractAddress: contract, isNft: true, tokenSymbol: 'ITEM' }],
    lookupToken: async () => { throw Error('Batch summary must not initiate metadata reads'); },
  });
  const row = { hash, indexed, display, indexedStatus: 'confirmed', checking: false, unavailable: false };
  const f = fixture();
  try {
    f.rows([row]);
    const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
    const preview = list.props.renderItem({ item: row, index: 0 });
    assert.equal(preview.props.amount, '-7 ITEM');
    assert(!preview.props.label.includes('0 ETH'));
    preview.props.onPress(); await settle();
    let detail = all(f.render()).find(node => node.type === 'TransactionDetailLayout'); assert(detail);
    assert.equal(detail.props.amount, '-7 ITEM');
    assert.deepEqual(display.nftTransfers, [{ tokenId: '7', quantity: '2' }, { tokenId: '8', quantity: '5' }]);
    for (const [tokenId, quantity] of [['7', '2'], ['8', '5']])
      assert.equal(detail.props.rows.find((item: { label: string }) => item.label === `ITEM #${tokenId}`)?.value, quantity);
    f.privacy(true);
    detail = all(f.render()).find(node => node.type === 'TransactionDetailLayout'); assert(detail);
    for (const tokenId of ['7', '8'])
      assert.equal(detail.props.rows.find((item: { label: string }) => item.label === `ITEM #${tokenId}`)?.value, '••••');
    const hiddenList = all(f.render()).find(node => node.type === 'FlatList'); assert(hiddenList);
    assert.equal(hiddenList.props.renderItem({ item: row, index: 0 }).props.amount, '••••');
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

test('ordinary Activity labels failed current reads unavailable while preserving known outcomes', async () => {
  const base = pendingScopedRow();
  const block = { number: '42', hash: '0x' + '99'.repeat(32) };
  const cases = [
    { fields: { unavailable: true, observation: undefined }, status: 'Current status unavailable' },
    { fields: { unavailable: true, observation: undefined, retainedObservation: { status: 'missing', latestNonce: '0' } }, status: 'Current status unavailable' },
    { fields: { observation: { ...base.observation, status: 'confirmed', block } }, status: 'Confirmed' },
    { fields: { observation: { ...base.observation, status: 'reverted', block } }, status: 'Reverted' },
    { fields: { unavailable: true, observation: undefined, indexed: {}, indexedStatus: 'confirmed' }, status: 'Confirmed' },
    { fields: { unavailable: true, observation: undefined, indexed: {}, indexedStatus: 'failed' }, status: 'Reverted' },
    { fields: { unavailable: true, observation: undefined, retainedObservation: { status: 'mined', outcome: 'confirmed', block } }, status: 'Confirmed' },
    { fields: { unavailable: true, observation: undefined, local: { ...base.local, phase: 'confirmed' } }, status: 'Previously confirmed by Pali' },
    { fields: { observation: undefined, retainedObservation: { status: 'missing', latestNonce: '0' } }, status: 'Submission unconfirmed' },
  ];
  for (const { fields, status } of cases) {
    const f = fixture();
    try {
      const row = { ...base, ...fields };
      f.rows([row]);
      const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
      const item = list.props.renderItem({ item: row, index: 0 });
      assert(item.props.subtitle.includes(status), status);
      const tree = await openFixtureRow(f, row);
      const detail = all(tree).find(node => node.type === 'TransactionDetailLayout'); assert(detail);
      assert.equal(detail.props.status, status);
      if (status === 'Current status unavailable') {
        assert(!item.props.subtitle.includes('Submission unconfirmed'));
        assert(!item.props.subtitle.includes('Details unavailable'), 'avoid a duplicate unavailable message');
      } else if (row.unavailable) {
        assert(item.props.subtitle.includes('Details unavailable'), 'preserve detail failures alongside known outcomes');
      }
    } finally { f.dispose(); }
  }
});

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
    { retainedObservation: observation, indexed: {}, indexedStatus: 'pending', expected: '0.000000000000042 ETH' },
    { retainedObservation: observation, observation: { ...base.observation, status: 'confirmed', block: { hash: blockHash, number: '2' }, feeUnits: null }, expected: 'Actual fee not verified' },
    { retainedObservation: observation, observation: { ...base.observation, status: 'confirmed', block: { hash: blockHash, number: '2' }, feeUnits: '1' }, expected: '0.000000000000000001 ETH' },
    { observation: { ...base.observation, status: 'unknown', block: { hash: blockHash, number: '3000000' }, feeUnits: '21000000000000' }, expected: '0.000021 ETH' },
    { observation: { ...base.observation, status: 'unknown', block: null, feeUnits: '21000000000000' }, expected: 'Actual fee not verified' },
  ]) {
    const { expected, ...fields } = scenario, f = fixture();
    try {
      const tree = await openFixtureRow(f, { ...base, observation: undefined, local, ...fields });
      const detail = all(tree).find(node => node.type === 'TransactionDetailLayout'); assert(detail);
      assert.equal(detail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('send.networkFee')).value, expected, JSON.stringify(fields));
      assert.equal(detail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('transactions.feePayer')).value, payer);
    } finally { f.dispose(); }
  }
});

test('unsigned native Activity offers only a fresh Speed Up review for a missing unconsumed transaction', async () => {
  for (const scoped of [false, true]) {
    const calls: unknown[] = [];
    const f = fixture(undefined, false, {
      onSpeedUpPending: (id: string) => calls.push(id),
      ...(scoped ? { onNavigateToReview: (action: string, id: string) => calls.push([action, id]) } : {}),
    });
    const base = pendingScopedRow({ speedUp: true });
    const row = { ...base, local: { ...base.local, unsignedSpeedUp: true, cancellationUnavailable: true }, observation: undefined };
    try {
      let tree = await openFixtureRow(f, { ...row, retainedObservation: { status: 'missing', latestNonce: '0' } });
      const findAction = (title: string) => all(tree).find(node => node.type === 'Button' && node.props.title === title);
      const speed = findAction('Speed Up'); assert(speed);
      assert.equal(findAction('Review resend'), undefined);
      assert.equal(findAction('Cancel pending transaction'), undefined);
      speed.props.onPress(); await settle();
      assert.deepEqual(calls, [scoped ? ['speed-up', hash] : hash]);
      f.rows([{ ...row, retainedObservation: { status: 'missing', latestNonce: '1' } }]);
      tree = f.render();
      assert.equal(findAction('Speed Up'), undefined);
    } finally { f.dispose(); }
  }
});

test('scoped Smart Activity offers Speed Up only while its missing payer nonce remains available', async () => {
  const navigation: [string, string][] = [];
  const f = fixture(undefined, false, { onNavigateToReview: (action: string, id: string) => navigation.push([action, id]) });
  const base = pendingScopedRow({ speedUp: true });
  const row = { ...base, observation: undefined, local: { ...base.local, retainedSmartSpeedUp: true,
    smartAccount: { payer: '0x' + '55'.repeat(20), operations: [{ operationHash: hash, operationNonce: '0' }] } } };
  const findSpeedUp = (tree: unknown) => all(tree).find(node => node.type === 'Button' && node.props.title === 'Speed Up');
  try {
    const tree = await openFixtureRow(f, { ...row, retainedObservation: { status: 'missing', latestNonce: '0' } });
    const speed = findSpeedUp(tree); assert(speed);
    speed.props.onPress(); await settle();
    assert.deepEqual(navigation, [['speed-up', hash]]);
    f.rows([{ ...row, retainedObservation: { status: 'missing', latestNonce: '1' } }]);
    assert.equal(findSpeedUp(f.render()), undefined);
  } finally { f.dispose(); }
});

test('scoped retained actions navigate to a host review without invoking direct action callbacks', async () => {
  const navigation: [string, string][] = [];
  const direct = () => { throw Error('A read-only projection cannot invoke a direct action'); };
  const f = fixture(undefined, false, { onNavigateToReview: (action: string, value: string) => navigation.push([action, value]),
    onReplay: direct, onSpeedUpPending: direct, onCancelPending: direct, onCancelSaved: direct });
  try {
    const tree = await openFixtureRow(f, pendingScopedRow({ speedUp: true }));
    for (const title of ['Speed Up', 'Cancel pending transaction']) {
      const button = all(tree).find(node => node.type === 'Button' && node.props.title === title); assert(button, title);
      button.props.onPress(); await settle();
    }
    assert.deepEqual(navigation, [['speed-up', hash], ['cancel', hash]]);
    assert(!all(tree).some(node => node.type === 'Button' && node.props.title === 'Review resend'));
  } finally { f.dispose(); }
});

for (const outcome of ['confirmed', 'reverted'] as const)
  test(`a ${outcome} saved transaction never offers resend after a new pending observation`, async () => {
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
      assert.equal(hasResend(f.render()), false, 'a reorg does not restore a manual resend action');
    } finally { f.dispose(); }
  });

{
  for (const pendingObservation of [false, true]) {
    for (const operation of ['speed-up', 'cancel'] as const) test(`Activity keeps a replaced original distinct from its confirmed ${operation} with ${pendingObservation ? 'an older pending observation' : 'unavailable own details'}`, async () => {
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
      const f = fixture(undefined, false, { onNavigateToReview: forbidden, onReplay: forbidden, onSpeedUpPending: forbidden,
        onCancelPending: forbidden, onCancelSaved: forbidden });
      try {
        f.rows(rows);
        const list = all(f.render()).find(node => node.type === 'FlatList'); assert(list);
        const preview = list.props.renderItem({ item: original, index: 0 });
        assert(preview.props.subtitle.includes(englishI18n.t('transactions.replaced')));
        await preview.props.onPress();
        let tree = all(f.render());
        const detail = tree.find(node => node.type === 'TransactionDetailLayout'); assert(detail);
        assert.equal(detail.props.status, englishI18n.t('transactions.replaced'));
        assert.equal(detail.props.rows.find((row: { label: string }) => row.label === englishI18n.t('send.networkFee')).value,
          englishI18n.t('mobile.activityViews.nativeActivity.actualFeeNotVerified'));
        for (const title of ['Review resend', 'Speed Up', 'Cancel pending transaction', 'Cancel transaction'])
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
      test(`Activity prefers its own ${retained ? 'retained' : 'direct'} ${outcome} receipt over replacement status`, async () => {
        const pending = pendingScopedRow({ speedUp: true });
        const block = { number: '7', hash: '0x' + '88'.repeat(32) };
        const original = { ...pending, replacementStatus: 'replaced',
          observation: retained ? undefined : { ...pending.observation, status: outcome, block, feeUnits: '21000' },
          ...(retained ? { retainedObservation: { status: 'mined', outcome, block, feeUnits: '21000' } } : {}) };
        const f = fixture();
        try {
          f.rows([original]);
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
    for (const title of ['Speed Up', 'Cancel instruction']) {
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
    for (const title of ['Speed Up', 'Cancel instruction']) {
      const button = tree.find(node => node.type === 'Button' && node.props.title === title);
      assert.equal(!!button, title === 'Cancel instruction' || scenario.allowed, title);
      if (button) { button.props.onPress(); await settle(); }
    }
    assert.deepEqual(navigation, scenario.allowed ? [['speed-up', hash], ['cancel', hash]] : [['cancel', hash]]);
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

for (const status of ['pending', 'missing'] as const) for (const privateWithdrawal of [false, true])
test(`Activity ${status} generic Cancel respects retained private-withdrawal authority (${privateWithdrawal})`, async () => {
  const f = fixture(undefined, false, { onReplay() {}, onCancelPending() {}, onCancelSaved() {} });
  try {
    const base = pendingScopedRow();
    const row = { ...base, local: { ...base.local, inspectionOnly: false,
      ...(privateWithdrawal ? { cancellationUnavailable: true } : {}) },
      ...(status === 'missing' ? { observation: undefined, retainedObservation: { status: 'missing', latestNonce: '0' } } : {}) };
    const tree = all(await openFixtureRow(f, row));
    const title = status === 'pending' ? 'Cancel pending transaction' : 'Cancel transaction';
    assert.equal(tree.some(node => node.type === 'Button' && node.props.title === title), !privateWithdrawal);
    assert(!tree.some(node => node.type === 'Button' && node.props.title === 'Review resend'));
  } finally { f.dispose(); }
});

for(const blocked of ['none','private-withdrawal','cancellation','multiple'] as const)test(`historical Smart instruction cancellation is independent of its consumed outer nonce (${blocked})`,async()=>{
 const navigation:[string,string][]=[];const f=fixture(undefined,false,{onNavigateToReview:(action:string,value:string)=>navigation.push([action,value])});
 try{
  const base=pendingScopedRow();
  const row={...base,observation:undefined,retainedObservation:{status:'missing',latestNonce:'1'},local:{...base.local,phase:'reverted',
    ...(blocked==='private-withdrawal'?{cancellationUnavailable:true}:{}),smartAccount:{payer:base.local.address,
      operations:Array.from({length:blocked==='multiple'?2:1},(_,i)=>({operationHash:'0x'+(i?'cd':'ab').repeat(32),operationNonce:'0'})),
      ...(blocked==='cancellation'?{cancellation:true}:{})}}};
  const tree=all(await openFixtureRow(f,row));const action=tree.find(node=>node.type==='Button'&&node.props.title==='Cancel instruction');
  assert.equal(!!action,blocked==='none');assert(!tree.some(node=>node.type==='Button'&&['Cancel pending transaction','Cancel transaction'].includes(node.props.title)));
  if(action){action.props.onPress();await settle();assert.deepEqual(navigation,[['cancel',hash]]);}
 }finally{f.dispose();}
});

test('Smart transaction details observe the matching operation and open one cancellation review for its transaction', async () => {
  const action: unknown[][] = [];
  const f = fixture(undefined, false, { onNavigateToReview: (...input: unknown[]) => action.push(input) });
  try {
    const base = pendingScopedRow();
    const operationHash = '0x' + 'ef'.repeat(32);
    const instruction = { operationHash, operationNonce: (2n ** 190n).toString(), account: base.local.address,
      chainId: '1', createdAt: 1700000000000, payer: base.local.address, observedAt: { number: '1', hash } };
    const row = { hash, checking: false, unavailable: false,
      local: { ...base.local, smartAccount: { payer: base.local.address, operations: [instruction] } },
      smartAuthorizations: [{ instruction, checking: false, unavailable: false }],
    };
    const view = all(await openFixtureRow(f, row));
    const button = (nodes: Element[], title: string) => nodes.find(node => node.type === 'Button' && node.props.title === title);
    assert.deepEqual(f.inspectedOperations(), [operationHash]);
    assert(!button(view, 'Check status'));
    assert(!button(view, 'Review resend'));
    const cancel = button(view, 'Cancel instruction');
    assert(cancel);
    assert.equal(view.filter(node => node.type === 'Button' && node.props.title === 'Cancel instruction').length, 1);
    cancel.props.onPress();
    await settle();
    assert.deepEqual(action, [['cancel', row.hash]]);
    f.rows([{ ...row, smartAuthorizations: [{ ...row.smartAuthorizations[0],
      observation: { kind: 'nonce-consumed', currentNonce: '1', operationHash, anchor: instruction.observedAt },
    }] }]);
    assert(!button(all(f.render()), 'Cancel instruction'));
  } finally { f.dispose(); }
});

test('Activity offers unsigned cancellation only after it observes the original pending', async () => {
  const actions: unknown[][] = [];
  const f = fixture(undefined, false, { onCancelPending: (hash: string) => actions.push(['pending', hash]),
    onCancelSaved: (hash: string) => actions.push(['saved', hash]) });
  try {
    const pending = pendingScopedRow({ speedUp: true });
    const row = { ...pending, local: { ...pending.local, unsignedSpeedUp: true, cancellationUnavailable: true } };
    const has = (tree: unknown, title: string) => all(tree).find(node => node.type === 'Button' && node.props.title === title);
    const unknown = { ...row, observation: undefined, retainedObservation: { status: 'missing', latestNonce: '0' } };
    const missing = await openFixtureRow(f, unknown);
    assert(!has(missing, 'Cancel transaction'));
    assert(!has(missing, 'Cancel pending transaction'));
    f.rows([row]);
    const known = f.render();
    assert(!has(known, 'Cancel transaction'));
    const button = has(known, 'Cancel pending transaction');
    assert(button);
    button.props.onPress();
    await settle();
    assert.deepEqual(actions, [['pending', hash]]);
  } finally { f.dispose(); }
});
