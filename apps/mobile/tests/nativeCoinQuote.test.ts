import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeCoinQuoteReader, nativeCoinQuoteSource } from '../src/portfolio/nativeCoinQuote.ts';
import { createNativeNetwork, getNativeNetwork } from '../src/custody/networkContext.ts';

const signal = () => new AbortController().signal;

test('quote identity uses canonical registrations and skips unknown, edited and testnet registrations', () => {
  const { registrationHash: _hash, ...ethereum } = getNativeNetwork('ethereum');
  const edited = createNativeNetwork({ ...ethereum, rpcUrl: 'https://different.invalid/' });
  assert.deepEqual(nativeCoinQuoteSource('ethereum'), { kind: 'evm', asset: 'ethereum' });
  assert.equal(nativeCoinQuoteSource('ethereum', edited), null);
  assert.equal(nativeCoinQuoteSource('utxo:5700'), null);
  assert.equal(nativeCoinQuoteSource('arbitrary'), null);
  assert.equal(nativeCoinQuoteSource('bitcoin')?.kind, 'utxo');
});

test('cache separates the selected currency and expires without requests for wallet identifiers', async () => {
  const calls: string[] = [];
  let now = 100;
  const read = createNativeCoinQuoteReader(async (url, init) => {
    calls.push(url);
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.body, undefined);
    return Response.json({ ethereum: { usd: 100, eur: 200 } });
  }, () => now);
  const source = nativeCoinQuoteSource('ethereum')!;
  assert.deepEqual(await read(source, 'usd', signal()), { price: 100, expiresAt: now + 300_000 });
  assert.equal((await read(source, 'eur', signal()))?.price, 200);
  assert.equal((await read(source, 'usd', signal()))?.price, 100);
  now += 300_000;
  assert.equal((await read(source, 'usd', signal()))?.price, 100);
  assert.deepEqual(calls, ['usd', 'eur', 'usd'].map((code) => `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=${code}&include_24hr_change=true`));
});

test('Blockbook uses its shared ticker route and a real zero is visible without caching it', async () => {
  let calls = 0;
  const source = nativeCoinQuoteSource('bitcoin')!;
  assert.equal(source.kind, 'utxo');
  const read = createNativeCoinQuoteReader(async (url) => {
    assert.equal(url, `${source.endpoint}/api/v2/tickers/currency`);
    return Response.json({ rates: { usd: calls++ === 0 ? 0 : 7 } });
  });
  assert.equal((await read(source, 'usd', signal()))?.price, 0);
  assert.equal((await read(source, 'usd', signal()))?.price, 7);
  assert.equal((await read(source, 'usd', signal()))?.price, 7);
  assert.equal(calls, 2);
});

test('a cancelled, redirected, oversized or invalid quote cannot be used or cached', async () => {
  let release!: (response: Response) => void;
  let calls = 0;
  const source = nativeCoinQuoteSource('ethereum')!;
  const read = createNativeCoinQuoteReader(async () => {
    calls++;
    if (calls === 1) return new Promise((resolve) => { release = resolve; });
    if (calls === 2) return new Response('0', { headers: { 'content-length': '20000' } });
    if (calls === 3) return Object.defineProperty(Response.json({ ethereum: { usd: 60 } }), 'url', { value: 'https://wrong.invalid/' });
    if (calls === 4) return Response.json({ ethereum: { usd: '20' } });
    return Response.json({ ethereum: { usd: 30 } });
  });
  const owner = new AbortController();
  const pending = read(source, 'usd', owner.signal);
  owner.abort();
  assert.equal(await pending, null);
  release(Response.json({ ethereum: { usd: 100 } }));
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(await read(source, 'usd', signal()), null);
  assert.equal((await read(source, 'usd', signal()))?.price, 30);
  assert.equal(calls, 5);
});

test('a malformed preference needs explicit reset and an uncertain save is only reread', async () => {
  const { createFiatPreferences } = await import('../src/core/fiatPreference.ts');
  let raw = 'unsupported';
  let writes = 0;
  let loseAcknowledgement = false;
  const preferences = createFiatPreferences({
    async get() { return raw; },
    async set(value) { raw = value; writes++; if (loseAcknowledgement) throw Error('write acknowledgement lost'); },
  });
  await preferences.reload();
  assert.deepEqual(preferences.getSnapshot(), { status: 'unsupported' });
  assert.equal(await preferences.save('eur'), false);
  assert.equal(writes, 0);
  assert.equal(await preferences.save('usd'), true);
  assert.deepEqual(preferences.getSnapshot(), { status: 'ready', currency: 'usd' });
  loseAcknowledgement = true;
  assert.equal(await preferences.save('eur'), false);
  assert.deepEqual(preferences.getSnapshot(), { status: 'unavailable' });
  await preferences.reload();
  assert.deepEqual(preferences.getSnapshot(), { status: 'ready', currency: 'eur' });
  assert.equal(writes, 2);
});
