import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as networks from '../src/custody/networkContext.ts';
import * as utxoNetworks from '../src/core/utxoNetworks.ts';
import type { NativePairingEntry } from '../src/connections/pairingLinks.ts';

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
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const code = ts.transpileModule(
  readFileSync(
    new URL('../src/screens/NativeWallet.native.tsx', import.meta.url),
    'utf8'
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }
).outputText;

function harness(ready = false, smartAccount = false) {
  let now = 1000,
    cursor = 0,
    selectionCalls = 0;
  let hardwareBack: (() => boolean) | undefined;
  let exits = 0;
  let incoming: NativePairingEntry | null = smartAccount
    ? null
    : {
        id: 'pairing-1',
        uri: URI,
        expiresAt: now + 300000,
      };
  let snapshot: any = {
    phase: ready ? 'ready' : 'locked',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: ready
      ? { address: '0x' + '11'.repeat(20), network: 'ethereum' }
      : null,
    error: null,
  };
  let connectionSnapshot: any = {
    status: 'ready',
    signingReview: null,
    proposals: [],
  };
  const cells: Cell[] = [],
    effects: (() => void)[] = [];
  const authorityListeners = new Set<(value: unknown) => void>(),
    connectionListeners = new Set<() => void>();
  const appListeners = new Map<string, Set<(value: string) => void>>();
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const effect = (
    callback: () => void | (() => void),
    dependencies?: readonly unknown[]
  ) => {
    const entry = cell();
    if (
      dependencies &&
      entry.dependencies &&
      dependencies.length === entry.dependencies.length &&
      dependencies.every((value, index) =>
        Object.is(value, entry.dependencies![index])
      )
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
    useRef(initial: any) {
      const entry = cell();
      entry.value ??= { current: initial };
      return entry.value;
    },
    useEffect: effect,
    useLayoutEffect: effect,
    useCallback(callback: unknown, dependencies: readonly unknown[] = []) {
      const entry = cell();
      if (
        !entry.dependencies ||
        dependencies.some(
          (value, index) => value !== entry.dependencies![index]
        )
      ) {
        entry.value = callback;
        entry.dependencies = dependencies;
      }
      return entry.value;
    },
  };
  let catalogue = {
    revision: 1,
    active: {
      accountId: smartAccount ? 'smart:60:0' : 'hd:60:0',
      networkId: 'ethereum',
    },
    networks: [],
    utxoNetworks: [],
    accounts: [
      {
        id: smartAccount ? 'smart:60:0' : 'hd:60:0',
        index: 0,
        type: smartAccount ? 'SmartAccount' : 'HDAccount',
        ...(smartAccount ? { smartAccount: { isDeployed: false } } : {}),
        address: '0x' + '11'.repeat(20),
        label: 'Account 1',
      },
    ],
  };
  const change = (phase: string) => {
    snapshot = {
      ...snapshot,
      phase,
      revision: snapshot.revision + 1,
      account:
        phase === 'ready'
          ? { address: '0x' + '11'.repeat(20), network: 'ethereum' }
          : null,
    };
    for (const listener of authorityListeners) listener(snapshot);
  };
  const controllers = {
    authority: {
      getSnapshot: () => snapshot,
      getCatalogue: () => (snapshot.phase === 'ready' ? catalogue : null),
      subscribe(listener: (value: unknown) => void) {
        authorityListeners.add(listener);
        return () => {
          authorityListeners.delete(listener);
        };
      },
      supportsAccountManagement: () => false,
      lock() {
        change('locked');
      },
      async unlock() {
        change('ready');
      },
    },
    accounts: {
      async execute() {
        selectionCalls++;
      },
    },
    connections: {
      getSnapshot: () => connectionSnapshot,
      subscribe(listener: () => void) {
        connectionListeners.add(listener);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      cancel() {},
    },
    keyExport: { cancel() {} },
    backup: { cancel() {}, onClear: () => () => {} },
    removal: { requiresControllerReopen: () => false },
    openSmartAccountDeployment() {
      throw new Error('Route mocked in parent navigation test');
    },
    balanceReader: {},
    transfers: {},
    tokens: {},
    activity: {},
  };
  const native: any = {
    Platform: { OS: 'android' },
    StyleSheet: { create: (value: unknown) => value },
    Keyboard: { dismiss() {} },
    AppState: {
      currentState: 'active',
      addEventListener(name: string, listener: (value: string) => void) {
        const values = appListeners.get(name) ?? new Set();
        values.add(listener);
        appListeners.set(name, values);
        return {
          remove() {
            values.delete(listener);
          },
        };
      },
    },
    BackHandler: {
      addEventListener(_name: string, listener: () => boolean) {
        hardwareBack = listener;
        return {
          remove() {
            if (hardwareBack === listener) hardwareBack = undefined;
          },
        };
      },
    },
  };
  const lifecycle = class {
    async acquire() {
      return controllers;
    }
    current() {
      return controllers;
    }
    hasRecovery() {
      return false;
    }
    async release() {}
  };
  const noteRestore = {
    cancel() {},
    lock() {},
    resume: () => false,
    step: { phase: 'select' },
  };
  const source = readFileSync(
    new URL('../src/screens/NativeWallet.native.tsx', import.meta.url),
    'utf8'
  );
  const dependencies: Record<string, unknown> = Object.fromEntries(
    [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => [
      match[1]!,
      {},
    ])
  );
  Object.assign(dependencies, {
    react,
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': {
      Header: 'Header',
      Text: 'Text',
      Button: 'Button',
      Screen: 'Screen',
      Notice: 'Notice',
      styles: {},
      colors: {},
    },
    '../core/utxoNetworks': utxoNetworks,
    '../custody/networkContext': networks,
    '../platform/security': {
      custodyIdle: { begin() {}, stop() {} },
      securityPreferences: { getSnapshot: () => ({ status: 'ready' }) },
    },
    '../platform/privacyShield.native': { async ensurePrivacyShield() {} },
    '../platform/nativeFactory': {
      createNativeWalletControllers: () => controllers,
    },
    '../custody/nativeControllerLifecycle': {
      NativeControllerLifecycle: lifecycle,
    },
    '../custody/networkView': { createNativeNetworkView: () => ({}) },
    './useNativeNoteBackup': { useNativeNoteBackup: () => noteRestore },
    './useRealShell': {
      useRealShell: () => ({
        tab: 'wallet',
        immersive: false,
        navigation: {},
        restoreRoot() {},
        goBack() {},
      }),
    },
    './NativePortfolio': { NativePortfolio: 'NativePortfolio' },
    './NativeSmartAccountDeployment': {
      NativeSmartAccountDeploymentRoute: 'NativeSmartAccountDeploymentRoute',
    },
    './NativeConnections': { NativeConnections: 'NativeConnections' },
    './NativeMessageReview': {
      NativeMessageReviewScreen: 'NativeMessageReviewScreen',
    },
    './NativeTransactionReview': {
      NativeTransactionReviewScreen: 'NativeTransactionReviewScreen',
    },
    './NativeSend': { NativeSend: 'NativeSend' },
  });
  const module = {
    exports: {} as { NativeWalletScreen(props: object): Element },
  };
  runInNewContext(code, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    AbortController,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
  });
  const render = () => {
    cursor = 0;
    const tree = module.exports.NativeWalletScreen({
      onExit() {
        exits++;
      },
      initialAccountId: 'hd:60:9',
      incomingPairing: incoming,
      onPairingHandled(id: string) {
        if (incoming?.id === id) incoming = null;
      },
    });
    effects.splice(0).forEach((run) => run());
    return tree;
  };
  return {
    render,
    hardwareBack() {
      assert(hardwareBack);
      return hardwareBack();
    },
    exits: () => exits,
    completeDeployment() {
      catalogue = {
        ...catalogue,
        revision: catalogue.revision + 1,
        accounts: catalogue.accounts.map((account) => ({
          ...account,
          smartAccount: { ...account.smartAccount, isDeployed: true },
        })),
      };
    },
    ready: () => change('ready'),
    selectionCalls: () => selectionCalls,
    consume() {
      incoming = null;
    },
    expire() {
      now += 300001;
    },
    connections(patch: object) {
      connectionSnapshot = { ...connectionSnapshot, ...patch };
      for (const listener of connectionListeners) listener();
    },
    background() {
      native.AppState.currentState = 'background';
      for (const listener of appListeners.get('change') ?? [])
        listener('background');
    },
    blur() {
      for (const listener of appListeners.get('blur') ?? []) listener('');
    },
    foreground() {
      native.AppState.currentState = 'active';
      for (const listener of appListeners.get('change') ?? [])
        listener('active');
    },
    dispose() {
      cells.forEach((entry) => entry.cleanup?.());
    },
  };
}

function find(
  tree: unknown,
  predicate: (node: Element) => boolean
): Element | undefined {
  if (!tree || typeof tree !== 'object' || !('children' in tree)) return;
  const node = tree as Element;
  return predicate(node)
    ? node
    : node.children.flatMap((child) => find(child, predicate) ?? []).at(0);
}

async function mounted(ready = false, smartAccount = false) {
  const f = harness(ready, smartAccount);
  f.render();
  await settle();
  f.render();
  await settle();
  f.render();
  return f;
}

test('an incoming pairing waits for unlock and never applies the saved account hint', async () => {
  const f = await mounted();
  try {
    let tree = f.render();
    assert.equal(tree.type, 'SafeAreaView');
    const input = find(tree, (node) => node.props.label === 'Password');
    assert.ok(input);
    input.props.onChange('public fixture password');
    tree = f.render();
    find(tree, (node) => node.props.title === 'Unlock wallet')!.props.onPress();
    await settle();
    f.render();
    await settle();
    tree = f.render();
    assert.equal(tree.type, 'NativeConnections');
    assert.equal(tree.props.incomingPairing.uri, URI);
    assert.equal(f.selectionCalls(), 0);
  } finally {
    f.dispose();
  }
});

test('an incoming pairing waits for an existing connection review to finish', async () => {
  const f = await mounted();
  try {
    f.connections({ status: 'approving', proposals: [{ id: 1 }] });
    f.ready();
    f.render();
    assert.notEqual(f.render().type, 'NativeConnections');
    f.connections({ status: 'ready', proposals: [] });
    f.render();
    await settle();
    assert.equal(f.render().type, 'NativeConnections');
  } finally {
    f.dispose();
  }
});

for (const expired of [false, true])
  for (const transition of ['background', 'blur'] as const) {
    test(`camera intent ${
      expired ? 'expires' : 'resumes only after unlock'
    } after ${transition}`, async () => {
      const f = await mounted(true);
      try {
        let tree = f.render();
        assert.equal(tree.type, 'NativeConnections');
        tree.props.onPairingHandled(tree.props.incomingPairing.id);
        f.consume();
        tree.props.onScanStarted();
        f.render();
        if (transition === 'background') f.background();
        else f.blur();
        tree = f.render();
        assert.notEqual(tree.type, 'NativeConnections');
        if (expired) f.expire();
        f.foreground();
        f.ready();
        f.render();
        await settle();
        tree = f.render();
        assert.equal(tree.type === 'NativeConnections', !expired);
        if (!expired) {
          assert.equal(tree.props.initialScan, true);
          tree.props.onBack();
          f.render();
          assert.notEqual(f.render().type, 'NativeConnections');
        }
      } finally {
        f.dispose();
      }
    });
  }

for (const [kind, screen] of [
  ['message', 'NativeMessageReviewScreen'],
  ['transaction', 'NativeTransactionReviewScreen'],
] as const)
  test(`an incoming pairing never replaces an already active ${kind} approval`, async () => {
    const f = await mounted();
    try {
      f.connections({ signingReview: { kind, id: `${kind}-1` } });
      f.ready();
      f.render();
      assert.equal(f.render().type, screen);
      f.connections({ signingReview: null });
      f.render();
      await settle();
      assert.equal(f.render().type, 'NativeConnections');
    } finally {
      f.dispose();
    }
  });

for (const back of ['Android', 'screen'] as const)
  test(`${back} Back refreshes the completed smart deployment without exiting or locking`, async () => {
    const f = await mounted(true, true);
    try {
      const portfolio = find(
        f.render(),
        (node) => node.type === 'NativePortfolio'
      );
      assert(portfolio);
      assert.equal(portfolio.props.smartAccount.isDeployed, false);
      portfolio.props.onDeploySmartAccount();
      const route = f.render();
      assert.equal(route.type, 'NativeSmartAccountDeploymentRoute');
      // The runtime committed new metadata without an authority phase change.
      f.completeDeployment();
      if (back === 'Android') assert.equal(f.hardwareBack(), true);
      else route.props.onBack();
      const refreshed = find(
        f.render(),
        (node) => node.type === 'NativePortfolio'
      );
      assert(refreshed);
      assert.equal(refreshed.props.smartAccount.isDeployed, true);
      assert.equal(refreshed.props.onDeploySmartAccount, undefined);
      assert.equal(f.exits(), 0);
    } finally {
      f.dispose();
    }
  });
