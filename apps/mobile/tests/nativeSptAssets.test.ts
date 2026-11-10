import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBalanceDelta, formatBaseUnits } from '../src/core/amounts.ts';
import * as inventory from '../../../source/shared/sptInventory.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import type { SptBalance } from '../../../source/shared/sptInventory.ts';

const holding = (id: number): SptBalance => ({ assetGuid: String(id), decimals: 3, symbol: `SPT ${id}`, confirmedUnits: '9007199254740993', pendingDeltaUnits: '-125' });
function fixture() {
  let hidden = false;
  const f = screenFixture(new URL('../src/screens/NativeSptAssets.tsx', import.meta.url), 'NativeSptAssets', {
    '../platform/balancePrivacy': { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden, status: 'ready' }) },
    'react-native': { View: 'View', StyleSheet: { create: (v: unknown) => v } },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Row', 'Text'].map(name => [name, name])), colors: {} },
    '../core/amounts': { formatBalanceDelta, formatBaseUnits },
    '../../../../source/shared/sptInventory': inventory, './IdleActivityBoundary': { IdleTextInput: 'Input' },
  });
  let holdings: readonly SptBalance[] | null = Array.from({ length: 45 }, (_, i) => holding(i + 1));
  let loading = false, title: string | null = null, back: (() => boolean) | null = null;
  const sent: SptBalance[] = [];
  const props = { onSend: (asset: SptBalance) => sent.push(asset), onRefresh() {}, onModeChange: (value: string | null) => { title = value; },
    onBackHandlerChange: (value: (() => boolean) | null) => { back = value; } };
  const render = () => screenElements(f.render({ ...props, holdings, loading }));
  const press = (type: string, name: string) => {
    const element = render().find(e => e.type === type && e.props.title === name); assert(element, name); assert(!element.props.disabled, name); element.props.onPress();
  };
  return { render, press, sent, privacy(value: boolean) { hidden = value; }, state: () => ({ title, back }), replace(value: readonly SptBalance[] | null, pending = false) { holdings = value; loading = pending; }, close: f.close };
}

test('SPT list bounds visible rows, searches every asset and retains exact generic precision', () => {
  const f = fixture(); assert.equal(f.render().filter(e => e.type === 'Row').length, 20);
  f.press('Button', 'Next'); assert.equal(f.render().find(e => e.type === 'Row')!.props.title, 'SPT 21');
  f.press('Button', 'Next'); assert.equal(f.render().filter(e => e.type === 'Row').length, 5);
  f.render().find(e => e.type === 'Input')!.props.onChangeText('45');
  assert.equal(f.render().filter(e => e.type === 'Row').length, 1); f.press('Row', 'SPT 45');
  f.render(); assert.equal(f.state().title, 'SPT 45');
  assert.match(f.render().flatMap(e => e.children).join(' '), /9007199254740\.993/);
  f.press('Button', 'Send'); assert.deepEqual(f.sent, [holding(45)]); f.close();
});

test('refresh and failure remove stale amounts and send authority without losing selected public metadata', () => {
  const f = fixture(); f.press('Row', 'SPT 1'); f.replace(null, true);
  assert.equal(f.render().filter(e => e.type === 'Button' && e.props.title === 'Send').length, 0);
  assert.equal(f.state().title, 'SPT 1');
  assert(!f.render().flatMap(e => e.children).join(' ').includes('9007199254740.993'));
  f.replace(null); assert.match(f.render().flatMap(e => e.children).join(' '), /Balance unavailable/);
  f.replace([{ ...holding(1), confirmedUnits: '125', pendingDeltaUnits: '-125' }]);
  assert.equal(f.render().filter(e => e.type === 'Button' && e.props.title === 'Send').length, 0);
  assert.equal(f.state().back?.(), true); f.render(); assert.equal(f.state().back?.(), false); f.close();
});

test('unknown inventory is distinct from a verified empty inventory and inventory shrink clamps pagination', () => {
  const f = fixture(); f.press('Button', 'Next'); f.press('Button', 'Next'); f.replace([holding(1)]);
  assert.equal(f.render().find(e => e.type === 'Row')!.props.title, 'SPT 1');
  f.replace([]); assert.match(f.render().flatMap(e => e.children).join(' '), /No token holdings/);
  f.replace(null); assert.match(f.render().flatMap(e => e.children).join(' '), /Token balances unavailable/); f.close();
});


test('privacy mode masks list and selected SPT quantities without changing send payloads', () => {
  const f = fixture(); f.privacy(true);
  const list = f.render();
  assert(!JSON.stringify(list).includes('9007199254740.993'));
  assert.match(String(list.find(e => e.type === 'Row')?.props.subtitle), /••••/);
  f.press('Row', 'SPT 1');
  assert(!JSON.stringify(f.render()).includes('9007199254740.993'));
  assert(!JSON.stringify(f.render()).includes('0.125'));
  f.press('Button', 'Send'); assert.deepEqual(f.sent, [holding(1)]);
  f.privacy(false);
  assert.match(f.render().flatMap(e => e.children).join(' '), /9007199254740\.993/);
  f.close();
});
