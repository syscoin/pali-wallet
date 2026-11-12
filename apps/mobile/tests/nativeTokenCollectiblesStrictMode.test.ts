import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { normalizeErc20Address } from '../src/portfolio/erc20Metadata.ts';
import { normalizeNftTokenId } from '../../../source/utils/nftTokenId.ts';

const require = createRequire(import.meta.url);
const React: typeof import('react') = require('react');
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('real StrictMode auto-enumeration retires its replayed owner before making a request', async () => {
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
    'react-native': { View: children, ActivityIndicator: children, Keyboard: { dismiss() {} }, StyleSheet: { create: (value: unknown) => value } },
    '../../../../source/shared/erc20': { formatTokenUnits() {} },
    '../../../../source/utils/nftTokenId': { normalizeNftTokenId },
    '../portfolio/erc20Metadata': { normalizeErc20Address },
    '../portfolio/AssetMarketCard': { AssetMarketCard: children },
    '../ui': { ...Object.fromEntries(['Card', 'Coin', 'Icon', 'IconButton', 'Notice', 'Text'].map(name => [name, children])),
      Button: ({ title, onPress, disabled }: any) => React.createElement('button', { onClick: onPress, disabled }, title), colors: {}, styles: {} },
  };
  const module = { exports: {} as { CollectibleOwnership: React.ComponentType<any> } };
  const code = ts.transpileModule(readFileSync(new NodeURL('../src/screens/NativeTokens.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, Error, AbortController, Promise,
    require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  const root = createRoot(dom.window.document.getElementById('root'));
  const signals: AbortSignal[] = [];
  const held = Promise.withResolvers<{ tokenIds: readonly string[]; hasMore: boolean; method: 'enumeration' }>();
  let ownership = 0, saved = 0;
  try {
    await React.act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(module.exports.CollectibleOwnership, {
        item: { contractAddress: '0x1111111111111111111111111111111111111111', tokenStandard: 'ERC-721' },
        network: 'Ethereum', busy: false, canCheck: true, onLeaveChange() {},
        enumerate(_query: object, signal: AbortSignal) { signals.push(signal); return held.promise; },
        async check() { ownership++; return { tokenId: '0', units: '1' }; },
        async onSave() { saved++; },
      })));
      await tick();
    });
    assert.equal(signals.length, 1, 'The cancelled replay must not disclose another account lookup');
    assert.equal(signals[0]!.aborted, false);
    await React.act(async () => { held.resolve({ tokenIds: ['0'], hasMore: false, method: 'enumeration' }); await tick(); });
    assert.match(dom.window.document.body.textContent, /Token ID 0/);
    assert.equal(ownership, 0); assert.equal(saved, 0);
    const oldButton = [...dom.window.document.querySelectorAll('button')].find((button: any) => button.textContent === 'Token ID 0');
    await React.act(async () => root.unmount());
    oldButton?.click(); assert.equal(ownership, 0); assert.equal(saved, 0);
  } finally {
    held.resolve({ tokenIds: [], hasMore: false, method: 'enumeration' });
    dom.window.close();
    for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
