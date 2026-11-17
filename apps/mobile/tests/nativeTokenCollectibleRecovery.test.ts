import { walletUiFixture } from './walletUiFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
import { normalizeNftTokenId } from '../../../source/utils/nftTokenId.ts';
import { normalizeErc20Address } from '../src/portfolio/erc20Metadata.ts';
import { NativeTokens, type NativeTokenRuntime } from '../src/portfolio/nativeTokens.ts';
import type { SavedCollectible } from '../src/portfolio/tokenRegistry.ts';
import type { CustodySnapshot } from '../src/custody/types.ts';

const require = createRequire(import.meta.url);
const React: typeof import('react') = require('react');
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const address = `0x${'1'.repeat(40)}`;
const collectible: SavedCollectible = { contractAddress: `0x${'2'.repeat(40)}`, tokenStandard: 'ERC-1155', tokenId: '7' };

async function fixture(mode: 'healthy' | 'uncommitted' | 'committed', entries: SavedCollectible[] = [collectible]) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot }: { createRoot(container: Element): { render(children: import('react').ReactNode): void; unmount(): void } } = require('react-dom/client');
  type Action = () => void;
  const actions = new Map<string, Action>();
  const children = ({ children }: any) => React.createElement('div', null, children);
  const imports: Record<string, unknown> = {
    '../platform/localization': nativeTranslationFixture, react: React,
    '../platform/balancePrivacy': { useBalancePrivacy: () => ({ hidden: false }), HIDDEN_BALANCE: 'Hidden' },
    './IdleActivityBoundary': { IdleTextInput: ({ value }: any) => React.createElement('input', { value, readOnly: true }),
      IdlePressable: ({ children, onPress, accessibilityLabel }: any) => React.createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children) },
    'react-native': { View: children, ActivityIndicator: children, BackHandler: { addEventListener: () => ({ remove() {} }) },
      Keyboard: { dismiss() {} }, StyleSheet: { create: (value: unknown) => value } },
    '../../../../source/shared/erc20': { formatTokenUnits },
    '../../../../source/utils/nftTokenId': { normalizeNftTokenId }, '../portfolio/erc20Metadata': { normalizeErc20Address },
    '../portfolio/AssetMarketCard': { AssetMarketCard: children },
    '../ui': { ...Object.fromEntries(['Card', 'Coin', 'Icon', 'Text'].map(name => [name, children])),
      IconButton: ({ label, onPress, disabled }: any) => React.createElement('button', { onClick: onPress, disabled }, label),
      Notice: ({ title, body }: any) => React.createElement('div', null, title, body),
      Button: ({ title, onPress, disabled }: any) => { actions.set(title, onPress); return React.createElement('button', { onClick: onPress, disabled }, title); }, colors: {}, styles: {} },
  };
  const module = { exports: {} as { NativeTokens: React.ComponentType<any> } };
  const code = ts.transpileModule(readFileSync(new URL('../src/screens/NativeTokens.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, Error, AbortController, Promise,
    require(name: string) { const walletUi = walletUiFixture(name, imports); if (walletUi) return walletUi; assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  let state: CustodySnapshot = { phase: 'ready', revision: 1, presence: 'existing', backup: 'confirmed', account: { address, network: 'ethereum' }, error: null };
  const listeners = new Set<(snapshot: CustodySnapshot) => void>();
  let saved = entries, revision = 0, attempts = 0, writes = 0, loads = 0;
  let holdLoad: Promise<void> | undefined;
  const checks: string[] = [], sent: SavedCollectible[] = [];
  const inventory = () => ({ revision, items: [], collectibles: saved });
  const runtime: NativeTokenRuntime = {
    async load(guard) { loads++; await holdLoad; guard(); return inventory(); },
    async add() { assert.fail('No token import'); }, async remove() { assert.fail('No ERC20 removal'); },
    async removeCollectible(expected, item, guard) {
      guard(); assert.equal(expected, revision); attempts++;
      if (mode !== 'uncommitted') { saved = saved.filter(row => JSON.stringify(row) !== JSON.stringify(item)); revision++; writes++; }
      if (mode !== 'healthy') throw Error('Lost mutation reply');
      return inventory();
    },
  };
  const model = new NativeTokens({ getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } }, () => runtime,
  { async readToken() { assert.fail('No metadata read'); }, async readBalance() { assert.fail('No balance read'); } }, () => 123,
  undefined, undefined, async (selection, _signal, guard) => { guard(); checks.push(selection.tokenId); return { tokenId: selection.tokenId, units: '1' }; });
  const root = createRoot(dom.window.document.getElementById('root'));
  const text = () => String(dom.window.document.body.textContent);
  const button = (title: string) => {
    const found = [...dom.window.document.querySelectorAll('button')].find((node: any) => node.textContent === title);
    assert(found, title); return found;
  };
  const click = async (title: string) => { await React.act(async () => { button(title).click(); await tick(); }); };
  await React.act(async () => { root.render(React.createElement(module.exports.NativeTokens, { controller: model.view, onReceive() {},
    onSendCollectible(item: SavedCollectible) { sent.push(item); } })); await tick(); });
  await click('Collectibles');
  await click('View collectible');
  return { model, text, button, click, checks, sent, actions, counts: () => ({ attempts, writes, loads }),
    healthy() { mode = 'healthy'; }, hold(promise: Promise<void>) { holdLoad = promise; },
    replaceSaved(entries: SavedCollectible[]) { saved = entries; revision++; },
    async change(network: string, nextAddress = address) { await React.act(async () => {
      state = { ...state, revision: state.revision + 1, account: { address: nextAddress, network } };
      for (const listener of listeners) listener(state);
      await tick();
    }); },
    async close() { await React.act(async () => root.unmount()); dom.window.close();
      for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('uncertain collectible removal cannot be repeated before recovery and a full reload rebinds the retained detail to the current saved item', async () => {
  const f = await fixture('uncommitted');
  const held = Promise.withResolvers<void>();
  try {
    const before = f.model.getSnapshot(), item = before.collectibles![0]!;
    const staleSend = f.actions.get('Send collectible')!;
    await f.click('Remove collectible');
    const staleConfirm = f.actions.get('Remove from saved list')!;
    await f.click('Remove from saved list');
    assert.equal(f.model.getSnapshot().status, 'error');
    assert.deepEqual(f.counts(), { attempts: 1, writes: 0, loads: 1 });
    assert.equal(f.button('Remove from saved list').disabled, true, 'Uncertain inventory must disable confirmation');
    await React.act(async () => { staleConfirm(); staleSend(); await tick(); });
    assert.equal(f.counts().attempts, 1);
    assert.deepEqual(f.sent, []);
    f.hold(held.promise);
    await f.click('Refresh tokens');
    assert.equal(f.model.getSnapshot().status, 'loading');
    assert.equal(f.button('Remove from saved list').disabled, true);
    await React.act(async () => { staleConfirm(); staleSend(); await tick(); });
    assert.equal(f.counts().attempts, 1);
    assert.deepEqual(f.sent, []);
    await React.act(async () => { held.resolve(); await tick(); });
    const recovered = f.model.getSnapshot(), current = recovered.collectibles![0]!;
    assert.equal(recovered.account, before.account);
    assert.notEqual(current, item); assert.deepEqual(current, item);
    assert.equal(recovered.status, 'ready'); assert.equal(recovered.collectibles!.length, 1);
    assert.doesNotMatch(f.text(), /Token is no longer in this list/);
    assert.equal(f.button('Remove from saved list').disabled, false);
    assert.equal(await f.model.removeCollectible(before.account!, item), false, 'Old exact membership remains retired');
    await React.act(async () => { staleConfirm(); staleSend(); await tick(); });
    assert.equal(f.counts().attempts, 1, 'Recovery never revives a stale mutation closure');
    assert.deepEqual(f.sent, []);
    await f.click('Cancel');
    await f.click('Check ownership');
    assert.deepEqual(f.checks, ['7']);
    await f.click('Send collectible'); assert.equal(f.sent[0], current);
    f.healthy();
    await f.click('Remove collectible'); await f.click('Remove from saved list');
    assert.deepEqual(f.counts(), { attempts: 2, writes: 1, loads: 2 });
    assert.equal((f.model.getSnapshot().collectibles ?? []).length, 0);
  } finally { held.resolve(); await f.close(); }
});

test('a committed collectible removal with a lost reply stays missing after explicit recovery and is never resent', async () => {
  const f = await fixture('committed');
  try {
    await f.click('Remove collectible'); await f.click('Remove from saved list');
    const staleConfirm = f.actions.get('Remove from saved list')!;
    assert.equal(f.model.getSnapshot().status, 'error');
    await f.click('Refresh tokens');
    assert.equal(f.model.getSnapshot().status, 'ready');
    assert.equal((f.model.getSnapshot().collectibles ?? []).length, 0);
    assert.match(f.text(), /Token is no longer in this list/);
    await React.act(async () => { staleConfirm(); await tick(); });
    assert.deepEqual(f.counts(), { attempts: 1, writes: 1, loads: 2 });
  } finally { await f.close(); }
});

test('a recovered still-saved collectible stays open without Back and reentry', async () => {
  const f = await fixture('uncommitted');
  try {
    await f.click('Remove collectible'); await f.click('Remove from saved list');
    await f.click('Refresh tokens');
    assert.equal(f.model.getSnapshot().status, 'ready');
    assert.equal(f.model.getSnapshot().collectibles!.length, 1);
    assert.doesNotMatch(f.text(), /Token is no longer in this list/);
    assert(f.button('Remove from saved list'));
    assert.deepEqual(f.counts(), { attempts: 1, writes: 0, loads: 2 });
    await f.click('Remove from saved list');
    assert.equal(f.model.getSnapshot().status, 'error');
    assert.equal(f.button('Remove from saved list').disabled, true, 'A later uncertainty retains the recovered current item for display only');
    assert.doesNotMatch(f.text(), /Saved tokens unavailable|Token is no longer in this list/);
    assert.deepEqual(f.counts(), { attempts: 2, writes: 0, loads: 2 });
  } finally { await f.close(); }
});

for (const phase of ['error', 'loading'] as const) test(`collectible removal can be dismissed during ${phase} without enabling dependent actions`, async () => {
  const f = await fixture('uncommitted');
  const held = Promise.withResolvers<void>();
  try {
    await f.click('Remove collectible'); await f.click('Remove from saved list');
    if (phase === 'loading') { f.hold(held.promise); await f.click('Refresh tokens'); }
    assert.equal(f.model.getSnapshot().status, phase);
    assert.equal(f.button('Remove from saved list').disabled, true);
    assert.equal(f.button('Cancel').disabled, false, 'An invalid inventory is not an active mutation');
    await f.click('Cancel');
    assert.equal(f.button('Remove collectible').disabled, true);
    assert.equal(f.button('Send collectible').disabled, true);
    assert.deepEqual(f.counts(), { attempts: 1, writes: 0, loads: phase === 'loading' ? 2 : 1 });
  } finally { held.resolve(); await f.close(); }
});

test('a healthy collectible confirmation performs one mutation without a recovery read', async () => {
  const f = await fixture('healthy');
  try {
    await f.click('Remove collectible'); await f.click('Remove from saved list');
    assert.deepEqual(f.counts(), { attempts: 1, writes: 1, loads: 1 });
    assert.equal((f.model.getSnapshot().collectibles ?? []).length, 0);
    assert.doesNotMatch(f.text(), /could not be confirmed/);
  } finally { await f.close(); }
});

test('recovery resolves the exact saved ERC1155 ID and never substitutes a sibling from the same contract', async () => {
  const sibling: SavedCollectible = { ...collectible, tokenStandard: 'ERC-1155', tokenId: '8' };
  const f = await fixture('uncommitted');
  try {
    await f.click('Remove collectible'); await f.click('Remove from saved list');
    f.replaceSaved([sibling, collectible]);
    await f.click('Refresh tokens'); await f.click('Cancel');
    const current = f.model.getSnapshot().collectibles!;
    await f.click('Check ownership'); assert.deepEqual(f.checks, ['7']);
    await f.click('Send collectible'); assert.equal(f.sent[0], current[1]);
    f.healthy(); await f.click('Remove collectible'); await f.click('Remove from saved list');
    assert.deepEqual(f.model.getSnapshot().collectibles, [sibling]);
    assert.deepEqual(f.counts(), { attempts: 2, writes: 1, loads: 2 });
  } finally { await f.close(); }
});

test('saved ERC721 collection identity also survives explicit inventory recovery', async () => {
  const collection: SavedCollectible = { contractAddress: collectible.contractAddress, tokenStandard: 'ERC-721' };
  const f = await fixture('uncommitted', [collection]);
  try {
    await f.click('Remove collectible'); await f.click('Remove from saved list');
    await f.click('Refresh tokens');
    assert.doesNotMatch(f.text(), /Token is no longer in this list/);
    assert.equal(f.button('Remove from saved list').disabled, false);
    f.healthy(); await f.click('Remove from saved list');
    assert.equal((f.model.getSnapshot().collectibles ?? []).length, 0);
    assert.deepEqual(f.counts(), { attempts: 2, writes: 1, loads: 2 });
  } finally { await f.close(); }
});

for (const network of ['sepolia', 'ethereum']) test(`collectible recovery and retained callbacks cannot cross ${network === 'ethereum' ? 'account' : 'network'} ownership`, async () => {
  const f = await fixture('uncommitted');
  const held = Promise.withResolvers<void>();
  try {
    const before = f.model.getSnapshot();
    const staleSend = f.actions.get('Send collectible')!;
    await f.click('Remove collectible'); await f.click('Remove from saved list');
    const staleConfirm = f.actions.get('Remove from saved list')!;
    f.hold(held.promise); await f.click('Refresh tokens');
    await f.change(network, network === 'ethereum' ? `0x${'3'.repeat(40)}` : address);
    await React.act(async () => { held.resolve(); await tick(); });
    assert.notEqual(f.model.getSnapshot().account, before.account);
    await React.act(async () => { staleConfirm(); staleSend(); await tick(); });
    assert.equal(await f.model.removeCollectible(before.account!, before.collectibles![0]!), false);
    assert.equal(f.counts().attempts, 1); assert.equal(f.counts().writes, 0);
    assert.deepEqual(f.sent, []);
    assert.doesNotMatch(f.text(), /Remove this collectible/);
  } finally { held.resolve(); await f.close(); }
});
