import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as networks from '../src/custody/networkContext.ts';
import * as utxoNetworks from '../src/core/utxoNetworks.ts';
import type { NativePairingEntry } from '../src/connections/pairingLinks.ts';
import type { NativeConnectionsView } from '../src/connections/types.ts';

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

function harness(ready = false, smartAccount = false, withPairing = true, canManage = true, handoff = false, slh = false) {
  let now = 1000,
    cursor = 0,
    selectionCalls = 0;
  let hardwareBack: (() => boolean) | undefined;
  let exits = 0;
  let shellTab = 'wallet';
  let guardianReads = 0;
  let guardianOpens = 0;
  let recoveryOpens = 0;
  const lifecycleEvents: string[] = [];
  const psbtLifecycle = {
    backgroundPsbt() { lifecycleEvents.push('psbt-background'); },
    async cancelPsbtHandoff() { lifecycleEvents.push('psbt-cancel'); },
    async resumePsbt() { throw Error('PSBT resume is outside this fixture'); },
  } satisfies Pick<NativeConnectionsView, 'backgroundPsbt' | 'cancelPsbtHandoff' | 'resumePsbt'>;
  const authenticatorGuards: (() => void)[] = [];
  let incoming: NativePairingEntry | null = smartAccount || !withPairing
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
    networks: networks.NATIVE_NETWORKS,
    utxoNetworks: [],
    accounts: [
      {
        id: smartAccount ? 'smart:60:0' : 'hd:60:0',
        index: 0,
        slip44: 60,
        type: smartAccount ? 'SmartAccount' : 'HDAccount',
        ...(smartAccount ? { smartAccount: { isDeployed: false, localEcdsa: true, chainId: 1 } } : {}),
        address: '0x' + '11'.repeat(20),
        label: 'Account 1',
      },
      ...(handoff ? [{ id: 'hd:60:1', index: 1, slip44: 60, type: 'HDAccount', address: '0x' + '22'.repeat(20), label: 'Guardian' }] : []),
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
        lifecycleEvents.push('lock');
        change('locked');
      },
      async unlock() {
        change('ready');
      },
    },
    accounts: {
      async execute(request: { id: string }) {
        selectionCalls++;
        if (handoff) {
          const selected = catalogue.accounts.find(account => account.id === request.id)!;
          catalogue = { ...catalogue, revision: catalogue.revision + 1, active: { ...catalogue.active, accountId: request.id } };
          snapshot = { ...snapshot, revision: snapshot.revision + 1, account: { address: selected.address, network: 'ethereum' } };
          for (const listener of authorityListeners) listener(snapshot);
        }
      },
    },
    connections: {
      ...psbtLifecycle,
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
    openSmartAccountSend() { throw new Error('Route mocked in parent navigation test'); },
    openSmartAccountDeployment() {
      throw new Error('Route mocked in parent navigation test');
    },
    canManageGuardianPolicy: () => smartAccount && canManage,
    canSignSmartAccount: () => smartAccount && (canManage || slh), canManageSlhDsa: () => smartAccount && slh,
    async openSlhDsaManagement(_signal: AbortSignal, check: () => void) { check(); authenticatorGuards.push(check); return { installedKeys: [] }; },
    canUseWalletAuthenticator: () => smartAccount && canManage && catalogue.accounts[0]?.smartAccount?.isDeployed === true,
    async openWalletAuthenticator(_signal: AbortSignal, check: () => void) {
      check();
      authenticatorGuards.push(check);
      return { dispose() {} };
    },
    guardianRecovery: { hasIntent: () => true, async open(_draft: unknown, _signal: AbortSignal, check: () => void) { check(); recoveryOpens++; return { dispose() {} }; } },
    inspectGuardianRemoval: async (_signal: AbortSignal, check: () => void) => { check(); return { status: 'retry-ready', transactions: [], totalPending: 0 }; },
    openGuardianPolicy: async (_draft: unknown, _signal: AbortSignal, check: () => void) => { check(); guardianOpens++; return { dispose() {} }; },
    readGuardianRecovery: async (_signal: AbortSignal, check: () => void) => { check(); guardianReads++; return { status: 'no-compatible-policy' }; },
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
    '../../../../source/shared/evmNetworks': { EVM_NETWORK_DEFINITIONS: networks.NATIVE_NETWORKS.map(network => ({ id: network.id, name: network.name })) },
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
        tab: shellTab,
        immersive: false,
        navigation: {},
        restoreRoot(next: string) { shellTab = next; },
        select(next: string) { shellTab = next; },
        goBack() {},
      }),
    },
    './NativeSlhDsaManagement': { NativeSlhDsaManagementScreen: 'NativeSlhDsaManagementScreen' },
    './NativeSmartAccountAuthenticator': { NativeSmartAccountAuthenticator: 'NativeSmartAccountAuthenticator' },
    './NativeSmartAccountSend': { NativeSmartAccountSend: 'NativeSmartAccountSend' },
    './NativePortfolio': { NativePortfolio: 'NativePortfolio' },
    './NativeSmartAccountOperation': {
      NativeSmartAccountOperationRoute: 'NativeSmartAccountOperationRoute',
    },
    './NativeConnections': { NativeConnections: 'NativeConnections' },
    './NativeMessageReview': {
      NativeMessageReviewScreen: 'NativeMessageReviewScreen',
    },
    './NativeTransactionReview': {
      NativeTransactionReviewScreen: 'NativeTransactionReviewScreen',
    },
    './NativeSend': { NativeSend: 'NativeSend' },
    './NativeActivity': { NativeActivityScreen: 'NativeActivityScreen' },
    './RealTools': { RealTools: 'RealTools' },
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
    lifecycle: () => lifecycleEvents,
    showTools() { shellTab = 'tools'; },
    showWallet() { shellTab = 'wallet'; },
    guardianReads: () => guardianReads,
    guardianOpens: () => guardianOpens,
    recoveryOpens: () => recoveryOpens,
    authenticatorGuards: () => authenticatorGuards,
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
          smartAccount: { ...account.smartAccount!, isDeployed: true },
        })),
      };
    },
    ready: () => change('ready'),
    readyAtRevision(revision: number) {
      snapshot = { ...snapshot, phase: 'ready', revision, account: { address: '0x' + '11'.repeat(20), network: 'ethereum' } };
      for (const listener of authorityListeners) listener(snapshot);
    },
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

async function mounted(ready = false, smartAccount = false, withPairing = true, canManage = true, handoff = false, slh = false) {
  const f = harness(ready, smartAccount, withPairing, canManage, handoff, slh);
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
        const lifecycleOffset = f.lifecycle().length;
        if (transition === 'background') f.background();
        else f.blur();
        assert.deepEqual(f.lifecycle().slice(lifecycleOffset), ['psbt-background', 'lock']);
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
      assert.equal(route.type, 'NativeSmartAccountOperationRoute');
      // The runtime committed new metadata without an authority phase change.
      f.completeDeployment();
      if (back === 'Android') assert.equal(f.hardwareBack(), false);
      route.props.onBack();
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


test('Smart native, ERC20 and NFT sends use the owned operation route', async () => {
  const f = await mounted(true, true);
  try {
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio');
    assert(portfolio);
    assert.equal(typeof portfolio.props.onSend, 'function');
    assert.equal(typeof portfolio.props.onSendToken, 'function');
    assert.equal(typeof portfolio.props.onSendCollectible, 'function');
    portfolio.props.onSend();
    const route = f.render();
    assert.equal(route.type, 'NativeSmartAccountSend');
    assert.equal(f.hardwareBack(), false);
    route.props.onBack();
    const returned = find(f.render(), node => node.type === 'NativePortfolio');
    assert(returned);
    const token = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 6, name: 'Token', symbol: 'TKN' };
    returned.props.onSendToken(token);
    const tokenRoute = f.render();
    assert.equal(tokenRoute.type, 'NativeSmartAccountSend');
    assert.equal(tokenRoute.props.token, token);
    assert.equal(f.hardwareBack(), false);
    tokenRoute.props.onBack();
    const afterToken = find(f.render(), node => node.type === 'NativePortfolio');
    assert(afterToken);
    const collectible = { contractAddress: '0x6666666666666666666666666666666666666666', tokenStandard: 'ERC-721' };
    afterToken.props.onSendCollectible(collectible);
    const nftRoute = f.render();
    assert.equal(nftRoute.type, 'NativeSmartAccountSend');
    assert.equal(nftRoute.props.collectible, collectible);
    assert.equal(f.hardwareBack(), false);
    nftRoute.props.onBack();
    assert(find(f.render(), node => node.type === 'NativePortfolio'));
    assert.equal(f.exits(), 0);
  } finally { f.dispose(); }
});


test('controlled Smart accounts expose the existing guardian-status tool through the actual wallet Tools branch', async () => {
  const f = await mounted(true, true);
  f.showTools();
  const tools = find(f.render(), (node) => node.type === 'RealTools');
  assert.ok(tools?.props.guardianRecovery);
  assert.equal(tools.props.guardianRecovery.address, '0x' + '11'.repeat(20));
  await tools.props.guardianRecovery.read(new AbortController().signal, () => undefined);
  assert.equal(f.guardianReads(), 1);
  assert.equal(tools.props.guardianRecovery.manage.chainId, 1);
  const draft = { action: 'set', guardian: '0x' + '55'.repeat(20), delaySeconds: 259200, acknowledgedPendingOperationId: null };
  await tools.props.guardianRecovery.manage.open(draft, new AbortController().signal, () => undefined);
  assert.equal(f.guardianOpens(), 1);
  f.ready();
  await assert.rejects(tools.props.guardianRecovery.read(new AbortController().signal, () => undefined), /CANCELLED/);
  assert.equal(f.guardianReads(), 1);
  await assert.rejects(tools.props.guardianRecovery.manage.open(draft, new AbortController().signal, () => undefined), /CANCELLED/);
  assert.equal(f.guardianOpens(), 1);
  f.dispose();
});

test('ordinary controlled EOAs do not gain a guardian-status entry', async () => {
  const f = await mounted(true, false, false);
  f.showTools();
  const tools = find(f.render(), (node) => node.type === 'RealTools');
  assert.ok(tools); assert.equal(tools.props.guardianRecovery, undefined);
  assert.equal(f.guardianReads(), 0); f.dispose();
});

test('a closed or backgrounded controlled Smart tool cannot use its captured read capability', async () => {
  for (const retire of ['background', 'dispose'] as const) {
    const f = await mounted(true, true); f.showTools();
    const tools = find(f.render(), (node) => node.type === 'RealTools')!;
    if (retire === 'background') f.background(); else f.dispose();
    await assert.rejects(tools.props.guardianRecovery.read(new AbortController().signal, () => undefined), /CANCELLED/);
    assert.equal(f.guardianReads(), 0);
    f.dispose();
  }
});


test('guardian pane identity changes after owner retirement even when the restored account revision matches', async () => {
  const f = await mounted(true, true);
  try {
    f.showTools();
    const previous = find(f.render(), node => node.type === 'RealTools')!.props.guardianRecovery;
    f.background();
    f.foreground();
    await settle(); await settle();
    f.readyAtRevision(1);
    const current = find(f.render(), node => node.type === 'RealTools')!.props.guardianRecovery;
    assert.notEqual(current.scope, previous.scope);
    await assert.rejects(previous.read(new AbortController().signal, () => undefined), /CANCELLED/);
    await current.read(new AbortController().signal, () => undefined);
  } finally { f.dispose(); }
});


test('closing a guardian operation refreshes the visible Smart account without an authority event', async () => {
  const f = await mounted(true, true);
  try {
    const original = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(original.props.smartAccount.isDeployed, false);
    f.showTools();
    const tools = find(f.render(), node => node.type === 'RealTools')!;
    f.completeDeployment();
    tools.props.onGuardianClose();
    f.showWallet();
    const refreshed = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(refreshed.props.smartAccount.isDeployed, true);
    assert.equal(refreshed.props.onDeploySmartAccount, undefined);
  } finally { f.dispose(); }
});


test('recovery remains available for a verified Smart account without its original signing owner', async () => {
  const f = await mounted(true, true, false, false);
  try {
    f.showTools();
    const tool = find(f.render(), node => node.type === 'RealTools')!.props.guardianRecovery;
    assert.equal(tool.manage, undefined);
    assert.equal(tool.recovery.hasIntent, true);
    await tool.recovery.open({ kind: 'resume' }, new AbortController().signal, () => undefined);
    assert.equal(f.recoveryOpens(), 1);
    f.background();
    await assert.rejects(tool.recovery.open({ kind: 'resume' }, new AbortController().signal, () => undefined), /CANCELLED/);
    assert.equal(f.recoveryOpens(), 1);
  } finally { f.dispose(); }
});


test('saved recovery transaction handoff selects its payer and returns to the verified Smart target', async () => {
  const f = await mounted(true, true, false, false, true);
  try {
    f.showTools();
    const initial = find(f.render(), node => node.type === 'RealTools')!.props.guardianRecovery;
    const hash = '0x' + 'aa'.repeat(32);
    await initial.recovery.onActivity('hd:60:1', 1, hash);
    const activity = find(f.render(), node => node.type === 'NativeActivityScreen');
    assert(activity);
    assert.equal(activity.props.initialHash, hash);
    const back = find(f.render(), node => node.props.title === 'Return to recovery');
    assert(back);
    back.props.onPress(); await settle();
    const tools = find(f.render(), node => node.type === 'RealTools');
    assert(tools);
    assert.equal(tools.props.guardianRecovery.address, '0x' + '11'.repeat(20));
    assert.equal(tools.props.initialGuardianScope, tools.props.guardianRecovery.scope);
    assert.equal(f.recoveryOpens(), 0);
    await assert.rejects(initial.recovery.onActivity('hd:60:1', 1, hash), /CANCELLED/);
  } finally { f.dispose(); }
});


test('Pali wallet authenticator entry uses runtime eligibility and retains ownership across metadata revisions', async () => {
  const f = await mounted(true, true);
  try {
    assert.equal(find(f.render(), node => node.type === 'NativePortfolio')!.props.onUseWalletAuthenticator, undefined);
    f.completeDeployment();
    f.readyAtRevision(2);
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(typeof portfolio.props.onUseWalletAuthenticator, 'function');
    portfolio.props.onUseWalletAuthenticator();
    const route = f.render();
    assert.equal(route.type, 'NativeSmartAccountAuthenticator');
    await route.props.open(new AbortController().signal, () => undefined);
    assert.equal(f.authenticatorGuards().length, 1);
    f.readyAtRevision(3);
    const refreshedRoute = f.render();
    assert.equal(refreshedRoute.type, 'NativeSmartAccountAuthenticator');
    assert.equal(refreshedRoute.props.open, route.props.open);
    f.authenticatorGuards()[0]!();
    // The leaf drains any pending open before calling this parent callback.
    assert.equal(f.hardwareBack(), false);
    refreshedRoute.props.onBack();
    assert(find(f.render(), node => node.type === 'NativePortfolio'));
    assert.throws(f.authenticatorGuards()[0]!, /CANCELLED/);
    assert.equal(f.exits(), 0);
  } finally { f.dispose(); }
});

test('Pali wallet authenticator entry stays hidden for a runtime-ineligible Smart account', async () => {
  const f = await mounted(true, true, false, false);
  try {
    f.completeDeployment();
    f.readyAtRevision(2);
    assert.equal(find(f.render(), node => node.type === 'NativePortfolio')!.props.onUseWalletAuthenticator, undefined);
  } finally { f.dispose(); }
});

test('Pali wallet authenticator owner is revoked when the wallet backgrounds', async () => {
  const f = await mounted(true, true);
  try {
    f.completeDeployment();
    f.readyAtRevision(2);
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onUseWalletAuthenticator();
    const route = f.render();
    await route.props.open(new AbortController().signal, () => undefined);
    f.background();
    assert.throws(f.authenticatorGuards()[0]!, /CANCELLED/);
    assert.notEqual(f.render().type, 'NativeSmartAccountAuthenticator');
  } finally { f.dispose(); }
});

test('SLH management and Smart send use runtime signer availability independently of the guardian ECDSA gate', async () => {
  const f = await mounted(true, true, false, false, false, true);
  try {
    f.completeDeployment(); f.readyAtRevision(2);
    const portfolio = find(f.render(), node => node.type === 'NativePortfolio')!;
    assert.equal(typeof portfolio.props.onSend, 'function');
    assert.equal(typeof portfolio.props.onManageSlhDsa, 'function');
    assert.equal(portfolio.props.onUseWalletAuthenticator, undefined, 'fixture deliberately withholds that separate target route');
    portfolio.props.onManageSlhDsa(); const route = f.render();
    assert.equal(route.type, 'NativeSlhDsaManagementScreen');
    await route.props.open(new AbortController().signal, () => undefined);
    assert.equal(f.authenticatorGuards().length, 1); f.authenticatorGuards()[0]!();
    assert.equal(f.hardwareBack(), false, 'management leaf owns its drain-before-Back');
    route.props.onBack(); assert(find(f.render(), node => node.type === 'NativePortfolio'));
    assert.throws(f.authenticatorGuards()[0]!, /CANCELLED/);
  } finally { f.dispose(); }
});

test('SLH management is hidden behind the runtime qualification capability and retires on background', async () => {
  const gated = await mounted(true, true, false);
  try { assert.equal(find(gated.render(), node => node.type === 'NativePortfolio')!.props.onManageSlhDsa, undefined); }
  finally { gated.dispose(); }
  const f = await mounted(true, true, false, false, false, true);
  try {
    find(f.render(), node => node.type === 'NativePortfolio')!.props.onManageSlhDsa();
    const route = f.render(); await route.props.open(new AbortController().signal, () => undefined);
    f.background(); assert.throws(f.authenticatorGuards()[0]!, /CANCELLED/);
    assert.notEqual(f.render().type, 'NativeSlhDsaManagementScreen');
  } finally { f.dispose(); }
});
