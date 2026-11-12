import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
import type { NativeTokenSnapshot } from '../src/portfolio/nativeTokens.ts';

const require = createRequire(import.meta.url);
const React: typeof import('react') = require('react');
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('direct token detail distinguishes loading, retryable inventory failure and a confirmed missing token', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot }: { createRoot(container: Element): { render(children: import('react').ReactNode): void; unmount(): void } } = require('react-dom/client');
  const children = ({ children }: any) => React.createElement('div', null, children);
  const imports: Record<string, unknown> = {
    '../platform/localization': nativeTranslationFixture,
    react: React,
    '../platform/balancePrivacy': { useBalancePrivacy: () => ({ hidden: false }), HIDDEN_BALANCE: 'Hidden' },
    './IdleActivityBoundary': { IdleTextInput: () => React.createElement('input'), IdlePressable: children },
    'react-native': { View: children, ActivityIndicator: ({ accessibilityLabel }: any) => React.createElement('div', { role: 'status' }, accessibilityLabel),
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, StyleSheet: { create: (value: unknown) => value } },
    '../../../../source/shared/erc20': { formatTokenUnits },
    '../../../../source/utils/nftTokenId': {}, '../portfolio/erc20Metadata': {},
    '../portfolio/AssetMarketCard': { AssetMarketCard: children },
    '../ui': { ...Object.fromEntries(['Card', 'Coin', 'Icon', 'IconButton', 'Text'].map(name => [name, children])),
      Notice: ({ title, body }: any) => React.createElement('div', null, title, body),
      Button: ({ title, onPress, disabled }: any) => React.createElement('button', { onClick: onPress, disabled }, title), colors: {}, styles: {} },
  };
  const module = { exports: {} as { NativeTokens: React.ComponentType<any> } };
  const code = ts.transpileModule(readFileSync(new NodeURL('../src/screens/NativeTokens.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, Error, AbortController, Promise,
    require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  const metadata = { contractAddress: '0x' + '2'.repeat(40), name: 'Saved token', symbol: 'TOK', decimals: 2 };
  let snapshot: NativeTokenSnapshot = {
    account: { address: '0x' + '1'.repeat(40), network: 'ethereum', revision: 1 },
    network: { name: 'Ethereum', chainId: '1', symbol: 'ETH', testnet: false }, status: 'loading', items: [],
    preview: null, previewStatus: 'idle', discovery: null, busy: false, error: null,
  };
  const listeners = new Set<() => void>();
  const publish = (update: Partial<NativeTokenSnapshot>) => { snapshot = { ...snapshot, ...update }; listeners.forEach(listener => listener()); };
  const held = Promise.withResolvers<void>();
  let retries = 0, receives = 0, sends = 0;
  const controller = {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot, connect: () => () => undefined,
    async refresh() { retries++; publish({ status: 'loading', error: null }); await held.promise;
      publish({ status: 'ready', items: [{ metadata, status: 'available', units: '250', updatedAt: 1 }] }); },
  };
  const root = createRoot(dom.window.document.getElementById('root'));
  const text = () => String(dom.window.document.body.textContent);
  try {
    await React.act(async () => root.render(React.createElement(module.exports.NativeTokens, {
      controller, initialContract: metadata.contractAddress, onModeChange() {}, onReceive() { receives++; }, onSend() { sends++; },
    })));
    assert.match(text(), /Loading saved tokens/);
    assert.doesNotMatch(text(), /Token is no longer in this list/);
    await React.act(async () => publish({ status: 'error', error: 'Saved tokens are unavailable. Refresh to try again.' }));
    assert.match(text(), /Saved tokens unavailable/);
    assert.doesNotMatch(text(), /Token is no longer in this list/);
    const retry = [...dom.window.document.querySelectorAll('button')].find((button: any) => button.textContent === 'Retry');
    assert(retry);
    await React.act(async () => { retry.click(); await tick(); });
    assert.equal(retries, 1); assert.match(text(), /Loading saved tokens/);
    assert(![...dom.window.document.querySelectorAll('button')].some((button: any) => button.textContent === 'Retry'));
    await React.act(async () => { held.resolve(); await tick(); });
    assert.match(text(), /2.5 TOK/); assert.match(text(), /Saved token/);
    assert.doesNotMatch(text(), /Token is no longer in this list/);
    assert.equal(sends, 0); assert.equal(receives, 0);
    await React.act(async () => publish({ status: 'ready', items: [] }));
    assert.match(text(), /Token is no longer in this list/);
    assert.doesNotMatch(text(), /Saved tokens unavailable|Loading saved tokens/);
  } finally {
    held.resolve(); await React.act(async () => root.unmount()); dom.window.close();
    for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
