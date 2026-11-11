import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { nativeTranslationFixture } from './localizationFixture.ts';

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
function screen(name: string, props: Record<string, unknown>) {
  const cells: Cell[] = [],
    effects: (() => void)[] = [];
  let cursor = 0;
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    createElement: (
      type: unknown,
      attributes: object | null,
      ...children: unknown[]
    ) => ({ type, props: attributes ?? {}, children }),
    useState(initial: unknown) {
      const entry = cell();
      if (!Object.hasOwn(entry, 'value')) entry.value = typeof initial === 'function' ? initial() : initial;
      return [
        entry.value,
        (value: unknown) => {
          entry.value =
            typeof value === 'function' ? value(entry.value) : value;
        },
      ];
    },
    useRef(initial: unknown) {
      const entry = cell();
      entry.value ??= { current: initial };
      return entry.value;
    },
    useCallback(value: unknown) {
      cell();
      return value;
    },
    useLayoutEffect(
      callback: () => void | (() => void),
      dependencies?: readonly unknown[]
    ) {
      const entry = cell();
      if (
        dependencies &&
        entry.dependencies &&
        dependencies.every((value, i) => value === entry.dependencies![i])
      )
        return;
      entry.dependencies = dependencies;
      effects.push(() => {
        entry.cleanup?.();
        entry.cleanup = callback() || undefined;
      });
    },
  };
  const dependencies = {
    '../platform/localization': nativeTranslationFixture,
    react,
    'react-native': { StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': {
      colors: {},
      ...Object.fromEntries(
        ['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(
          (name) => [name, name]
        )
      ),
    },
    './TrustedSiteLookup': { TrustedSiteLookup: 'TrustedSiteLookup' },
    './WatchGuardianRecovery': {
      WatchGuardianRecovery: 'WatchGuardianRecovery',
    },
    './NativeConnections': { NativeConnections: 'NativeConnections' },
    './NativeGuardianPolicy': { NativeGuardianPolicy: 'NativeGuardianPolicy' },
    './NativeGuardianRecovery': { NativeGuardianRecovery: 'NativeGuardianRecovery' },
  };
  const module = { exports: {} as Record<string, (props: object) => Element> };
  const source = readFileSync(
    new NodeURL(`../src/screens/${name}.tsx`, import.meta.url),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    AbortController,
    require(key: keyof typeof dependencies) {
      assert.ok(Object.hasOwn(dependencies, key), key);
      return dependencies[key];
    },
  });
  return {
    render() {
      cursor = 0;
      const tree = module.exports[name]!(props);
      effects.splice(0).forEach((run) => run());
      return tree;
    },
    dispose() {
      cells.forEach((entry) => entry.cleanup?.());
    },
  };
}
function all(value: unknown): Element[] {
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const node = value as Element;
  return [node, ...node.children.flat(Infinity).flatMap(all)];
}
const text = (tree: Element) =>
  all(tree)
    .flatMap((node) => node.children)
    .filter((value) => typeof value === 'string')
    .join(' ');
const action = (tree: Element, name: string) => {
  const node = all(tree).find((node) => node.props.title === name);
  assert.ok(node, name);
  node.props.onPress();
};
const navigation = { registerBack: () => () => {}, setImmersive() {} };

test('guardian status exposes recovery alerts after policy observation and retires old actions', async () => {
  const lifetime = new AbortController();
  let opened = 0;
  const view = screen('WatchGuardianRecovery', {
    address: '0x' + '11'.repeat(20), networkLabel: 'Ethereum',
    lifetime: lifetime.signal, onBack() {},
    recovery: { hasIntent: false, async openRecoveryAlerts() { opened++; } },
    async read() {
      return { status: 'observed', observation: { exists: true, active: null, observedBlock: { number: 42 } } };
    },
  });
  const label = nativeTranslationFixture.useNativeTranslation().t('settings.smartAccountRecoveryEmailAlerts');
  assert.ok(!all(view.render()).some((node) => node.props.title === label));
  action(view.render(), 'Check status');
  await new Promise<void>((done) => setImmediate(done));
  const button = all(view.render()).find((node) => node.props.title === label);
  assert.ok(button);
  button.props.onPress();
  assert.equal(opened, 1);
  lifetime.abort();
  button.props.onPress();
  assert.equal(opened, 1);
  view.dispose();
  button.props.onPress();
  assert.equal(opened, 1);
});

for (const available of [false, true])
  test(`Tools guardian entry follows the supplied account capability (${available})`, () => {
    let reads = 0;
    const tool = {
      scope: '1:smart:ethereum',
      address: '0x' + '11'.repeat(20),
      async read() {
        reads++;
        return { status: 'no-compatible-policy' };
      },
    };
    const tools = screen('RealTools', {
      accountLabel: 'Smart account',
      networkLabel: 'Ethereum',
      watchOnly: false,
      navigation,
      onAccounts() {},
      onBack() {},
      guardianRecovery: available ? tool : undefined,
    });
    const tree = tools.render();
    assert.equal(all(tree).find(node => node.type === 'Header')?.props.onBack, undefined, 'Tools root has no redundant Back arrow');
    assert.equal(
      all(tree).some((node) => node.props.title === 'Guardian recovery'),
      available
    );
    assert.equal(reads, 0);
    if (available) {
      action(tree, 'Guardian recovery');
      const child = tools.render();
      assert.equal(child.type, 'WatchGuardianRecovery');
      assert.equal(child.props.read, tool.read);
      assert.equal(child.props.address, tool.address);
      const status = screen('WatchGuardianRecovery', child.props);
      assert.match(text(status.render()), /this account/);
      assert.equal(reads, 0);
      status.dispose();
    }
    tools.dispose();
  });

test('actual status screen reports absent policy and a closed pane discards its late read', async () => {
  let resolve!: (value: unknown) => void;
  let signal!: AbortSignal;
  let closes = 0;
  const tools = screen('RealTools', {
    accountLabel: 'Smart account',
    networkLabel: 'Ethereum',
    watchOnly: false,
    navigation,
    onAccounts() {},
    onBack() {},
    onGuardianClose() { closes++; },
    guardianRecovery: {
      scope: '1:smart:ethereum',
      address: '0x' + '11'.repeat(20),
      read(owner: AbortSignal) {
        signal = owner;
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
  });
  action(tools.render(), 'Guardian recovery');
  const child = tools.render();
  const status = screen('WatchGuardianRecovery', child.props);
  action(status.render(), 'Check status');
  assert.match(text(status.render()), /Checking recovery status/);
  child.props.onBack();
  assert.equal(signal.aborted, true);
  assert.equal(closes, 1);
  resolve({ status: 'no-compatible-policy' });
  await new Promise<void>((done) => setImmediate(done));
  assert.doesNotMatch(text(status.render()), /no smart account code/);
  assert.notEqual(tools.render().type, 'WatchGuardianRecovery');
  status.dispose();
  tools.dispose();

  const current = screen('WatchGuardianRecovery', {
    address: '0x' + '11'.repeat(20),
    networkLabel: 'Ethereum',
    lifetime: new AbortController().signal,
    onBack() {},
    async read() {
      return { status: 'no-compatible-policy' };
    },
  });
  action(current.render(), 'Check status');
  await new Promise<void>((done) => setImmediate(done));
  assert.match(text(current.render()), /No compatible guardian policy/);
  current.dispose();
});

test('Tools Back delegates to the active guardian child before closing its lifetime', () => {
  let hardware!: () => boolean;
  let requested = 0;
  let closed = 0;
  const tools = screen('RealTools', {
    accountLabel: 'Smart account', networkLabel: 'Ethereum', watchOnly: false,
    onAccounts() {}, onBack() {}, onGuardianClose() { closed++; },
    navigation: { registerBack(handler: () => boolean) { hardware = handler; return () => {}; }, setImmersive() {} },
    guardianRecovery: { scope: 'guardian-owner', address: '0x' + '11'.repeat(20), async read() { return { status: 'no-compatible-policy' }; } },
  });
  action(tools.render(), 'Guardian recovery');
  const guardian = tools.render();
  assert.equal(guardian.type, 'WatchGuardianRecovery');
  const remove = guardian.props.registerBack(() => { requested++; });
  assert.equal(hardware(), true);
  assert.equal(requested, 1);
  assert.equal(closed, 0);
  assert.equal(guardian.props.lifetime.aborted, false);
  guardian.props.onBack();
  assert.equal(closed, 1);
  assert.equal(guardian.props.lifetime.aborted, true);
  remove();
  tools.dispose();
});
