import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { getNativeNetwork, getNativeSendContext, nativeSigningEnabled } from '../src/custody/networkContext.ts';
import { TabDeparture } from '../src/navigation/tabDeparture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

type Element = { type: any; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const element = value as Element;
  return [element, ...element.children.flatMap(elements), ...elements(element.props.footer), ...elements(element.props.right)];
}

/** Actual overview, portfolio and shell handlers with public data and native event ports. */
function fixture(overview: boolean, receiveEntry?: 'detail' | 'continuation', unbacked = false) {
  const cells = new Map<unknown, Cell[]>(), nativeBacks = new Set<() => boolean>();
  let current: Cell[] = [], cursor = 0, pendingEffects: (() => void)[] = [], dirty = false;
  let exits = 0, sends = 0, backups = 0, consumed = 0, shell: any, currentAccount = true;
  const copied: string[] = [];
  const cell = () => current[cursor++] ?? (current[cursor - 1] = {});
  const react = {
    createElement: (type: unknown, props: object | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) {
      const slot = cell();
      if (!Object.hasOwn(slot, 'value')) slot.value = typeof initial === 'function' ? initial() : initial;
      return [slot.value, (value: any) => {
        const next = typeof value === 'function' ? value(slot.value) : value;
        if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; }
      }];
    },
    useRef(initial: unknown) { const slot = cell(); slot.value ??= { current: initial }; return slot.value; },
    useMemo(create: () => unknown, deps: readonly unknown[]) {
      const slot = cell();
      if (!slot.deps || deps.length !== slot.deps.length || deps.some((value, index) => value !== slot.deps![index])) {
        slot.value = create(); slot.deps = deps;
      }
      return slot.value;
    },
    useCallback(callback: unknown, deps: readonly unknown[]) { return react.useMemo(() => callback, deps); },
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) { cell(); return read(); },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const slot = cell();
      if (deps && slot.deps && deps.length === slot.deps.length && deps.every((value, index) => value === slot.deps![index])) return;
      slot.deps = deps;
      pendingEffects.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; });
    },
  };
  const network = getNativeNetwork('ethereum'), address = '0x' + '11'.repeat(20);
  const account = { address, network: network.id, revision: 1 };
  const source = { getSnapshot: () => ({ phase: 'ready', backup: receiveEntry || unbacked ? 'unconfirmed' : 'confirmed', revision: 1, account }),
    getCatalogue: () => ({ active: { accountId: 'hd:60:0', networkId: network.id }, networks: [network] }), subscribe: () => () => {} };
  const choice = { networkName: network.name, symbol: network.symbol,
    scope: { id: 'native:hd:60:0:ethereum', accountId: 'hd:60:0', accountAddress: address, network } };
  const controller = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', filter: 'all', choices: [choice],
    rows: [{ choice, units: '1000000000000000000', decimals: 18, status: 'available', tokens: [], collectibles: [] }],
    knownValue: null, currency: null, partial: true, refreshing: false }), setCurrency() {}, connect: () => () => {}, cachedBalances: () => [] };
  const native = {
    ...Object.fromEntries(['ActivityIndicator', 'Modal', 'ScrollView', 'View'].map(value => [value, value])),
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    BackHandler: { addEventListener(_name: string, handler: () => boolean) { nativeBacks.add(handler); return { remove: () => nativeBacks.delete(handler) }; } },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }), StyleSheet: { create: (value: unknown) => value },
  };
  const common = {
    react, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'IconButton', 'Notice', 'Row', 'Screen', 'Text'].map(value => [value, value])), colors: {}, styles: {} },
    './IdleActivityBoundary': { IdlePressable: 'IdlePressable' },
    '../platform/localization': nativeTranslationFixture,
    '../platform/balancePrivacy': { useBalancePrivacy: () => ({ hidden: false }), HIDDEN_BALANCE: 'hidden' },
    '../platform/fiatPreferences': { useFiatCurrency: () => ({ status: 'ready', currency: 'usd' }) },
    '../core/amounts': { formatBaseUnits },
    '../custody/networkContext': { getNativeSendContext, nativeSigningEnabled },
    '../portfolio/fiatDisplay': { formatIndicativeFiat: () => '—' },
    '../activity/activityAmountLabel': { compactActivityAmountLabel: (value: string) => value },
  };
  function load(file: string, imports: Record<string, unknown>) {
    const source = readFileSync(new NodeURL(`../src/screens/${file}.ts${file === 'useRealShell' ? '' : 'x'}`, import.meta.url), 'utf8');
    const module = { exports: {} as Record<string, any> };
    runInNewContext(ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
    } }).outputText, { module, exports: module.exports, require(name: string) {
      assert(Object.hasOwn(imports, name), `Missing ${file} port: ${name}`); return imports[name];
    } });
    return module.exports;
  }
  function TokenFixture(props: any) {
    const [selected, setSelected] = react.useState(false);
    react.useLayoutEffect(() => {
      props.onModeChange(selected ? 'Token details' : null);
      props.onBackHandlerChange(() => { if (!selected) return false; setSelected(false); return true; });
      return () => props.onBackHandlerChange(null);
    }, [selected, props.onBackHandlerChange, props.onModeChange]);
    return react.createElement('TokenFixture', null, selected ? 'Token details' : props.nativeAsset,
      react.createElement('Button', { title: 'Open token', onPress: () => setSelected(true) }));
  }
  const { NativePortfolio } = load('NativePortfolio', { ...common,
    'expo-clipboard': { async setStringAsync(value: string) { copied.push(value); return true; } }, 'react-native-qrcode-svg': { default: 'QRCode' }, './CopyableAddress': { CopyableAddress: 'CopyableAddress' },
    '../custody/testnetFaucet': { getTestnetFaucet: () => null }, '../core/utxoAddresses': {},
    '../platformRpc': {}, '../platform/http': {}, '../portfolio/useNativeCoinQuote': { useNativeCoinQuote: () => ({ supported: false }) },
    '../portfolio/nativePortfolio': { NativePortfolioController: class {
      subscribe = () => () => {}; getSnapshot = () => ({ status: 'available', account, units: '1000000000000000000', updatedAt: 1 });
      connect = () => () => {}; getUtxoNetwork = () => undefined; getNetworkRegistration = () => network; isCurrent = () => currentAccount;
    } }, './NativeTokens': { NativeTokens: TokenFixture }, './PortfolioQuote': { PortfolioQuote: 'PortfolioQuote' },
    '../portfolio/AssetMarketCard': { AssetMarketCard: 'AssetMarketCard' }, './TestnetFaucetCard': {},
    '../../../../source/shared/sptInventory': {}, './NativeSptAssets': {},
  });
  const { NativeAccountOverview, NativePortfolioRoute } = load('NativeAccountOverview', { ...common,
    '../portfolio/accountPortfolio': {}, '../../../../source/shared/erc20': {}, './NativePortfolio': { NativePortfolio },
    './NetworkSourceSheet': { NetworkSourceSheet: 'NetworkSourceSheet' }, './WalletBackupBadge': {},
  });
  const { useRealShell } = load('useRealShell', { react, 'react-native': native, '../navigation/tabDeparture': { TabDeparture } });
  const scope = () => 'hd:60:0:ethereum', exit = () => { exits++; }, onSend = () => { sends++; };
  const reader = {}, tokenView = {};
  let detail = receiveEntry === 'detail' ? { accountId: 'hd:60:0', networkId: network.id, receive: true } : undefined;
  let continuation = receiveEntry === 'continuation' ? { account, backupAcknowledged: true } : undefined;
  function Root() {
    shell = useRealShell(scope(), scope, exit);
    const portfolio = { source, reader, tokenView, accountLabel: 'Account 1', onExit: exit, onLock() {}, onViewRecovery() { backups++; },
      onReceiveIntentConsumed() { consumed++; if (detail) detail = { ...detail, receive: false }; continuation = undefined; dirty = true; },
      initialReceive: continuation, onSend, navigation: shell.navigation };
    if (receiveEntry) return react.createElement(NativePortfolioRoute, { ...portfolio, overview: receiveEntry === 'detail' ? controller : undefined,
      detail, selectNetwork: async () => {}, sendFrom: async () => {} });
    return overview ? react.createElement(NativeAccountOverview, { controller, portfolio, selectNetwork: async () => {}, send: async () => {} })
      : react.createElement(NativePortfolio, portfolio);
  }
  function expand(value: any): any {
    if (Array.isArray(value)) return value.map(expand);
    if (!value || typeof value !== 'object' || !('children' in value)) return value;
    if (typeof value.type === 'function') return renderOne(value.type, value.props);
    return { ...value, children: value.children.map(expand), props: { ...value.props,
      ...(value.props.footer ? { footer: expand(value.props.footer) } : {}), ...(value.props.right ? { right: expand(value.props.right) } : {}) } };
  }
  function renderOne(component: (props: any) => Element, props: any): Element {
    current = cells.get(component) ?? []; cells.set(component, current); cursor = 0; pendingEffects = [];
    const result = component(props), ownEffects = pendingEffects;
    const expanded = expand(result);
    ownEffects.forEach(run => run());
    return expanded;
  }
  const render = () => {
    for (let pass = 0; pass < 20; pass++) { dirty = false; const tree = renderOne(Root, {}); if (!dirty) return tree; }
    throw Error('Portfolio layout did not settle');
  };
  return { render, copied, retireAccount() { currentAccount = false; },
    back(nativeFirst = false) { if (!nativeFirst || ![...nativeBacks].reverse().some(handler => handler())) shell.goBack(); },
    get exits() { return exits; }, get sends() { return sends; },
    get backups() { return backups; }, get consumed() { return consumed; },
    remountPortfolio() {
      for (const [component, slots] of cells) if (component !== Root) {
        for (const slot of slots) slot.cleanup?.();
        cells.delete(component);
      }
    },
    close() { for (const slots of cells.values()) for (const slot of slots) slot.cleanup?.(); },
  };
}

for (const nativeFirst of [false, true]) test(`overview market detail returns through both Back levels (${nativeFirst ? 'native' : 'shell'} first)`, async () => {
  const f = fixture(true);
  try {
    const row = elements(f.render()).find(value => value.type === 'IdlePressable' && value.props.accessibilityLabel?.startsWith('ETH, Ethereum'));
    assert(row); row.props.onPress(); await Promise.resolve(); await Promise.resolve();
    const native = elements(f.render()).find(value => value.type === 'Row' && value.props.title === 'ETH');
    assert(native); native.props.onPress();
    assert(elements(f.render()).some(value => value.type === 'AssetMarketCard'));
    f.back(nativeFirst);
    assert(!elements(f.render()).some(value => value.type === 'AssetMarketCard'));
    assert.equal(f.exits, 0);
    f.back(nativeFirst);
    assert(elements(f.render()).some(value => value.props.accessibilityLabel?.startsWith('ETH, Ethereum')));
    assert.equal(f.exits, 0);
  } finally { f.close(); }
});

for (const overview of [false, true]) for (const nativeFirst of [false, true]) test(`${overview ? 'overview' : 'root'} portfolio preserves Send, nested Receive and token Back (${nativeFirst ? 'native' : 'shell'} first)`, async () => {
  const f = fixture(overview);
  const button = (title: string) => { const found = elements(f.render()).find(value => value.type === 'Button' && value.props.title === title); assert(found, title); return found; };
  try {
    if (overview) {
      const row = elements(f.render()).find(value => value.type === 'IdlePressable' && value.props.accessibilityLabel?.startsWith('ETH, Ethereum'));
      assert(row); row.props.onPress(); await Promise.resolve(); await Promise.resolve();
    }
    button('Send').props.onPress(); assert.equal(f.sends, 1); assert.equal(f.exits, 0);
    button('Open token').props.onPress();
    assert(elements(f.render()).some(value => value.type === 'Header' && value.props.title === 'Token details'));
    f.back(nativeFirst);
    assert(!elements(f.render()).some(value => value.type === 'Header' && value.props.title === 'Token details'));
    assert.equal(f.exits, 0);
    button('Receive').props.onPress();
    assert(elements(f.render()).some(value => value.props.testID === 'native-receive-address'));
    f.back(nativeFirst);
    assert(!elements(f.render()).some(value => value.props.testID === 'native-receive-address'));
    assert.equal(f.exits, 0);
    f.back(nativeFirst);
    assert.equal(f.exits, overview ? 0 : 1);
    if (overview) assert(elements(f.render()).some(value => value.props.accessibilityLabel?.startsWith('ETH, Ethereum')));
  } finally { f.close(); }
});

for (const entry of ['detail', 'continuation'] as const) test(`Receive ${entry} is consumed before Back, Send and portfolio remount`, () => {
  const f = fixture(entry === 'detail', entry);
  const button = (title: string) => {
    const found = elements(f.render()).find(value => value.type === 'Button' && value.props.title === title);
    assert(found, title); return found;
  };
  try {
    if (entry === 'detail') button('Receive Anyway').props.onPress();
    assert(elements(f.render()).some(value => value.props.testID === 'native-receive-address'));
    f.back();
    assert(!elements(f.render()).some(value => value.props.testID === 'native-receive-address'));
    button('Send').props.onPress();
    assert.equal(f.backups, 0);
    assert.equal(f.sends, 1, 'Send must open a fresh public draft rather than restore the consumed Receive intent');
    f.remountPortfolio();
    const returned = elements(f.render());
    assert(!returned.some(value => value.props.testID === 'native-receive-address'), 'the prior receive route must not reopen');
    assert(!returned.some(value => value.type === 'Button' && value.props.title === 'Receive Anyway'), 'the prior receive warning must not reopen');
    assert.equal(f.consumed, 1);
  } finally { f.close(); }
});

test('cancelled Receive warning stays cancelled across remount and stale acknowledgement', () => {
  const f = fixture(true, 'detail');
  try {
    const oldContinue = elements(f.render()).find(value => value.type === 'Button' && value.props.title === 'Receive Anyway');
    assert(oldContinue);
    f.back();
    oldContinue.props.onPress();
    f.remountPortfolio();
    assert(!elements(f.render()).some(value => value.props.testID === 'native-receive-address' || value.props.title === 'Receive Anyway'));
    assert.equal(f.consumed, 1);
    elements(f.render()).find(value => value.type === 'Button' && value.props.title === 'Receive')!.props.onPress();
    oldContinue.props.onPress();
    assert(!elements(f.render()).some(value => value.props.testID === 'native-receive-address'));
    const freshContinue = elements(f.render()).find(value => value.type === 'Button' && value.props.title === 'Receive Anyway');
    assert(freshContinue); freshContinue.props.onPress();
    assert(elements(f.render()).some(value => value.props.testID === 'native-receive-address'));
  } finally { f.close(); }
});


test('unbacked asset address copies without entering Receive or acknowledging backup', async () => {
  const f = fixture(false, undefined, true);
  try {
    const asset = elements(f.render()).find(value => value.type === 'Row' && value.props.title === 'ETH');
    assert(asset); asset.props.onPress();
    const copy = elements(f.render()).find(value => value.type === 'CopyableAddress');
    assert(copy); copy.props.onCopy(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(f.copied, ['0x' + '11'.repeat(20)]);
    assert.equal(f.backups, 0);
    assert(!elements(f.render()).some(value => value.props.testID === 'native-receive-address' || value.props.title === 'Receive Anyway'));
    const receive = elements(f.render()).find(value => value.type === 'Button' && value.props.title === 'Receive');
    assert(receive); receive.props.onPress();
    assert(elements(f.render()).some(value => value.props.title === 'Receive Anyway'), 'copy must not acknowledge the Receive warning');
    f.back();
    const send = elements(f.render()).find(value => value.type === 'Button' && value.props.title === 'Send');
    assert(send); send.props.onPress(); assert.equal(f.backups, 0); assert.equal(f.sends, 1);
    f.retireAccount(); copy.props.onCopy(); await Promise.resolve();
    assert.equal(f.copied.length, 1, 'a stale public address must not be copied');
  } finally { f.close(); }
});
