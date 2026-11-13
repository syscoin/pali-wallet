import assert from 'node:assert/strict';
import test from 'node:test';
import { assetMarketHistoryUrl, assetMarketLine, assetMarketUrl, readAssetMarket, readAssetMarketHistory, readTokenMarketId } from '../../../source/shared/assetMarket.ts';
import { createNativeAssetMarketReader, nativeAssetMarketSource } from '../src/portfolio/nativeAssetMarket.ts';

const now = Date.now();
const market = (extra = {}) => [{ id: 'ethereum', current_price: 2200, last_updated: new Date(now).toISOString(),
  price_change_percentage_24h: -1.2, high_24h: 2300, low_24h: 2100, market_cap: 250e9,
  sparkline_in_7d: { price: [2100, 2200, 2150, 2200] }, ...extra }];

test('market data is bound to its asset and never fabricates missing history', () => {
  assert.equal(assetMarketLine([0, 1e308]), 'M0.00,112.00 L300.00,8.00');
  assert.equal(assetMarketLine([NaN, 1]), null);
  assert.equal(readAssetMarket(market(), 'bitcoin', 'usd', now), null);
  assert.equal(readAssetMarket([...market(), ...market()], 'ethereum', 'usd', now), null);
  assert.equal(readAssetMarket(market({ current_price: Infinity }), 'ethereum', 'usd', now), null);
  assert.equal(readAssetMarket(market({ last_updated: new Date(now - 2 * 86400000).toISOString() }), 'ethereum', 'usd', now), null);
  assert.deepEqual(readAssetMarket(market({ sparkline_in_7d: { price: [1, NaN] } }), 'ethereum', 'usd', now)?.prices, []);
  assert.equal(readAssetMarket(market(), 'ethereum', 'usd', now)?.prices.length, 4);
  assert.deepEqual(readAssetMarket(market({ current_price: 8080 }), 'ethereum', 'aed', now)?.prices, []);
  assert.equal(readAssetMarket(market(), 'ethereum', 'AED', now), null);
});

const history = (prices: number[] = [7700, 8080]) => ({
  prices: prices.map((price, index) => [now - (prices.length - 1 - index) * 60_000, price]),
});

test('requested-currency history accepts ordered finite samples and rejects malformed or stale history', () => {
  assert.deepEqual(readAssetMarketHistory(history(), now), [7700, 8080]);
  const sampled = readAssetMarketHistory(history(Array.from({ length: 1024 }, (_, index) => index)), now);
  assert(sampled.length <= 241); assert.equal(sampled[0], 0); assert.equal(sampled.at(-1), 1023);
  for (const value of [null, {}, { prices: [] }, history([1]), history(Array(1025).fill(1)),
    { prices: [[now, 1], [now, 2]] }, { prices: [[now, 1], [now - 1, 2]] },
    { prices: [[now - 1, 1], [now, NaN]] }, { prices: [[now - 1, 1], [now, -1]] },
    { prices: [[now - 1, 1], [now + 300_001, 2]] },
    { prices: [[now - 9 * 86400000, 1], [now, 2]] },
    { prices: [[now - 3 * 86400000, 1], [now - 2 * 86400000, 2]] },
    { prices: [[now - 1, 1, 9], [now, 2]] }])
    assert.deepEqual(readAssetMarketHistory(value, now), []);
  assert.throws(() => assetMarketHistoryUrl('../bitcoin', 'aed'));
});

test('market identity uses registered shared metadata, not asset symbols', () => {
  assert.deepEqual(nativeAssetMarketSource({ kind: 'native', networkId: 'bitcoin' }), { kind: 'native', id: 'bitcoin' });
  assert.deepEqual(nativeAssetMarketSource({ kind: 'native', networkId: 'syscoin' }), { kind: 'native', id: 'syscoin' });
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: 'unknown' }), null);
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: 'zksys-testnet' }), null);
  const contract = '0x' + '11'.repeat(20);
  assert.equal(readTokenMarketId({ id: 'ethereum', platforms: { ethereum: contract } }, 'ethereum', contract), 'ethereum');
  assert.equal(readTokenMarketId({ id: 'ethereum', platforms: { base: contract } }, 'ethereum', contract), null);
  assert.throws(() => assetMarketUrl('../bitcoin', 'usd', 'history'));
});

test('market requests use bounded native transport, a cache and cancellation', async () => {
  const requests: RequestInit[] = [];
  let count = 0;
  const read = createNativeAssetMarketReader(async (url, init) => {
    count++; requests.push(init);
    assert.equal(url, assetMarketUrl('ethereum', 'usd', 'history'));
    return Response.json(market());
  }, 'history');
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
    const read = createNativeAssetMarketReader(async () => response, 'history');
    assert.equal(await read({ kind: 'native', id: 'ethereum' }, 'usd', new AbortController().signal), null);
  }
});

test('portfolio token pricing requests no history in any display currency', async () => {
  const urls: string[] = [];
  const contract = '0x' + '11'.repeat(20);
  const read = createNativeAssetMarketReader(async url => {
    urls.push(url);
    assert(!url.includes('/market_chart?'));
    if (url.includes('/contract/')) return Response.json({ id: 'ethereum', platforms: { ethereum: contract } });
    assert.equal(new URL(url).searchParams.get('sparkline'), 'false');
    return Response.json(market({ current_price: url.includes('vs_currency=aed') ? 8080 : 2200 }));
  }, 'price');
  const source = { kind: 'token' as const, platform: 'ethereum', contract };
  for (const currency of ['usd', 'aed'] as const) {
    const data = await read(source, currency, new AbortController().signal);
    assert.equal(data?.price, currency === 'aed' ? 8080 : 2200);
    assert.equal(await read(source, currency, new AbortController().signal), data);
  }
  assert.equal(urls.length, 4, 'Each uncached token price needs only identity and quote');
  assert.throws(() => createNativeAssetMarketReader(async () => Response.json([]), undefined as never));
});

test('AED history comes from the requested-currency endpoint and stays separate from cached USD', async () => {
  const urls: string[] = [], requests: RequestInit[] = [];
  const read = createNativeAssetMarketReader(async (url, init) => {
    urls.push(url); requests.push(init);
    if (url === assetMarketHistoryUrl('ethereum', 'aed')) return Response.json(history());
    return Response.json(market({ current_price: url.includes('vs_currency=aed') ? 8080 : 2200 }));
  }, 'history');
  const source = { kind: 'native' as const, id: 'ethereum' };
  const usd = await read(source, 'usd', new AbortController().signal);
  assert.deepEqual(usd?.prices, [2100, 2200, 2150, 2200]);
  assert.equal(urls.length, 1);
  const aed = await read(source, 'aed', new AbortController().signal);
  assert.equal(aed?.price, 8080); assert.deepEqual(aed?.prices, [7700, 8080]);
  assert.deepEqual(urls, [assetMarketUrl('ethereum', 'usd', 'history'), assetMarketUrl('ethereum', 'aed', 'history'), assetMarketHistoryUrl('ethereum', 'aed')]);
  assert.equal(requests[1]!.signal, requests[2]!.signal, 'One owned deadline covers quote and history');
  for (const request of requests) { assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error'); }
  assert.equal(await read(source, 'aed', new AbortController().signal), aed);
  assert.equal(await read(source, 'usd', new AbortController().signal), usd);
  assert.equal(urls.length, 3);
});

test('failed or invalid AED history keeps the AED quote without using the USD sparkline', async () => {
  for (const result of [Response.json({ prices: [[now, 1], [now, 2]] }), new Response('', { status: 429 }), new Response('x'.repeat(128 * 1024 + 1))]) {
    const read = createNativeAssetMarketReader(async url => url.includes('/market_chart?') ? result : Response.json(market({ current_price: 8080 })), 'history');
    const data = await read({ kind: 'native', id: 'ethereum' }, 'aed', new AbortController().signal);
    assert.equal(data?.price, 8080); assert.deepEqual(data?.prices, []);
  }
});

test('cancelling the history read cannot publish or cache the earlier quote', async () => {
  let entered!: () => void, finish!: (response: Response) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  const read = createNativeAssetMarketReader(async url => {
    calls++;
    if (!url.includes('/market_chart?')) return Response.json(market({ current_price: 8080 }));
    if (calls > 2) return Response.json(history());
    entered(); return new Promise<Response>(resolve => { finish = resolve; });
  }, 'history');
  const source = { kind: 'native' as const, id: 'ethereum' }, owner = new AbortController();
  const pending = read(source, 'aed', owner.signal);
  await started; owner.abort();
  assert.equal(await pending, null);
  finish(Response.json(history()));
  assert.deepEqual((await read(source, 'aed', new AbortController().signal))?.prices, [7700, 8080]);
  assert.equal(calls, 4);
});

test('quote and history share the original eight-second deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let quoteDone!: (response: Response) => void, historyStarted!: () => void;
  const started = new Promise<void>(resolve => { historyStarted = resolve; });
  let signal: AbortSignal | null | undefined;
  const read = createNativeAssetMarketReader(async (url, init) => {
    signal = init.signal;
    if (!url.includes('/market_chart?')) return new Promise<Response>(resolve => { quoteDone = resolve; });
    historyStarted(); return new Promise<Response>(() => undefined);
  }, 'history');
  const pending = read({ kind: 'native', id: 'ethereum' }, 'aed', new AbortController().signal);
  t.mock.timers.tick(7000); quoteDone(Response.json(market({ current_price: 8080 })));
  await started; t.mock.timers.tick(999); assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  const data = await pending;
  assert.equal(signal?.aborted, true); assert.equal(data?.price, 8080); assert.deepEqual(data?.prices, []);
});
