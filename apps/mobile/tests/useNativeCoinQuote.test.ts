import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeNetwork, getNativeNetwork, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import { formatIndicativeFiat } from '../src/portfolio/fiatDisplay.ts';
import { createNativeCoinQuoteReader, nativeCoinQuoteSource, QUOTE_LIFETIME_MS } from '../src/portfolio/nativeCoinQuote.ts';
import { screenFixture } from './screenFixture.ts';

type QuoteView = Readonly<{ supported: boolean; quote: string | null }>;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const response = (price = 100) => Response.json({ ethereum: { usd: price, eur: price }, rates: { usd: price, eur: price } });

function fixture(platform = 'ios', language = 'en') {
  let now = 0, serial = 0, currency = 'usd';
  let responder: (index: number) => Promise<Response> = async () => response();
  const requests: { url: string; signal: AbortSignal }[] = [];
  const timers = new Map<number, { callback(): void; due: number }>();
  const listeners = new Map<string, Set<() => void>>();
  const appState = {
    currentState: 'active',
    addEventListener(event: string, callback: () => void) {
      const entries = listeners.get(event) ?? new Set();
      listeners.set(event, entries); entries.add(callback);
      return { remove() { entries.delete(callback); } };
    },
  };
  const host = screenFixture(new URL('../src/portfolio/useNativeCoinQuote.ts', import.meta.url), 'useNativeCoinQuote', {
    'react-native': { AppState: appState, Platform: { OS: platform } },
    '../platform/localization': { useNativeTranslation: () => ({ i18n: { resolvedLanguage: language, language } }) },
    '../platform/fiatPreferences': { useFiatCurrency: () => ({ status: 'ready', currency }) },
    '../platform/http': { walletFetch: async (url: string, init: { signal: AbortSignal }) => {
      requests.push({ url, signal: init.signal });
      return responder(requests.length);
    } },
    './nativeCoinQuote.ts': { nativeCoinQuoteSource, QUOTE_LIFETIME_MS,
      createNativeCoinQuoteReader: (fetch: Parameters<typeof createNativeCoinQuoteReader>[0]) => createNativeCoinQuoteReader(fetch, () => now) },
    './fiatDisplay.ts': { formatIndicativeFiat },
  }, {
    AbortController, performance: { now: () => now },
    setTimeout(callback: () => void, delay: number) { const id = ++serial; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  return {
    requests, close: host.close,
    render(id: string | null = 'ethereum', amount: string | null = '2', registration?: NativeNetworkRegistration | null) {
      return host.render(id, amount, registration) as unknown as QuoteView;
    },
    setCurrency(value: string) { currency = value; },
    setLanguage(value: string) { language = value; },
    setResponder(value: typeof responder) { responder = value; },
    async advance(milliseconds: number) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((left, right) => left[1].due - right[1].due)[0];
        if (!next) break;
        now = next[1].due; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = target; await flush();
    },
    emit(event: string, state = appState.currentState) {
      appState.currentState = state;
      for (const listener of listeners.get(event) ?? []) (listener as (state: string) => void)(state);
    },
  };
}

test('an active quote refreshes at its existing expiry without overlapping a held renewal', async () => {
  const f = fixture(), renewal = Promise.withResolvers<Response>();
  try {
    f.setResponder(async index => index === 1 ? response(100) : renewal.promise);
    f.render(); await flush();
    assert.equal(f.render().quote, formatIndicativeFiat(200, 'usd', 'en'));
    await f.advance(QUOTE_LIFETIME_MS - 1); assert.equal(f.requests.length, 1);
    await f.advance(1); assert.equal(f.requests.length, 2);
    assert.equal(f.render().quote, null, 'The expired price must not remain visible during renewal');
    f.emit('change', 'active'); await f.advance(QUOTE_LIFETIME_MS);
    assert.equal(f.requests.length, 2, 'Only one renewal may be in flight');
    renewal.resolve(response(120)); await flush();
    assert.equal(f.render().quote, formatIndicativeFiat(240, 'usd', 'en'));
  } finally { renewal.resolve(response()); f.close(); }
});

for (const failure of ['unavailable', 'rejected'] as const) test(`an initial ${failure} quote retries only after the existing lifetime`, async () => {
  const f = fixture();
  try {
    f.setResponder(async index => {
      if (index > 1) return response();
      if (failure === 'rejected') throw new Error('Offline');
      return new Response('', { status: 503 });
    });
    f.render(); await flush(); assert.equal(f.render().quote, null);
    await f.advance(QUOTE_LIFETIME_MS - 1); assert.equal(f.requests.length, 1);
    await f.advance(1); assert.equal(f.requests.length, 2);
    assert.equal(f.render().quote, formatIndicativeFiat(200, 'usd', 'en'));
  } finally { f.close(); }
});

test('amount-only updates recalculate locally and a fresh cache survives temporary balance unavailability', async () => {
  const f = fixture();
  try {
    f.render(); await flush();
    assert.equal(f.render('ethereum', '3').quote, formatIndicativeFiat(300, 'usd', 'en'));
    assert.equal(f.requests.length, 1);
    assert.equal(f.render('ethereum', null).quote, null);
    f.render(); await flush();
    assert.equal(f.render().quote, formatIndicativeFiat(200, 'usd', 'en'));
    assert.equal(f.requests.length, 1, 'The same reader must reuse its unexpired cache');
  } finally { f.close(); }
});

for (const event of ['background', 'blur', 'unmount'] as const) test(`${event} cancels the scheduled renewal`, async () => {
  const f = fixture('android');
  let closed = false;
  try {
    f.render(); await flush();
    if (event === 'unmount') { f.close(); closed = true; }
    else f.emit(event === 'background' ? 'change' : 'blur', event === 'background' ? 'background' : 'active');
    await f.advance(QUOTE_LIFETIME_MS * 2);
    assert.equal(f.requests.length, 1);
    if (!closed) {
      assert.equal(f.render().quote, null);
      f.emit(event === 'background' ? 'change' : 'focus', 'active'); await flush();
      assert.equal(f.requests.length, 2);
      assert.equal(f.render().quote, formatIndicativeFiat(200, 'usd', 'en'));
    }
  } finally { if (!closed) f.close(); }
});

for (const change of ['network', 'currency', 'registration', 'background', 'blur', 'unmount'] as const) test(`${change} retires a pending read and ignores its late response`, async () => {
  const f = fixture('android'), pending = Promise.withResolvers<Response>();
  let closed = false;
  try {
    f.setResponder(async index => index === 1 ? pending.promise : response(150));
    const canonical = getNativeNetwork('ethereum');
    f.render('ethereum', '2', canonical);
    assert.equal(f.requests.length, 1);
    let view: QuoteView | undefined;
    if (change === 'network') view = f.render('bitcoin');
    else if (change === 'currency') { f.setCurrency('eur'); view = f.render('ethereum', '2', canonical); }
    else if (change === 'registration') {
      const { registrationHash: _hash, ...fields } = canonical;
      view = f.render('ethereum', '2', createNativeNetwork({ ...fields, rpcUrl: 'https://changed.invalid' }));
    } else if (change === 'unmount') { f.close(); closed = true; }
    else f.emit(change === 'background' ? 'change' : 'blur', change === 'background' ? 'background' : 'active');
    assert(f.requests[0]);
    assert.equal(f.requests[0].signal.aborted, true);
    pending.resolve(response(999)); await flush();
    if (change === 'network') view = f.render('bitcoin');
    else if (change === 'currency') view = f.render('ethereum', '2', canonical);
    if (change === 'network' || change === 'currency') {
      assert.equal(f.requests.length, 2);
      assert.equal(view?.quote, formatIndicativeFiat(300, change === 'currency' ? 'eur' : 'usd', 'en'));
    } else {
      assert.equal(f.requests.length, 1);
      if (view) assert.equal(view.quote, null);
      await f.advance(QUOTE_LIFETIME_MS * 2); assert.equal(f.requests.length, 1);
    }
  } finally { pending.resolve(response()); if (!closed) f.close(); }
});

test('changing Pali language reformats an existing quote without another price request', async () => {
  const f = fixture('ios', 'de');
  try {
    f.setCurrency('eur'); f.render('ethereum', '12.3456'); await flush();
    assert.equal(f.render('ethereum', '12.3456').quote, '≈ 1.234,56 EUR');
    const requests = f.requests.length;
    f.setLanguage('en');
    assert.equal(f.render('ethereum', '12.3456').quote, '≈ 1,234.56 EUR');
    assert.equal(f.requests.length, requests);
  } finally { f.close(); }
});
