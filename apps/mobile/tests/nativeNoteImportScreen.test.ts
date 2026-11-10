import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createNativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';

type Element = {
  type: unknown;
  props: Record<string, any>;
  children: unknown[];
};
const sample = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
function fixture() {
  let index = 0,
    backs = 0,
    imports = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slots: any[] = [],
    effects: (() => void)[] = [];
  const events = new Map<string, () => void>();
  const equal = (left: unknown[], right: unknown[]) =>
    left.length === right.length &&
    left.every((value, i) => value === right[i]);
  const react = {
    createElement: (type: unknown, props: object, ...children: unknown[]) => ({
      type,
      props: props ?? {},
      children,
    }),
    Fragment: 'Fragment',
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        (value: unknown) => {
          slots[slot] = value;
        },
      ];
    },
    useRef(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useCallback(callback: () => void, deps: unknown[]) {
      const slot = index++;
      if (!slots[slot] || !equal(slots[slot].deps, deps))
        slots[slot] = { deps, callback };
      return slots[slot].callback;
    },
    useLayoutEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const slot = index++,
        previous = slots[slot];
      if (!previous || !equal(previous.deps, deps)) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const importsByName: Record<string, unknown> = {
    react,
    'react-native': {
      AppState: {
        currentState: 'active',
        addEventListener(name: string, action: () => void) {
          events.set(name, action);
          return { remove: () => events.delete(name) };
        },
      },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Keyboard: { dismiss() {} },
      KeyboardAvoidingView: 'Keyboard',
      Platform: { OS: 'android' },
      StyleSheet: { create: (value: unknown) => value },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '../ui': {
      Button: 'Button',
      Notice: 'Notice',
      Screen: 'Screen',
      Text: 'Text',
      Header: 'Header',
      colors: {},
      styles: {},
    },
    './IdleActivityBoundary': { IdleTextInput: 'Input' },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
  };
  const module = { exports: {} as Record<string, any> };
  const source = readFileSync(
    new NodeURL('../src/screens/NativeNoteImport.tsx', import.meta.url),
    'utf8'
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name: string) => {
        assert(name in importsByName, name);
        return importsByName[name];
      },
    }
  );
  const openImport = async (check: () => void) => ({
    async importNote(note: string) {
      check();
      assert.equal(note, sample);
      imports++;
      await pending;
      check();
      return { amount: '1', phase: 'verified' as const };
    },
    async dispose() {},
  });
  return {
    get backs() {
      return backs;
    },
    get imports() {
      return imports;
    },
    release,
    blur() {
      events.get('blur')?.();
    },
    render(): Element {
      index = 0;
      const tree = module.exports.NativeNoteImport({
        openImport,
        onBack: () => {
          backs++;
        },
      });
      while (effects.length) effects.shift()!();
      return tree;
    },
  };
}
function nodes(value: any): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  return [value, ...value.children.flatMap(nodes), ...nodes(value.props.footer)];
}
const button = (tree: Element, title: string) =>
  nodes(tree).find(
    (node) => node.type === 'Button' && node.props.title === title
  )!;
const input = (tree: Element) =>
  nodes(tree).find((node) => node.type === 'Input')!;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test('Android blur closes the mounted import route and stale callbacks cannot import after focus returns', () => {
  const f = fixture();
  input(f.render()).props.onChangeText(sample);
  const previous = f.render();
  f.blur();
  assert.equal(f.backs, 1);
  button(previous, 'Import note').props.onPress();
  input(previous).props.onChangeText(sample);
  assert.equal(f.imports, 0);
  assert.equal(input(f.render()).props.value, '');
});

test('Back during verification clears text and rejects a late saved result', async () => {
  const f = fixture();
  input(f.render()).props.onChangeText(sample);
  button(f.render(), 'Import note').props.onPress();
  await flush();
  assert.equal(f.imports, 1);
  const waiting = f.render();
  assert.equal(input(waiting).props.value, '');
  button(waiting, 'Cancel').props.onPress();
  f.release();
  await flush();
  assert.equal(f.backs, 1);
  assert.equal(
    nodes(f.render()).some((node) => node.type === 'Notice'),
    false
  );
});
