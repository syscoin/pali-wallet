import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import * as core from '../src/core/index.ts';
import * as pairingLinks from '../src/connections/pairingLinks.ts';

type Element = {
  type: unknown;
  props: Record<string, any>;
  children: unknown[];
};
type Cell = {
  value?: any;
  dependencies?: readonly unknown[];
  cleanup?: () => void;
};
const URI = `wc:${'ab'.repeat(32)}@2?relay-protocol=irn&symKey=${'cd'.repeat(
  32
)}`;
const LINK = `pali://wc?uri=${encodeURIComponent(URI)}`;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  const initial = deferred<string | null>(),
    selection = deferred<null | { kind: 'hd'; id: string }>();
  const load = deferred<void>();
  const cells: Cell[] = [],
    effects: (() => void)[] = [];
  const saved: unknown[] = [];
  let index = 0,
    listener: ((event: { url: string }) => void) | undefined;
  const cell = () => cells[index++] ?? (cells[index - 1] = {});
  const effect = (
    callback: () => void | (() => void),
    dependencies: readonly unknown[] = []
  ) => {
    const entry = cell();
    if (
      entry.dependencies &&
      dependencies.length === entry.dependencies.length &&
      dependencies.every((value, n) => Object.is(value, entry.dependencies![n]))
    )
      return;
    entry.dependencies = dependencies;
    effects.push(() => {
      entry.cleanup?.();
      entry.cleanup = callback() || undefined;
    });
  };
  const react = {
    Fragment: 'Fragment',
    createElement: (
      type: unknown,
      props: Record<string, any> | null,
      ...children: unknown[]
    ) => ({ type, props: props ?? {}, children }),
    useState(initial: any) {
      const entry = cell();
      if (!Object.hasOwn(entry, 'value'))
        entry.value = typeof initial === 'function' ? initial() : initial;
      return [
        entry.value,
        (next: any) => {
          entry.value = typeof next === 'function' ? next(entry.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const entry = cell();
      entry.value ??= { current: initial };
      return entry.value;
    },
    useCallback(callback: unknown) {
      cell();
      return callback;
    },
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) {
      cell();
      return read();
    },
    useEffect: effect,
  };
  // Match React's stable useCallback identity for dependency-controlled effects.
  react.useCallback = (
    callback: unknown,
    dependencies: readonly unknown[] = []
  ) => {
    const entry = cell();
    if (
      !entry.dependencies ||
      dependencies.some((value, n) => value !== entry.dependencies![n])
    ) {
      entry.dependencies = dependencies;
      entry.value = callback;
    }
    return entry.value;
  };
  const blank = {
    status: 'locked',
    accounts: [],
    selectedAccountId: null,
    selectedNetworkId: 'ethereum',
    generation: 0,
    balance: { status: 'unknown' },
    capabilities: {},
  };
  const authority = {
    getSnapshot: () => blank,
    lock() {},
    restoreSelection() {},
    subscribe: () => () => {},
    getNetwork: core.getNetwork,
    getAccountNetworks: () => [],
  };
  class Accounts {
    subscribe = () => () => {};
    getSnapshot = () => ({ status: 'ready', accounts: [], utxoNetworks: [] });
    async load() {
      await load.promise;
    }
  }
  const native = {
    Platform: { OS: 'android' },
    StyleSheet: { create: (value: unknown) => value },
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove() {} }),
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove() {} }),
    },
    Linking: {
      getInitialURL: () => initial.promise,
      addEventListener(_name: string, callback: typeof listener) {
        listener = callback;
        return {
          remove() {
            listener = undefined;
          },
        };
      },
    },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
  };
  const ui = Object.fromEntries(
    [
      'Text',
      'Icon',
      'Coin',
      'PaliMark',
      'Button',
      'Card',
      'Screen',
      'Header',
      'Row',
      'Notice',
      'Label',
    ].map((key) => [key, key])
  );
  const dependencies: Record<string, unknown> = {
    react,
    'react-native': native,
    'react-native-safe-area-context': {
      SafeAreaProvider: 'Provider',
      SafeAreaView: 'SafeArea',
    },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo-clipboard': {},
    'react-native-qrcode-svg': {},
    './src/connections/pairingLinks': pairingLinks,
    './src/platform/security': {
      securityPreferences: {},
      watchIdle: { allowNewInput() {} },
      custodyIdle: {},
    },
    './src/screens/IdleActivityBoundary': {},
    './src/ui': { ...ui, colors: {}, styles: {} },
    './src/screens/Onboarding': {
      Welcome: 'Welcome',
      AddWatchAccount: 'AddWatchAccount',
    },
    './src/screens/NativeWallet': { NativeWalletScreen: 'NativeWalletScreen' },
    './src/screens/WalletAccounts': {},
    './src/screens/WatchSession': {},
    './src/core/watchAccounts': { WatchAccounts: Accounts },
    './src/core/accountDirectory': {
      nativeAccountSelection: (id: string) => ({ kind: 'hd', id }),
    },
    './src/design/Studio': {},
    './src/screens/Settings': {},
    './src/core/index': {
      ...core,
      WatchOnlyAuthority: { openRecords: async () => authority },
    },
    './src/platform': {
      publicAccountRecords: {},
      loadAccountSelection: () => selection.promise,
      saveAccountSelection: async (value: unknown) => {
        saved.push(value);
      },
      isNativePersistence: true,
    },
  };
  const module = { exports: {} as { AppContent(props: object): Element } };
  const code = ts.transpileModule(
    readFileSync(new URL('../App.tsx', import.meta.url), 'utf8') +
      '\nexport { AppContent };',
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }
  ).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    AbortController,
    setTimeout,
    clearTimeout,
    require(name: string) {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected dependency ${name}`
      );
      return dependencies[name];
    },
  });
  const render = () => {
    index = 0;
    const value = module.exports.AppContent({});
    effects.splice(0).forEach((run) => run());
    return value;
  };
  const find = (element: unknown, type: string): Element | undefined => {
    if (!element || typeof element !== 'object' || !('children' in element))
      return;
    const node = element as Element;
    return node.type === type
      ? node
      : node.children.flatMap((child) => find(child, type) ?? []).at(0);
  };
  render();
  return {
    initial,
    selection,
    load,
    saved,
    render,
    find,
    warm(url: string) {
      assert.ok(listener);
      listener({ url });
    },
    dispose() {
      cells.forEach((entry) => entry.cleanup?.());
    },
  };
}

test('a warm pairing link wins a racing saved-account restore without persisting an account selection', async () => {
  const f = harness();
  try {
    f.warm(LINK);
    let wallet = f.find(f.render(), 'NativeWalletScreen');
    assert.ok(wallet);
    assert.equal(wallet.props.initialAccountId, undefined);
    assert.equal(wallet.props.incomingPairing.uri, URI);
    f.load.resolve();
    await settle();
    f.selection.resolve({ kind: 'hd', id: 'hd:60:7' });
    await settle();
    wallet = f.find(f.render(), 'NativeWalletScreen');
    assert.ok(wallet);
    assert.equal(wallet.props.initialAccountId, undefined);
    assert.equal(wallet.props.incomingPairing.uri, URI);
    assert.deepEqual(f.saved, []);
    f.initial.resolve(LINK.replace('ab', 'ef'));
    await settle();
    assert.equal(
      f.find(f.render(), 'NativeWalletScreen')!.props.incomingPairing.uri,
      URI
    );
  } finally {
    f.dispose();
  }
});

test('a late cold link opens review after automatic restore while ignoring the saved account hint', async () => {
  const f = harness();
  try {
    f.load.resolve();
    await settle();
    f.selection.resolve({ kind: 'hd', id: 'hd:60:7' });
    await settle();
    assert.equal(
      f.find(f.render(), 'NativeWalletScreen')!.props.initialAccountId,
      'hd:60:7'
    );
    f.initial.resolve(LINK);
    await settle();
    const wallet = f.find(f.render(), 'NativeWalletScreen');
    assert.ok(wallet);
    assert.equal(wallet.props.initialAccountId, undefined);
    assert.equal(wallet.props.incomingPairing.uri, URI);
    const id = wallet.props.incomingPairing.id;
    wallet.props.onPairingHandled(id);
    assert.equal(
      f.find(f.render(), 'NativeWalletScreen')!.props.incomingPairing,
      null
    );
    assert.deepEqual(f.saved, []);
  } finally {
    f.dispose();
  }
});

test('a user navigation makes a delayed cold link stale', async () => {
  const f = harness();
  try {
    f.load.resolve();
    await settle();
    f.selection.resolve(null);
    await settle();
    const welcome = f.find(f.render(), 'Welcome');
    assert.ok(welcome);
    welcome.props.onWatch();
    f.render();
    f.initial.resolve(LINK);
    await settle();
    assert.ok(f.find(f.render(), 'AddWatchAccount'));
    assert.equal(f.find(f.render(), 'NativeWalletScreen'), undefined);
  } finally {
    f.dispose();
  }
});

for (const kind of ['create', 'import'] as const) {
  test(`welcome ${kind} opens that native form without selecting an account`, async () => {
    const f = harness();
    try {
      f.load.resolve();
      await settle();
      f.selection.resolve(null);
      await settle();
      const welcome = f.find(f.render(), 'Welcome');
      assert.ok(welcome);
      welcome.props[kind === 'create' ? 'onCreateWallet' : 'onImportWallet']();
      const wallet = f.find(f.render(), 'NativeWalletScreen');
      assert.ok(wallet);
      assert.equal(wallet.props.initialSetup, kind);
      assert.equal(wallet.props.initialAccountId, undefined);
      assert.deepEqual(f.saved, []);
      wallet.props.onExit();
      const next = f.find(f.render(), 'Welcome');
      assert.ok(next);
      next.props.onWatch();
      assert.ok(f.find(f.render(), 'AddWatchAccount'));
    } finally {
      f.dispose();
    }
  });
}
