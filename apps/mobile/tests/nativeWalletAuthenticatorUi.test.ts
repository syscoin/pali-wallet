import { NativeSigningHandoffs, type NativeSigningHandoff } from '../src/connections/signingHandoff.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { NativeSmartAccountOperationSnapshot } from '../src/smartAccount/operation.ts';

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
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const all = (value: unknown): Element[] => {
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const node = value as Element;
  return [
    node,
    ...node.children.flat(Infinity).flatMap(all),
    ...all(node.props.footer),
  ];
};
const one = (tree: Element, type: string, title?: string) => {
  const nodes = all(tree).filter(
    (node) =>
      node.type === type && (title === undefined || node.props.title === title)
  );
  assert.equal(nodes.length, 1, `${type} ${title ?? ''}`);
  return nodes[0]!;
};

function harness(
  name:
    | 'NativeSmartAccountAuthenticator'
    | 'NativeSmartAccountOperation'
    | 'NativeSmartAccountSend'
    | 'NativeGuardianPolicy'
    | 'NativeSlhDsaManagement',
  language = 'en'
) {
  let cursor = 0;
  const cells: Cell[] = [];
  const effects: (() => void)[] = [];
  const events = new Map<string, Set<(value: string) => void>>();
  let hardware: (() => boolean) | undefined;
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const effect = (
    callback: () => void | (() => void),
    dependencies?: readonly unknown[]
  ) => {
    const current = cell();
    if (
      dependencies &&
      current.dependencies &&
      dependencies.length === current.dependencies.length &&
      dependencies.every((value, index) =>
        Object.is(value, current.dependencies![index])
      )
    )
      return;
    current.dependencies = dependencies;
    effects.push(() => {
      current.cleanup?.();
      current.cleanup = callback() || undefined;
    });
  };
  const react = {
    createElement: (
      type: unknown,
      props: Record<string, any> | null,
      ...children: unknown[]
    ): Element => ({ type, props: props ?? {}, children }),
    useState(initial: any) {
      const current = cell();
      if (!Object.hasOwn(current, 'value'))
        current.value = typeof initial === 'function' ? initial() : initial;
      return [
        current.value,
        (next: any) => {
          current.value =
            typeof next === 'function' ? next(current.value) : next;
        },
      ];
    },
    useMemo(create: () => unknown) {
      const current = cell();
      current.value ??= create();
      return current.value;
    },
    useRef(initial: unknown) {
      const current = cell();
      current.value ??= { current: initial };
      return current.value;
    },
    useCallback(callback: unknown, dependencies: readonly unknown[]) {
      const current = cell();
      if (
        !current.dependencies ||
        dependencies.some(
          (value, index) => !Object.is(value, current.dependencies![index])
        )
      ) {
        current.value = callback;
        current.dependencies = dependencies;
      }
      return current.value;
    },
    useEffect: effect,
    useLayoutEffect: effect,
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) {
      cell();
      return read();
    },
  };
  const native = {
    AppState: {
      currentState: 'active',
      addEventListener(event: string, callback: (value: string) => void) {
        const listeners = events.get(event) ?? new Set();
        listeners.add(callback);
        events.set(event, listeners);
        return { remove: () => listeners.delete(callback) };
      },
    },
    BackHandler: {
      addEventListener(_event: string, callback: () => boolean) {
        hardware = callback;
        return {
          remove: () => {
            if (hardware === callback) hardware = undefined;
          },
        };
      },
    },
    Platform: { OS: 'android' },
    StyleSheet: { create: (styles: unknown) => styles },
    ActivityIndicator: 'ActivityIndicator',
    View: 'View',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
  };
  const dependencies: Record<string, unknown> = {
    react,
    './useDappLedgerConnection': {
      // These policy UI cases have no Ledger owner; real ownership/picker
      // behavior is exercised by nativeSmartLedgerReview.test.ts.
      useOwnedLedgerConnection: () => ({
        blocked: false, showConnect: false, modal: null,
        canApprove: () => true,
      }),
    },
    '../platform/localization': { useNativeTranslation: () => ({ t: (key: string) => {
      const dictionary = JSON.parse(readFileSync(new NodeURL(`../../../source/assets/locales/${language}.json`, import.meta.url), 'utf8'));
      return key.split('.').reduce((value: any, part) => value?.[part], dictionary) ?? key;
    } }) },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': {
      ...Object.fromEntries(
        ['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map(
          (value) => [value, value]
        )
      ),
      colors: {},
      styles: {},
    },
    'ethers/address': { getAddress: (value: string) => value },
    '../../../../source/utils/smartAccount/guardianPolicy': {
      getGuardianRecoveryDelayOptions: () => [259200],
      SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS: 259200,
    },
    './IdleActivityBoundary': { IdlePressable: 'IdlePressable' },
    '../../../../source/utils/nftTokenId': {
      normalizeNftTokenId: (value: string) => value,
    },
    '../portfolio/nativePortfolio': {
      NativePortfolioController: class {
        getSnapshot = () => ({ status: 'available', units: '1' });
        subscribe = () => () => undefined;
        connect = () => () => undefined;
      },
    },
    './NativeTokenMaximum': { NativeTokenMaximum: 'TokenMaximum' },
    './NativeSend': {
      NativeSendInput: 'Input',
      nativeTransferFailure: () => 'Error',
    },
    './NativeSmartAccountOperation': {
      NativeSmartAccountOperationScreen: 'NativeSmartAccountOperationScreen',
    },
    '../../../../source/shared/erc20': {
      formatTokenUnits: (value: string) => value,
      parseErc20Units: (value: string) => value,
    },
    '../core/amounts': { formatBaseUnits: (value: string) => value },
    '../custody/networkContext': {
      getNativeSendContext: () => ({
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18,
      }),
    },
    './NativeTransactionReview': { TransactionDetails: 'TransactionDetails' },
    './guardianPolicyLabels': { guardianDelayLabel: () => '' },
  };
  const module = { exports: {} as Record<string, (props: any) => Element> };
  const source = readFileSync(
    new NodeURL(`../src/screens/${name}.tsx`, import.meta.url),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    AbortController,
    Promise,
    Error,
    require(dependency: string) {
      assert(Object.hasOwn(dependencies, dependency), dependency);
      return dependencies[dependency];
    },
  });
  return {
    render(component: string, props: object) {
      cursor = 0;
      const tree = module.exports[component]!(props);
      effects.splice(0).forEach((run) => run());
      return tree;
    },
    back() {
      assert(hardware);
      return hardware();
    },
    event(event: string, value = '') {
      if (event === 'change') native.AppState.currentState = value;
      for (const listener of events.get(event) ?? []) listener(value);
    },
    dispose() {
      cells.forEach((current) => current.cleanup?.());
    },
  };
}

for (const action of [
  'screen',
  'hardware',
  'background',
  'blur',
  'unmount',
] as const)
  test(`authenticator ${action} retires a pending open and disposes its late result before returning`, async () => {
    const f = harness('NativeSmartAccountAuthenticator');
    const calls: string[] = [];
    let release!: (value: { dispose(): void }) => void;
    let signal!: AbortSignal;
    let check!: () => void;
    const props = {
      open(nextSignal: AbortSignal, nextCheck: () => void) {
        signal = nextSignal;
        check = nextCheck;
        return new Promise<{ dispose(): void }>((resolve) => {
          release = resolve;
        });
      },
      onBack() {
        calls.push('back');
      },
    };
    const tree = f.render('NativeSmartAccountAuthenticator', props);
    await settle();
    if (action === 'screen') one(tree, 'Header').props.onBack();
    else if (action === 'hardware') assert.equal(f.back(), true);
    else if (action === 'background') f.event('change', 'background');
    else if (action === 'blur') f.event('blur');
    else f.dispose();
    assert(signal.aborted);
    assert.throws(check, /CANCELLED/);
    assert.equal(calls.length, 0);
    release({
      dispose() {
        calls.push('dispose');
      },
    });
    await settle();
    assert.deepEqual(
      calls,
      action === 'unmount' ? ['dispose'] : ['dispose', 'back']
    );
    if (action !== 'unmount') {
      assert.notEqual(
        f.render('NativeSmartAccountAuthenticator', props).type,
        'NativeSmartAccountOperationScreen'
      );
      f.dispose();
    }
  });

test('authenticator route publishes only the current owner and closes a ready operation', async () => {
  const f = harness('NativeSmartAccountAuthenticator');
  const calls: string[] = [];
  const controller = {
    dispose() {
      calls.push('dispose');
    },
  };
  const props = {
    async open() {
      return controller;
    },
    onBack() {
      calls.push('back');
    },
  };
  f.render('NativeSmartAccountAuthenticator', props);
  await settle();
  const tree = f.render('NativeSmartAccountAuthenticator', props);
  assert.equal(tree.type, 'NativeSmartAccountOperationScreen');
  assert.equal(tree.props.controller, controller);
  tree.props.onBack();
  await settle();
  assert.deepEqual(calls, ['dispose', 'back']);
  f.dispose();
});

test('a replacement route cannot publish the previous opening or run its Back callback', async () => {
  const f = harness('NativeSmartAccountAuthenticator');
  let release!: (value: { dispose(): void }) => void;
  let oldDisposed = 0;
  const next = { dispose() {} };
  f.render('NativeSmartAccountAuthenticator', {
    open: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    onBack() {
      assert.fail('The previous route has retired');
    },
  });
  await settle();
  f.back();
  const props = {
    async open() {
      return next;
    },
    onBack() {},
  };
  f.render('NativeSmartAccountAuthenticator', props);
  await settle();
  release({
    dispose() {
      oldDisposed++;
    },
  });
  await settle();
  assert.equal(oldDisposed, 1);
  assert.equal(
    f.render('NativeSmartAccountAuthenticator', props).props.controller,
    next
  );
  f.dispose();
});

test('a synchronous open failure presents an unavailable state and can close', async () => {
  const f = harness('NativeSmartAccountAuthenticator');
  let closed = 0;
  const props = {
    open() {
      throw Error('CANCELLED');
    },
    onBack() {
      closed++;
    },
  };
  f.render('NativeSmartAccountAuthenticator', props);
  await settle();
  const tree = f.render('NativeSmartAccountAuthenticator', props);
  one(tree, 'Notice', 'Authenticator unavailable');
  one(tree, 'Button', 'Close').props.onPress();
  await settle();
  assert.equal(closed, 1);
  f.dispose();
});

const account = `0x${'11'.repeat(20)}`;
const owner = `0x${'22'.repeat(20)}`;
const hash = `0x${'ab'.repeat(32)}`;
function operationState(): NativeSmartAccountOperationSnapshot {
  return {
    intent: {
      kind: 'authenticator',
      command: {
        accountAddress: account,
        chainId: 1,
        sourceAuthHash: hash,
        sourceModule: 'ecdsa',
        target: {
          module: 'ecdsa',
          validator: `0x${'33'.repeat(20)}`,
          data: '0x',
        },
        targetModule: { id: 'ecdsa', type: 'validator', address: `0x${'33'.repeat(20)}`, data: '0x', config: { owners: [owner], threshold: 1 } },
        executions: [],
      },
    },
    network: {
      id: 'ethereum',
      chainId: '1',
    } as NativeSmartAccountOperationSnapshot['network'],
    phase: 'authorize',
    revision: 1,
    account,
    maximumPrefundUnits: '3',
    userOperationHash: hash,
    authorization: {
      entryPoint: account,
      nonce: '1',
      initCode: '0x',
      callData: '0x',
    },
    payerReview: null,
    transactionHash: null,
    userOperationSubmissionStarted: false,
    error: null,
  };
}

test('authenticator review discloses full owner, threshold and rotation before authorization', () => {
  const f = harness('NativeSmartAccountOperation');
  let authorized = 0;
  const tree = f.render('NativeSmartAccountOperationContent', {
    state: operationState(),
    onBack() {},
    authorize() {
      authorized++;
    },
    confirmPayer() {},
  });
  const text = all(tree)
    .flatMap((node) => node.children)
    .filter((value) => typeof value === 'string')
    .join(' ');
  assert.match(text, new RegExp(owner));
  assert.match(text, /Approvals required/);
  assert(all(tree).some(node => node.type === 'Text' && node.children.includes(1)));
  assert.match(text, /0x3333333333333333333333333333333333333333/);
  assert.match(one(tree, 'Notice', 'Use this method').props.body, /owner and threshold shown above/);
  one(tree, 'Button', 'Authorize authenticator change').props.onPress();
  assert.equal(authorized, 1);
  assert(
    !all(tree).some((node) =>
      /deployment|transfer|guardian/i.test(node.props.title ?? '')
    )
  );
  f.dispose();
});

test('confirmed authenticator with stale metadata exposes its hash and refresh-only recovery', () => {
  const f = harness('NativeSmartAccountOperation');
  let refreshed = 0;
  const tree = f.render('NativeSmartAccountOperationContent', {
    state: {
      ...operationState(),
      phase: 'complete',
      transactionHash: hash,
      metadataRefresh: 'failed',
    },
    onBack() {},
    authorize() {
      assert.fail('Must not resubmit');
    },
    confirmPayer() {
      assert.fail('Must not resubmit');
    },
    retryMetadata() {
      refreshed++;
    },
  });
  one(tree, 'Notice', 'Authenticator transaction confirmed');
  assert(all(tree).some((node) => node.children.includes(hash)));
  assert(
    all(tree).some((node) => node.children.includes('Confirmed transaction'))
  );
  one(tree, 'Button', 'Refresh account status').props.onPress();
  assert.equal(refreshed, 1);
  assert.deepEqual(
    all(tree)
      .filter((node) => node.type === 'Button')
      .map((node) => node.props.title),
    ['Refresh account status', 'Close']
  );
  f.dispose();
});

test('already-configured authenticator reports its owner without a transaction', () => {
  const f = harness('NativeSmartAccountOperation');
  const tree = f.render('NativeSmartAccountOperationContent', {
    state: {
      ...operationState(),
      phase: 'complete',
      metadataRefresh: 'complete',
    },
    onBack() {},
    authorize() {
      assert.fail();
    },
    confirmPayer() {
      assert.fail();
    },
  });
  one(tree, 'Notice', 'Smart account authenticator configured.');
  assert.deepEqual(
    all(tree)
      .filter((node) => node.type === 'Button')
      .map((node) => node.props.title),
    ['Close']
  );
  f.dispose();
});

for (const route of [
  'authenticator',
  'deployment',
  'send',
  'guardian',
] as const) {
  for (const pendingOpen of [false, true]) {
    test(`${route} Back joins ${
      pendingOpen ? 'late open and ' : ''
    }operation disposal before navigation`, async () => {
      const moduleName =
        route === 'authenticator'
          ? 'NativeSmartAccountAuthenticator'
          : route === 'deployment'
          ? 'NativeSmartAccountOperation'
          : route === 'send'
          ? 'NativeSmartAccountSend'
          : 'NativeGuardianPolicy';
      const component =
        route === 'deployment'
          ? 'NativeSmartAccountOperationRoute'
          : moduleName;
      const f = harness(moduleName);
      const calls: string[] = [];
      let resolveOpen!: (controller: object) => void;
      let finishDisposal!: () => void;
      let guard!: () => void;
      const open = (...args: unknown[]) => {
        guard = (route === 'deployment' ? args[0] : args.at(-1)) as () => void;
        return new Promise<object>((resolve) => {
          resolveOpen = resolve;
        });
      };
      const controller = {
        dispose() {
          calls.push('dispose');
          return new Promise<void>((resolve) => {
            finishDisposal = resolve;
          });
        },
      };
      const props: Record<string, any> = {
        open,
        onBack() {
          calls.push('back');
        },
        context: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
        accountLabel: 'Smart account',
        source: {},
        reader: {},
        account: { address: account, network: 'ethereum', revision: 1 },
        action: 'set',
        address: account,
        networkLabel: 'Ethereum',
        observation: {
          exists: true,
          guardians: [owner],
          threshold: 1,
          delaySeconds: 259200,
          pending: null,
        },
        manage: { chainId: 1, open },
        lifetime: new AbortController().signal,
      };
      let tree = f.render(component, props);
      if (route === 'send') {
        all(tree)
          .find((node) => node.props.label === 'Recipient address')!
          .props.onChange(owner);
        all(tree)
          .find((node) => node.props.label === 'Amount (ETH)')!
          .props.onChange('1');
        tree = f.render(component, props);
        one(tree, 'Button', 'Review transfer').props.onPress();
      } else if (route === 'guardian') {
        one(tree, 'Button', 'Review policy').props.onPress();
      }
      await settle();
      if (!pendingOpen) {
        resolveOpen(controller);
        await settle();
        f.render(component, props);
      }
      assert.equal(f.back(), true);
      assert.throws(guard);
      assert.equal(calls.length, 0);
      if (pendingOpen) resolveOpen(controller);
      await settle();
      assert.deepEqual(calls, ['dispose']);
      finishDisposal();
      await settle();
      assert.deepEqual(calls, ['dispose', 'back']);
      f.dispose();
    });
  }
}

for (const action of ['back', 'background', 'blur', 'unmount'] as const)
  for (const pendingOpen of [false, true])
    test(`Smart operation ${action} aborts its real route signal and drains ${pendingOpen ? 'late' : 'opened'} controllers`, async () => {
      const f = harness('NativeSmartAccountOperation'), events: string[] = [];
      let signal!: AbortSignal, check!: () => void;
      let release!: (operation: object) => void, finishDisposal!: () => void;
      const controller = {
        background() {assert.equal(signal.aborted, false); events.push('background');},
        dispose() {
          assert.equal(signal.aborted, true);
          events.push('dispose');
          return new Promise<void>(resolve => {finishDisposal = resolve;});
        },
        prepare() {assert.fail('The route must render the separate review screen');},
        authorize() {assert.fail('Continuing must not authorize');},
      };
      const props = {
        open(guard: () => void, lifetime: AbortSignal) {
          check = guard; signal = lifetime;
          return new Promise<object>(resolve => {release = resolve;});
        },
        onBack() {events.push('back');},
      };
      f.render('NativeSmartAccountOperationRoute', props);
      await settle();
      assert.equal(signal.aborted, false); check();
      if (!pendingOpen) {release(controller); await settle(); f.render('NativeSmartAccountOperationRoute', props);}
      if (action === 'back') f.back();
      else if (action === 'background') f.event('change', 'background');
      else if (action === 'blur') f.event('blur');
      else f.dispose();
      assert.equal(signal.aborted, true);
      assert.throws(check, /DEPLOYMENT_EXPIRED/);
      if (pendingOpen) release(controller);
      await settle();
      const captured = !pendingOpen && (action === 'background' || action === 'blur');
      assert.deepEqual(events, [...(captured ? ['background'] : []), 'dispose']);
      finishDisposal(); await settle();
      assert.deepEqual(events, [...(captured ? ['background'] : []), 'dispose', ...(action === 'unmount' ? [] : ['back'])]);
      f.dispose();
    });

function slhManager(overrides: Record<string, unknown> = {}) {
  const key = { keyId: 'exact-prepared-key', pkRoot: `0x${'44'.repeat(32)}`, pkSeed: `0x${'33'.repeat(32)}`, signatureCount: 7, signatureLimit: 4096 };
  return { key, manager: { accountAddress: account, networkName: 'Ethereum', isDeployed: true, installedKeys: [],
    async readPrepared() { return [key]; }, prepareFresh() { assert.fail('Prepared state must be reused'); },
    hydrateInstalled() { assert.fail('No installed key'); }, rebuildInstalled() { assert.fail('No installed key'); },
    async rebuildPrepared() { return key; }, openInstall() { assert.fail('No assent'); }, ...overrides } };
}

test('SLH management reviews the exact prepared key once and drains a late operation after Back', async () => {
  const f = harness('NativeSlhDsaManagement'), held = Promise.withResolvers<any>(), drained = Promise.withResolvers<void>();
  const calls: string[] = []; let capturedSignal!: AbortSignal, capturedCheck!: () => void;
  const { key, manager } = slhManager({ openInstall(keyId: string, signal: AbortSignal, check: () => void) {
    assert.equal(keyId, 'exact-prepared-key'); capturedSignal = signal; capturedCheck = check; calls.push('open'); return held.promise;
  } });
  const props = { open: async () => manager, onBack: () => calls.push('back') };
  f.render('NativeSlhDsaManagementScreen', props); await settle();
  const tree = f.render('NativeSlhDsaManagementScreen', props);
  assert(all(tree).some(node => node.props.accessibilityLabel === 'SLH-DSA 7 / 4096'));
  assert(all(tree).some(node => node.children.includes(key.pkRoot)));
  const use = one(tree, 'Button', 'Use this method'); use.props.onPress(); use.props.onPress(); await settle();
  assert.deepEqual(calls, ['open']);
  one(tree, 'Header').props.onBack(); assert(capturedSignal.aborted); assert.throws(capturedCheck, /CANCELLED/);
  held.resolve({ dispose() { calls.push('dispose'); return drained.promise; } }); await settle();
  assert.deepEqual(calls, ['open', 'dispose']);
  drained.resolve(); await settle(); assert.deepEqual(calls, ['open', 'dispose', 'back']);
  assert.notEqual(f.render('NativeSlhDsaManagementScreen', props).type, 'NativeSmartAccountOperationScreen'); f.dispose();
});

for (const close of ['hardware', 'background', 'unmount'] as const) test(`SLH management ${close} refuses late status and waits for its owned read`, async () => {
  const f = harness('NativeSlhDsaManagement'), held = Promise.withResolvers<any>();
  const calls: string[] = []; let signal!: AbortSignal, guard!: () => void;
  const props = { open(nextSignal: AbortSignal, check: () => void) { signal = nextSignal; guard = check; return held.promise; }, onBack() { calls.push('back'); } };
  f.render('NativeSlhDsaManagementScreen', props); await settle();
  if (close === 'hardware') f.back(); else if (close === 'background') f.event('change', 'background'); else f.dispose();
  assert(signal.aborted); assert.throws(guard, /CANCELLED/); assert.deepEqual(calls, []);
  held.resolve(slhManager({ readPrepared() { assert.fail('Retired opener cannot start status work'); } }).manager);
  await settle(); assert.deepEqual(calls, close === 'unmount' ? [] : ['back']);
  if (close !== 'unmount') f.dispose();
});

test('SLH management cancels setup progress, prevents double preparation and joins background retirement', async () => {
  const f = harness('NativeSlhDsaManagement'), held = Promise.withResolvers<void>();
  let progress!: (value: {completed: number; total: number}) => void, prepared = 0, backed = 0;
  const { manager } = slhManager({ async readPrepared() { return []; }, async prepareFresh(callback: typeof progress) { prepared++; progress = callback; await held.promise; } });
  const props = { open: async () => manager, onBack() { backed++; } };
  f.render('NativeSlhDsaManagementScreen', props); await settle();
  const create = one(f.render('NativeSlhDsaManagementScreen', props), 'Button', 'Create');
  create.props.onPress(); create.props.onPress(); await settle(); assert.equal(prepared, 1);
  progress({ completed: 1, total: 4 });
  assert(all(f.render('NativeSlhDsaManagementScreen', props)).some(node => node.children.includes(25) && node.children.includes('%')));
  f.event('change', 'background'); assert.equal(backed, 0); assert.throws(() => progress({completed: 2,total: 4}), /CANCELLED/);
  held.resolve(); await settle(); assert.equal(backed, 1); assert.equal(prepared, 1); f.dispose();
});

test('SLH management recreates the captured owner only after the operation Back drains', async () => {
  const f = harness('NativeSlhDsaManagement'), held = Promise.withResolvers<void>(); let opens = 0, disposed = 0, rebuilds = 0; const guards: (() => void)[] = [];
  const operation = { dispose() { disposed++; return held.promise; } };
  const props = { open: async (_signal: AbortSignal, check: () => void) => { opens++; guards.push(check); return slhManager({ async openInstall() { return operation; }, async rebuildPrepared() { rebuilds++; return slhManager().key; } }).manager; }, onBack() { assert.fail('Return to status stays in management'); } };
  f.render('NativeSlhDsaManagementScreen', props); await settle();
  const original = f.render('NativeSlhDsaManagementScreen', props);
  const oldUse = one(original, 'Button', 'Use this method').props.onPress, oldRebuild = one(original, 'Button', 'Regenerate local signer').props.onPress, oldBack = one(original, 'Header').props.onBack;
  oldUse(); await settle();
  const review = f.render('NativeSlhDsaManagementScreen', props); assert.equal(review.type, 'NativeSmartAccountOperationScreen'); assert.equal(review.props.controller, operation);
  review.props.onBack(); await settle(); assert.equal(disposed, 1); assert.equal(opens, 1);
  held.resolve(); await settle(); f.render('NativeSlhDsaManagementScreen', props); await settle();
  assert.equal(opens, 2); assert.notEqual(f.render('NativeSlhDsaManagementScreen', props).type, 'NativeSmartAccountOperationScreen');
  guards[1]!(); review.props.onBack(); oldUse(); oldRebuild(); oldBack(); await settle(); f.render('NativeSlhDsaManagementScreen', props); await settle();
  assert.equal(opens, 2); assert.equal(disposed, 1); assert.equal(rebuilds, 0); guards[1]!(); f.dispose();
});

test('SLH management never invents fresh state for a missing installed key', async () => {
  const f = harness('NativeSlhDsaManagement'); let calls = 0;
  const props = { open: async () => slhManager({ installedKeys: [{keyId:'installed-key'}], async readPrepared() { return []; }, async hydrateInstalled() { calls++; throw Error('missing encrypted state'); } }).manager, onBack() {} };
  f.render('NativeSlhDsaManagementScreen', props); await settle();
  const tree = f.render('NativeSlhDsaManagementScreen', props);
  assert.equal(calls, 1); assert(!all(tree).some(node => node.type === 'Button' && ['Create', 'Use this method'].includes(node.props.title)));
  assert(all(tree).some(node => node.children.includes('installed-key'))); f.dispose();
});

test('SLH target review discloses exact public fields without an ECDSA owner claim', () => {
  const f = harness('NativeSmartAccountOperation'), state = operationState();
  if (state.intent.kind !== 'authenticator') throw Error('Wrong fixture');
  const root = `0x${'44'.repeat(32)}`, seed = `0x${'33'.repeat(32)}`;
  const tree = f.render('NativeSmartAccountOperationContent', { state: { ...state, intent: { ...state.intent, command: { ...state.intent.command,
    target: { module:'slh-dsa',validator: account,data:'0x' }, targetModule: {id:'slh-dsa',type:'validator',address:account,config:{pkRoot:root,pkSeed:seed}} } } }, onBack() {}, authorize() {}, confirmPayer() {} });
  const text = all(tree).flatMap(node => node.children).filter(value => typeof value === 'string').join(' ');
  assert(text.includes(root)); assert(text.includes(seed)); assert(!text.includes(owner));
  assert.match(one(tree, 'Notice', 'Use this method').props.body, /post-quantum approval/); f.dispose();
});

for (const language of ['en','es','pt','fr','de','zh','ja','ko','ru']) test(`SLH management uses the canonical packaged ${language} dictionary`, async () => {
  const f = harness('NativeSlhDsaManagement', language);
  const dictionary = JSON.parse(readFileSync(new NodeURL(`../../../source/assets/locales/${language}.json`, import.meta.url), 'utf8'));
  const props = { open: async () => slhManager().manager, onBack() {} };
  f.render('NativeSlhDsaManagementScreen', props); await settle();
  const tree = f.render('NativeSlhDsaManagementScreen', props);
  one(tree, 'Header', dictionary.settings.slhDsaAuthenticator);
  one(tree, 'Button', dictionary.settings.useSmartAccountValidator);
  one(tree, 'Button', dictionary.settings.slhDsaRegenerateLocalSigner);
  one(tree, 'Button', dictionary.buttons.close);
  assert(!all(tree).some(node => typeof node.props.title === 'string' && /^(settings|buttons)\./.test(node.props.title))); f.dispose();
});

test('SLH payer review describes the exact approved target without claiming ECDSA owner rotation', () => {
  const f = harness('NativeSmartAccountOperation'), state = operationState();
  if (state.intent.kind !== 'authenticator') throw Error('Wrong fixture');
  const tree = f.render('NativeSmartAccountOperationContent', {state:{...state,phase:'review-fee',payerReview:{id:1,purpose:'submit-operation',transaction:{from:owner,to:account,value:'0',data:'0x',chainId:'1',nonce:'0',gasLimit:'21000',type:2,maxFeePerGas:'2',maxPriorityFeePerGas:'1'},maximumFeeUnits:'42000',coveredFeeUnits:'0',maximumTotalUnits:'42000'},
    intent:{...state.intent,command:{...state.intent.command,target:{module:'slh-dsa',validator:account,data:'0x'},targetModule:{id:'slh-dsa',type:'validator',address:account,config:{pkRoot:hash,pkSeed:hash}}}}},onBack(){},authorize(){},confirmPayer(){} });
  const notice = one(tree,'Notice','Submit the authorized authenticator change');
  assert.equal(notice.props.body,'Saving updates your account on-chain and may require a network fee.');
  assert(!notice.props.body.includes('Pali wallet owner')); one(tree,'Button','Confirm authenticator change'); f.dispose();
});


for (const action of ['header-event', 'close-event', 'review-event', 'app-background', 'android-blur'] as const)
  test(`Smart route ${action} distinguishes a real press payload from an explicit Suite departure`, async () => {
    const f = harness('NativeSmartAccountOperation'), job = {}, canceled: object[] = [], events: string[] = [];
    let signal!: AbortSignal, release!: (operation: object) => void, handoff!: NativeSigningHandoff;
    const manager = new NativeSigningHandoffs({ async cancel(value) { canceled.push(value); }, changed() {} });
    const controller = {
      background() { assert.equal(signal.aborted, false); events.push('background'); assert(manager.background(handoff)); },
      async dispose() {
        assert.equal(signal.aborted, true); events.push('dispose');
        if (!handoff.isSuspended()) canceled.push(job);
      },
      prepare() { assert.fail('The route must render a separate review'); },
      authorize() { assert.fail('Back and Continue must not sign'); },
    };
    const props = {
      open(_check: () => void, lifetime: AbortSignal) { signal = lifetime; return new Promise<object>(resolve => { release = resolve; }); },
      onBack() { events.push('back'); },
    };
    try {
      const pending = f.render('NativeSmartAccountOperationRoute', props); await settle();
      handoff = manager.captureLocal({ id: 'event-owned-request', expiresAt: Date.now() + 60000, order: 0,
        action: { kind: 'operation', intent: { kind: 'deploy' } },
        scope: { wallet: 'public-wallet', unlockGeneration: 1, accountId: 'smart:60:0', address: account, type: 'SmartAccount', xpub: 'public-xpub', registration: 'full-network', signing: 'public-owner-policy', trezor: true },
        assertCurrent() { assert.equal(signal.aborted, false); }, eligible: () => true, drain: async () => undefined, retire() {},
      });
      // A real Suite launch is armed before either a manual press or AppState event.
      handoff.beforeSuiteOpen(Date.now() + 45000, job)(true);
      release(controller); await settle();
      const loaded = f.render('NativeSmartAccountOperationRoute', props);
      const press = { nativeEvent: { locationX: 12, locationY: 13, pageX: 24, pageY: 25, target: 7, timestamp: Date.now(), touches: [], changedTouches: [] },
        currentTarget: 7, target: 7, preventDefault() {}, stopPropagation() {}, persist() {} };
      if (action === 'header-event') one(pending, 'Header').props.onBack(press);
      else if (action === 'close-event') one(pending, 'Button', 'Close').props.onPress(press);
      else if (action === 'review-event') loaded.props.onBack(press);
      else if (action === 'app-background') f.event('change', 'background');
      else f.event('blur');
      await settle(); assert.equal(signal.aborted, true);
      const background = action === 'app-background' || action === 'android-blur';
      assert.deepEqual(events, [...(background ? ['background'] : []), 'dispose', 'back']);
      assert.equal(manager.localDescriptor(handoff.id) !== null, background);
      assert.deepEqual(canceled, background ? [] : [job]);
    } finally { manager.cancelLocal(); await manager.retired(); f.dispose(); }
  });
