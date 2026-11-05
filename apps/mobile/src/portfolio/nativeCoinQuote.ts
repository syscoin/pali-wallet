import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks.ts';
import {
  BLOCKBOOK_TICKER_PATH, coinGeckoNativeQuoteUrl,
  readBlockbookNativeQuote, readCoinGeckoNativeQuote,
} from '../../../../source/shared/nativeCoinQuotes.ts';
import { isFiatCurrency, type FiatCurrency } from '../core/fiatPreference.ts';
import { findUtxoNetwork } from '../core/utxoNetworks.ts';
import { NATIVE_NETWORKS, type NativeNetworkRegistration } from '../custody/networkContext.ts';
import type { WalletHttpFetch } from '../platform/httpPolicy.ts';
import { abortable, boundedResponseText, cancelResponseBody } from '../platformRpc.ts';

type QuoteSource = Readonly<{ kind: 'utxo'; endpoint: string } | { kind: 'evm'; asset: string }>;
const QUOTE_LIFETIME_MS = 5 * 60_000;
export type NativeCoinQuote = Readonly<{ price: number; expiresAt: number }>;
const MAX_QUOTES = 24;
const QUOTE_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

/** Only registered public market identities can produce a quote request. */
export function nativeCoinQuoteSource(id: string, registration?: NativeNetworkRegistration | null): QuoteSource | null {
  const utxo = findUtxoNetwork(id);
  if (utxo) return utxo.testnet ? null : { kind: 'utxo', endpoint: utxo.endpoint };
  const known = NATIVE_NETWORKS.find((value) => value.id === id);
  if (!known || known.testnet || (registration && known.registrationHash !== registration.registrationHash)) return null;
  const asset = EVM_NETWORK_DEFINITIONS.find((value) => value.id === id)?.network.coingeckoId;
  return asset ? { kind: 'evm', asset } : null;
}

export function createNativeCoinQuoteReader(fetch: WalletHttpFetch, now = () => performance.now()) {
  const cache = new Map<string, NativeCoinQuote>();
  return async (source: QuoteSource, currency: FiatCurrency, owner: AbortSignal): Promise<NativeCoinQuote | null> => {
    if (owner.aborted || !isFiatCurrency(currency)) return null;
    const url = source.kind === 'utxo' ? `${source.endpoint}/${BLOCKBOOK_TICKER_PATH}` : coinGeckoNativeQuoteUrl(source.asset, currency);
    const key = `${currency}:${url}`;
    const cached = cache.get(key);
    const remaining = cached ? cached.expiresAt - now() : 0;
    if (cached && remaining > 0 && remaining <= QUOTE_LIFETIME_MS) return cached;
    const request = new AbortController();
    const cancel = () => request.abort();
    const { signal } = request;
    owner.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, REQUEST_TIMEOUT_MS);
    let accepted = false;
    try {
      const pending = fetch(url, { method: 'GET', signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' }).then((response) => {
        if (signal.aborted) cancelResponseBody(response);
        return response;
      });
      const response = await abortable(pending, signal);
      if (signal.aborted || !response.ok || response.redirected || (response.url && response.url !== url)) {
        cancelResponseBody(response);
        return null;
      }
      const body: unknown = JSON.parse(await boundedResponseText(response, signal, QUOTE_RESPONSE_BYTES));
      if (signal.aborted) return null;
      const quote = source.kind === 'utxo' ? readBlockbookNativeQuote(body, currency) : readCoinGeckoNativeQuote(body, source.asset, currency);
      if (!quote) return null;
      const value = Object.freeze({ price: quote.price, expiresAt: now() + QUOTE_LIFETIME_MS });
      if (source.kind !== 'utxo' || quote.price !== 0) {
        cache.delete(key);
        cache.set(key, value);
        if (cache.size > MAX_QUOTES) cache.delete(cache.keys().next().value!);
      }
      accepted = true;
      return value;
    } catch { return null; }
    finally {
      clearTimeout(timer);
      owner.removeEventListener('abort', cancel);
      // Cancelling the response stream alone can leave the native request open.
      if (!accepted && !signal.aborted) cancel();
    }
  };
}
