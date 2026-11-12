import assert from 'node:assert/strict';
import test from 'node:test';
import { assetMarketCoordinates, assetMarketLine, type AssetMarket } from '../../../source/shared/assetMarket.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  let reads = 0;
  const state = { currentState: 'active', addEventListener(_name: string, listener: (state: string) => void) {
    listeners.add(listener); return { remove() { listeners.delete(listener); } };
  } };
  const listeners = new Set<(state: string) => void>();
  const data: AssetMarket = { price: 90, prices: [10, 20, 30, 40, 50, 60, 70, 80], updatedAt: 1000,
    change24h: 3, high24h: 90, low24h: 10, marketCap: null };
  const f = screenFixture(new URL('../src/portfolio/AssetMarketCard.tsx', import.meta.url), 'AssetMarketCard', {
    '../platform/localization': nativeTranslationFixture,
    'react-native': { AppState: state, ActivityIndicator: 'Loading', Platform: { OS: 'ios' }, StyleSheet: { create: (x: unknown) => x }, View: 'View' },
    'react-native-svg': { default: 'Svg', Path: 'Path', Circle: 'Circle', Line: 'Line' },
    '../../../../source/shared/assetMarket.ts': { assetMarketCoordinates, assetMarketLine },
    '../platform/fiatPreferences.ts': { useFiatCurrency: () => ({ status: 'ready', currency: 'usd' }) },
    '../platform/http.ts': { walletFetch() { assert.fail('Reader adapter is mocked'); } },
    './nativeAssetMarket.ts': { createNativeAssetMarketReader: () => async () => { reads++; return data; },
      nativeAssetMarketSource: (asset: { networkId: string }) => asset.networkId, rememberNativeAssetMarketIcon() {} },
    '../ui': { Card: 'Card', Button: 'Button', Text: 'Text', colors: {} },
  }, { AbortController, setTimeout: () => 0, clearTimeout() {} });
  let asset = { kind: 'native', networkId: 'ethereum' };
  const render = () => screenElements(f.render({ asset }));
  return { render, reads: () => reads, switchAsset() { asset = { ...asset, networkId: 'base' }; },
    background() { state.currentState = 'background'; for (const run of listeners) run('background'); }, close: f.close };
}

test('market chart selects the nearest bounded sample, restores the quote and never refetches while dragging', async () => {
  const f = fixture();
  try {
    f.render(); await settle();
    let elements = f.render();
    const chart = () => elements.find(e => e.props.testID === 'asset-market-chart')!;
    assert(chart()); assert.equal(chart().props.accessibilityRole, 'adjustable');
    chart().props.onLayout({ nativeEvent: { layout: { width: 300 } } });
    chart().props.onTouchStart({ nativeEvent: { locationX: -20 } }); elements = f.render();
    assert(elements.some(e => e.children.includes('10 USD')));
    assert.equal(elements.find(e => e.type === 'Circle')?.props.cx, 0);
    chart().props.onTouchMove({ nativeEvent: { locationX: 999 } }); elements = f.render();
    assert(elements.some(e => e.children.includes('80 USD')));
    assert.equal(elements.find(e => e.type === 'Circle')?.props.cx, 300);
    chart().props.onTouchMove({ nativeEvent: { locationX: 128 } }); elements = f.render();
    assert(elements.some(e => e.children.includes('40 USD')));
    chart().props.onTouchMove({ nativeEvent: { locationX: Number.NaN } }); elements = f.render();
    assert(elements.some(e => e.children.includes('40 USD')));
    chart().props.onTouchEnd(); elements = f.render();
    assert(elements.some(e => e.children.includes('90 USD')));
    assert(!elements.some(e => e.type === 'Circle'));
    assert.equal(f.reads(), 1);
  } finally { f.close(); }
});

test('accessible chart adjustments remain local to the displayed asset and disappear when backgrounded', async () => {
  const f = fixture();
  try {
    f.render(); await settle();
    let elements = f.render();
    const oldChart = elements.find(e => e.props.testID === 'asset-market-chart')!;
    oldChart.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); elements = f.render();
    assert(elements.some(e => e.children.includes('70 USD')));
    assert.equal(elements.find(e => e.props.testID === 'asset-market-chart')!.props.accessibilityValue.now, 7);
    f.switchAsset(); elements = f.render();
    assert(!elements.some(e => e.props.testID === 'asset-market-chart'));
    oldChart.props.onTouchMove({ nativeEvent: { locationX: 0 } });
    await settle(); elements = f.render();
    assert(elements.some(e => e.children.includes('90 USD')));
    assert(!elements.some(e => e.type === 'Circle'));
    assert.equal(f.reads(), 2);
    f.background(); elements = f.render();
    assert(!elements.some(e => e.props.testID === 'asset-market-chart'));
  } finally { f.close(); }
});
