import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { getAddress } from 'ethers/address';
import { createNativePrivateAuthenticationScope, createNativePrivateAuthenticationChild,
  bindNativePrivateAuthentication, bindNativePrivateAuthenticationChild, withNativePrivateAuthentication,
  type NativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';

const require = createRequire(import.meta.url);
const React: typeof import('react') = require('react');
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('real React StrictMode gives Withdrawal a fresh effect scope and preserves its parent', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const globals = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  // The workspace also has React 18 DOM declarations for extension tests.
  // This harness loads the mobile React 19 pair and types its root with that ReactNode.
  assert.equal(require('react-dom/package.json').version, require('react/package.json').version);
  const { createRoot }: { createRoot(container: Element): {
    render(children: import('react').ReactNode): void; unmount(): void;
  } } = require('react-dom/client');
  const children = ({ children }: any) => React.createElement('div', null, children);
  const listeners = new Map<string, Set<(value: string) => void>>();
  let state = 'active';
  const subscribe = (event: string, listener: (value: string) => void) => {
    const entries = listeners.get(event) ?? new Set(); entries.add(listener); listeners.set(event, entries);
    return () => entries.delete(listener);
  };
  const prompt = new DeviceUnlockPrompt({ state: () => state, subscribe: listener => {
    const remove = ['change', 'blur', 'focus'].map(event => subscribe(event, listener));
    return () => remove.forEach(value => value());
  } });
  const parent = createNativePrivateAuthenticationScope();
  const parentBinding = bindNativePrivateAuthentication(parent, { assertCurrent() {}, isPromptActive: () => prompt.isActive() });
  const created: NativePrivateAuthenticationScope[] = [];
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let opens = 0, disposed = 0, backs = 0;
  const snapshot = Object.freeze({ phase: 'idle', canSign: true, restored: false, relayers: [], progress: null,
    review: null, result: null, status: null, noteStatus: null, checking: false, error: null });
  const controller = { getSnapshot: () => snapshot, subscribe: () => () => undefined,
    async dispose() { disposed++; }, async refresh() {}, async loadRelayers() {} };
  const imports: Record<string, unknown> = {
    react: React,
    'react-native': { AppState: { get currentState() { return state; }, addEventListener(event: string, callback: (value: string) => void) { return { remove: subscribe(event, callback) }; } },
      Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value }, Keyboard: { dismiss() {} },
      BackHandler: { addEventListener: () => ({ remove() {} }) }, View: children, KeyboardAvoidingView: children },
    'react-native-safe-area-context': { SafeAreaView: children }, 'ethers/address': { getAddress },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationChild(scope: NativePrivateAuthenticationScope) {
      const child = createNativePrivateAuthenticationChild(scope); created.push(child); return child;
    } },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../core/amounts': { formatBaseUnits: (value: string) => value },
    './IdleActivityBoundary': { IdlePressable: children, IdleTextInput: () => React.createElement('input') },
    './PinEntry': { PinField: () => React.createElement('input') },
    '../ui': { Button: ({ title, onPress, disabled }: any) => React.createElement('button', { onClick: onPress, disabled }, title),
      Header: ({ title, onBack }: any) => React.createElement('header', null, React.createElement('button', { onClick: onBack }, 'Back'), title),
      Screen: ({ children, footer }: any) => React.createElement('section', null, children, footer),
      Card: children, Text: children, colors: {}, styles: {} },
  };
  const module = { exports: {} as { NativePrivateWithdrawal: React.ComponentType<any> } };
  const code = ts.transpileModule(readFileSync(fileURLToPath(new NodeURL('../src/screens/NativePrivateWithdrawal.tsx', import.meta.url)), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, Error, AbortController, Date, setTimeout, clearTimeout,
    require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(module.exports.NativePrivateWithdrawal, {
        note: { amount: '1', createdAt: 1 }, authentication: parent, onBack() { backs++; },
        async open(signal: AbortSignal, check: () => void, child: NativePrivateAuthenticationScope) {
          opens++; const binding = bindNativePrivateAuthenticationChild(parentBinding, child);
          return withNativePrivateAuthentication(binding, signal, () => undefined, async () => prompt.run(async () => {
            entered.resolve(); await release.promise; check(); return controller;
          }));
        },
      })));
      await tick();
    });
    await entered.promise;
    assert.equal(created.length, 2, 'StrictMode replays the real effect');
    assert.equal(opens, 1, 'retired first setup never opens a host operation');
    assert.throws(() => bindNativePrivateAuthenticationChild(parentBinding, created[0]!), /CANCELLED/);
    assert.equal(parent.isAuthenticating(), true);
    await React.act(async () => {
      state = 'inactive'; for (const listener of [...listeners.get('change') ?? []]) listener(state);
      for (const listener of [...listeners.get('blur') ?? []]) listener('blur');
      await tick();
    });
    assert.equal(backs, 0); assert.equal(parent.isAuthenticating(), true);
    await React.act(async () => {
      state = 'active'; for (const listener of [...listeners.get('change') ?? []]) listener(state);
      for (const listener of [...listeners.get('focus') ?? []]) listener('focus');
      release.resolve(); await tick();
    });
    assert.equal(parent.isAuthenticating(), false);
    assert.doesNotMatch(container.textContent, /Could not open/);
    await React.act(async () => root.unmount());
    assert.equal(disposed, 1);
    assert.throws(() => bindNativePrivateAuthenticationChild(parentBinding, created[1]!), /CANCELLED/);
    const next = createNativePrivateAuthenticationChild(parent);
    assert.doesNotThrow(() => bindNativePrivateAuthenticationChild(parentBinding, next)); next.retire();
  } finally {
    release.resolve(); parent.retire();
    dom.window.close();
    for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (globals[key]) Object.defineProperty(globalThis, key, globals[key]!);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
