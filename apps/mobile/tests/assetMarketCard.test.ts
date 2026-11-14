import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSET_MARKET_CHART, assetMarketCoordinates, assetMarketIndexAt, assetMarketLine, type AssetMarket } from '../../../source/shared/assetMarket.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(prices = [10, 20, 30, 40, 50, 60, 70, 80]) {
  let reads = 0;
  const state = { currentState: 'active', addEventListener(_name: string, listener: (state: string) => void) {
    listeners.add(listener); return { remove() { listeners.delete(listener); } };
  } };
  const listeners = new Set<(state: string) => void>();
  const data: AssetMarket = { price: 90, prices, updatedAt: 1000,
    change24h: 3, high24h: 90, low24h: 10, marketCap: null };
  const f = screenFixture(new URL('../src/portfolio/AssetMarketCard.tsx', import.meta.url), 'AssetMarketCard', {
    '../platform/localization': nativeTranslationFixture,
    'react-native': { AppState: state, ActivityIndicator: 'Loading', Platform: { OS: 'ios' }, StyleSheet: { create: (x: unknown) => x }, View: 'View' },
    'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path', Circle: 'Circle', Line: 'Line' },
    '../../../../source/shared/assetMarket.ts': { ASSET_MARKET_CHART, assetMarketCoordinates, assetMarketIndexAt, assetMarketLine },
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
    assert.equal(elements.find(e => e.type === 'Circle')?.props.cx, 6);
    chart().props.onTouchMove({ nativeEvent: { locationX: 999 } }); elements = f.render();
    assert(elements.some(e => e.children.includes('80 USD')));
    assert.equal(elements.find(e => e.type === 'Circle')?.props.cx, 294);
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


test('narrow chart touches select the plotted endpoint and keep the whole marker inside the SVG', async () => {
  const prices = Array.from({ length: 241 }, (_, index) => index);
  const points = assetMarketCoordinates(prices)!;
  const f = fixture(prices);
  try {
    f.render(); await settle();
    let elements = f.render();
    const chart = () => elements.find(e => e.props.testID === 'asset-market-chart')!;
    const svg = () => elements.find(e => e.type === 'Svg')!;
    for (const layoutWidth of [32, 180, 300]) {
      chart().props.onLayout({ nativeEvent: { layout: { width: layoutWidth } } });
      for (const index of [0, 1, 120, 239, 240]) {
        chart().props.onTouchMove({ nativeEvent: { locationX: points[index]!.x / ASSET_MARKET_CHART.width * layoutWidth } });
        elements = f.render();
        const marker = elements.find(e => e.type === 'Circle')!.props;
        const guide = elements.find(e => e.type === 'Line')!.props;
        const [left, top, width, height] = svg().props.viewBox.split(' ').map(Number);
        const extent = marker.r + marker.strokeWidth / 2;
        assert.equal(marker.cx, points[index]!.x); assert.equal(marker.cy, points[index]!.y);
        assert.equal(guide.x1, marker.cx); assert.equal(guide.x2, marker.cx);
        assert(marker.cx - extent >= left && marker.cx + extent <= left + width);
        assert(marker.cy - extent >= top && marker.cy + extent <= top + height);
        assert.equal(chart().props.accessibilityValue.now, index + 1);
        assert(elements.some(e => e.children.includes(`${index} USD`)));
      }
    }
    assert.equal(f.reads(), 1);
  } finally { f.close(); }
});
