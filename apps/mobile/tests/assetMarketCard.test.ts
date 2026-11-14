import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSET_MARKET_CHART, assetMarketCoordinates, assetMarketIndexAt, assetMarketLine, type AssetMarket } from '../../../source/shared/assetMarket.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { createNativeAssetMarketReader } from '../src/portfolio/nativeAssetMarket.ts';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
type MarketReader = ReturnType<typeof createNativeAssetMarketReader>;
type Timing = { now(): number; setTimeout(run: () => void, delay: number): number; clearTimeout(id: number): void };
function fixture(prices = [10, 20, 30, 40, 50, 60, 70, 80], options: { read?: MarketReader; timing?: Timing } = {}) {
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
    './nativeAssetMarket.ts': { createNativeAssetMarketReader: () => options.read ?? (async () => { reads++; return { data, expiresAt: 300_000 }; }),
      nativeAssetMarketNow: () => options.timing?.now() ?? 0,
      nativeAssetMarketSource: (asset: { networkId: string }) => ({ kind: 'native', id: asset.networkId }), rememberNativeAssetMarketIcon() {} },
    '../ui': { Card: 'Card', Button: 'Button', Text: 'Text', colors: {} },
  }, { AbortController, setTimeout: options.timing?.setTimeout ?? (() => 0), clearTimeout: options.timing?.clearTimeout ?? (() => {}) });
  let asset = { kind: 'native', networkId: 'ethereum' };
  const render = () => screenElements(f.render({ asset }));
  return { render, reads: () => reads, switchAsset() { asset = { ...asset, networkId: 'base' }; },
    background() { state.currentState = 'background'; for (const run of listeners) run('background'); },
    foreground() { state.currentState = 'active'; for (const run of listeners) run('active'); }, close: f.close };
}

function fakeTime() {
  let now = 0, serial = 0;
  const timers = new Map<number, { at: number; run(): void }>();
  return {
    now: () => now,
    setTimeout(run: () => void, delay: number) { const id = ++serial; timers.set(id, { at: now + delay, run }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    deadlines: () => [...timers.values()].map(timer => timer.at),
    advanceTo(next: number) {
      assert(next >= now); now = next;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
    },
  };
}

for (const reenter of ['foreground', 'remount'] as const) test(`market cache expiry survives ${reenter} at 4:59`, async () => {
  const timing = fakeTime();
  let quoteReads = 0, requests = 0;
  const now = Date.now();
  const read = createNativeAssetMarketReader(async url => {
    requests++;
    if (url.includes('/market_chart?')) return Response.json({ prices: [[now - 60_000, 80], [now, 90]] });
    return Response.json([{ id: 'ethereum', current_price: quoteReads++ === 0 ? 90 : 95, last_updated: new Date(now).toISOString() }]);
  }, 'history', timing.now);
  let f = fixture(undefined, { read, timing });
  try {
    f.render(); await settle();
    assert.equal(requests, 2);
    assert.deepEqual(timing.deadlines(), [300_000]);
    timing.advanceTo(299_000);
    if (reenter === 'foreground') { f.background(); assert.deepEqual(timing.deadlines(), []); f.foreground(); }
    else { f.close(); assert.deepEqual(timing.deadlines(), []); f = fixture(undefined, { read, timing }); f.render(); }
    await settle();
    assert(f.render().some(element => element.children.includes('90 USD')));
    assert.equal(requests, 2, 'Reentry still reuses the fresh cached result');
    assert.deepEqual(timing.deadlines(), [300_000], 'Reentry must not extend the cached result lifetime');
    timing.advanceTo(299_999); await settle(); assert.equal(requests, 2);
    timing.advanceTo(300_000); await settle();
    assert.equal(requests, 4);
    assert(f.render().some(element => element.children.includes('95 USD')));
    assert.deepEqual(timing.deadlines(), [600_000]);
  } finally { f.close(); }
});

test('market cache expiry refreshes immediately on a later foreground', async () => {
  const timing = fakeTime();
  let requests = 0;
  const now = Date.now();
  const read = createNativeAssetMarketReader(async () => {
    requests++;
    return Response.json([{ id: 'ethereum', current_price: requests === 1 ? 90 : 95, last_updated: new Date(now).toISOString() }]);
  }, 'price', timing.now);
  const f = fixture(undefined, { read, timing });
  try {
    f.render(); await settle(); assert.equal(requests, 1);
    f.background(); timing.advanceTo(300_001);
    assert.deepEqual(timing.deadlines(), []);
    f.foreground(); await settle();
    assert.equal(requests, 2);
    assert(f.render().some(element => element.children.includes('95 USD')));
  } finally { f.close(); }
});

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
