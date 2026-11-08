import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { DEFAULT_ACTIVITY_VIEW } from '../src/activity/types.ts';

type Element = { type: any; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; dependencies?: unknown[]; cleanup?: () => void };
const hash = '0x' + '11'.repeat(32);
function fixture(initialHash?: string, held = false) {
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
    closeSavedPending() {},
    async setView() {},
  };
  const ui = Object.fromEntries(
    ['Button', 'Card', 'Header', 'Notice', 'Text'].map((name) => [name, name])
  );
  const native = Object.fromEntries(
    ['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'View'].map(
      (name) => [name, name]
    )
  );
  const dependencies: Record<string, unknown> = {
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
    '../core/amounts': { formatBaseUnits: () => '0' },
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
    render() {
      const parent = renderOne(module.exports.NativeActivityScreen, {
        controller,
        initialHash,
        accountLabel: 'Guardian',
        onBack() {},
        onReplay() {
          replays++;
        },
      });
      return renderOne(parent.type, parent.props);
    },
    loaded: () => loaded,
    inspected: () => inspected,
    replays: () => replays,
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
