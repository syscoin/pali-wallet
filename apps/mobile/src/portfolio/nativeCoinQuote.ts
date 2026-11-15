import { findRegisteredEvmNetwork } from '../../../../source/shared/evmNetworks.ts';
import {
  BLOCKBOOK_TICKER_PATH, coinGeckoNativeQuoteUrl,
  readBlockbookNativeQuote, readCoinGeckoNativeQuote,
} from '../../../../source/shared/nativeCoinQuotes.ts';
import { isFiatCurrency, type FiatCurrency } from '../core/fiatPreference.ts';
import { resolveUtxoNetwork, type UtxoNetwork } from '../core/utxoNetworks.ts';
import { findKnownNativeNetwork, type NativeNetworkRegistration } from '../custody/networkContext.ts';
import type { WalletHttpFetch } from '../platform/httpPolicy.ts';
import { abortable, boundedResponseText, cancelResponseBody } from '../platformRpc.ts';

type QuoteSource = Readonly<{ kind: 'utxo'; endpoint: string } | { kind: 'evm'; asset: string }>;
export type NativeCoinQuoteNetwork = NativeNetworkRegistration | UtxoNetwork;
export const QUOTE_LIFETIME_MS = 5 * 60_000;
export type NativeCoinQuote = Readonly<{ price: number; expiresAt: number }>;
const MAX_QUOTES = 24;
const QUOTE_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

/** Only registered public market identities can produce a quote request. */
export function nativeCoinQuoteSource(registration: NativeCoinQuoteNetwork | null): QuoteSource | null {
  if (!registration) return null;
  if (registration.kind === 'utxo') {
    try {
      const utxo = resolveUtxoNetwork(registration);
      return utxo.testnet ? null : { kind: 'utxo', endpoint: utxo.endpoint };
    } catch { return null; }
  }
  const known = findKnownNativeNetwork(registration.id, registration);
  if (!known || known.testnet) return null;
  const asset = findRegisteredEvmNetwork(known)?.network.coingeckoId;
  return asset ? { kind: 'evm', asset } : null;
}

type PendingQuote = {
  promise: Promise<NativeCoinQuote | null>;
  request: AbortController;
  subscribers: number;
  settled: boolean;
};

export function createNativeCoinQuoteReader(fetch: WalletHttpFetch, now = () => performance.now()) {
  const cache = new Map<string, NativeCoinQuote>();
  const pending = new Map<string, PendingQuote>();
  const load = async (source: QuoteSource, currency: FiatCurrency, url: string, key: string, work: PendingQuote) => {
    const { request } = work, { signal } = request;
    const timer = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
    let accepted = false;
    try {
      const result = fetch(url, { method: 'GET', signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' }).then((response) => {
        if (signal.aborted) cancelResponseBody(response);
        return response;
      });
      const response = await abortable(result, signal);
      if (signal.aborted || !response.ok || response.redirected || (response.url && response.url !== url)) {
        cancelResponseBody(response);
        return null;
      }
      const body: unknown = JSON.parse(await boundedResponseText(response, signal, QUOTE_RESPONSE_BYTES));
      if (signal.aborted) return null;
      const quote = source.kind === 'utxo' ? readBlockbookNativeQuote(body, currency) : readCoinGeckoNativeQuote(body, source.asset, currency);
      if (!quote) return null;
      const value = Object.freeze({ price: quote.price, expiresAt: now() + QUOTE_LIFETIME_MS });
      if (pending.get(key) === work && work.subscribers && (source.kind !== 'utxo' || quote.price !== 0)) {
        cache.delete(key);
        cache.set(key, value);
        if (cache.size > MAX_QUOTES) cache.delete(cache.keys().next().value!);
      }
      accepted = true;
      return value;
    } catch { return null; }
    finally {
      clearTimeout(timer);
      if (!accepted && !signal.aborted) request.abort();
    }
  };
  return async (source: QuoteSource, currency: FiatCurrency, owner: AbortSignal): Promise<NativeCoinQuote | null> => {
    if (owner.aborted || !isFiatCurrency(currency)) return null;
    const url = source.kind === 'utxo' ? `${source.endpoint}/${BLOCKBOOK_TICKER_PATH}` : coinGeckoNativeQuoteUrl(source.asset, currency);
    const key = `${currency}:${url}`;
    const cached = cache.get(key);
    const remaining = cached ? cached.expiresAt - now() : 0;
    if (cached && remaining > 0 && remaining <= QUOTE_LIFETIME_MS) return cached;
    let work = pending.get(key);
    if (!work || work.request.signal.aborted) {
      work = { request: new AbortController(), subscribers: 0, settled: false, promise: Promise.resolve(null) };
      pending.set(key, work);
      const captured = work;
      work.promise = load(source, currency, url, key, work).finally(() => {
        captured.settled = true;
        if (pending.get(key) === captured) pending.delete(key);
      });
    }
    const selected = work;
    selected.subscribers++;
    return new Promise(resolve => {
      let done = false;
      const finish = (value: NativeCoinQuote | null) => {
        if (done) return;
        done = true;
        owner.removeEventListener('abort', cancel);
        selected.subscribers--;
        if (!selected.settled && !selected.subscribers) selected.request.abort();
        resolve(owner.aborted ? null : value);
      };
      const cancel = () => finish(null);
      owner.addEventListener('abort', cancel, { once: true });
      selected.promise.then(finish, () => finish(null));
    });
  };
}
