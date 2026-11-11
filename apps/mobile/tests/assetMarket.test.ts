import assert from 'node:assert/strict';
import test from 'node:test';
import { assetMarketLine, assetMarketUrl, readAssetMarket, readTokenMarketId } from '../../../source/shared/assetMarket.ts';
import { createNativeAssetMarketReader, nativeAssetMarketSource } from '../src/portfolio/nativeAssetMarket.ts';

const now = Date.now();
const market = (extra = {}) => [{ id: 'ethereum', current_price: 2200, last_updated: new Date(now).toISOString(),
  price_change_percentage_24h: -1.2, high_24h: 2300, low_24h: 2100, market_cap: 250e9,
  sparkline_in_7d: { price: [2100, 2200, 2150, 2200] }, ...extra }];

test('market data is bound to its asset and never fabricates missing history', () => {
  assert.equal(assetMarketLine([0, 1e308]), 'M0.00,112.00 L300.00,8.00');
  assert.equal(assetMarketLine([NaN, 1]), null);
  assert.equal(readAssetMarket(market(), 'bitcoin', now), null);
  assert.equal(readAssetMarket([...market(), ...market()], 'ethereum', now), null);
  assert.equal(readAssetMarket(market({ current_price: Infinity }), 'ethereum', now), null);
  assert.equal(readAssetMarket(market({ last_updated: new Date(now - 2 * 86400000).toISOString() }), 'ethereum', now), null);
  assert.deepEqual(readAssetMarket(market({ sparkline_in_7d: { price: [1, NaN] } }), 'ethereum', now)?.prices, []);
  assert.equal(readAssetMarket(market(), 'ethereum', now)?.prices.length, 4);
});

test('market identity uses registered shared metadata, not asset symbols', () => {
  assert.deepEqual(nativeAssetMarketSource({ kind: 'native', networkId: 'bitcoin' }), { kind: 'native', id: 'bitcoin' });
  assert.deepEqual(nativeAssetMarketSource({ kind: 'native', networkId: 'syscoin' }), { kind: 'native', id: 'syscoin' });
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: 'unknown' }), null);
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: 'zksys-testnet' }), null);
  const contract = '0x' + '11'.repeat(20);
  assert.equal(readTokenMarketId({ id: 'ethereum', platforms: { ethereum: contract } }, 'ethereum', contract), 'ethereum');
  assert.equal(readTokenMarketId({ id: 'ethereum', platforms: { base: contract } }, 'ethereum', contract), null);
  assert.throws(() => assetMarketUrl('../bitcoin', 'usd'));
});

test('market requests use bounded native transport, a cache and cancellation', async () => {
  const requests: RequestInit[] = [];
  let count = 0;
  const read = createNativeAssetMarketReader(async (url, init) => {
    count++; requests.push(init);
    assert.equal(url, assetMarketUrl('ethereum', 'usd'));
    return Response.json(market());
  });
  const source = { kind: 'native' as const, id: 'ethereum' };
  const first = await read(source, 'usd', new AbortController().signal);
  assert.equal(first?.price, 2200);
  assert.equal(await read(source, 'usd', new AbortController().signal), first);
  assert.equal(count, 1);
  assert.equal(requests[0]?.credentials, 'omit');
  assert.equal(requests[0]?.redirect, 'error');
  assert.equal(requests[0]?.signal?.aborted, true);
  const owner = new AbortController(); owner.abort();
  assert.equal(await read(source, 'usd', owner.signal), null);
});

test('market reader rejects redirects and oversized responses', async () => {
  for (const response of [new Response('x'.repeat(65537)), new Response('{}', { status: 302 })]) {
    const read = createNativeAssetMarketReader(async () => response);
    assert.equal(await read({ kind: 'native', id: 'ethereum' }, 'usd', new AbortController().signal), null);
  }
});
