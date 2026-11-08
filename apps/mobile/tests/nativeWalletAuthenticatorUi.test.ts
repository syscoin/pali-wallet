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
      kind: 'wallet-authenticator',
      command: {
        accountAddress: account,
        chainId: 1,
        ownerAddress: owner,
        sourceAuthHash: hash,
        sourceModule: 'ecdsa',
        target: {
          module: 'ecdsa',
          validator: `0x${'33'.repeat(20)}`,
          data: '0x',
        },
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
  assert.match(text, /Owner threshold · 1/);
  assert.match(text, /rotates the smart account’s ECDSA ownership/);
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
  one(tree, 'Notice', 'Pali wallet already configured');
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
        guard = args.at(-1) as () => void;
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
