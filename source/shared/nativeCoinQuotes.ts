/** Quote contracts shared by the wallet hosts; no transport or wallet identifiers. */
export const FIAT_QUOTE_CURRENCIES = Object.freeze([
  'aed',
  'ars',
  'aud',
  'bch',
  'bdt',
  'bhd',
  'bits',
  'bmd',
  'bnb',
  'brl',
  'btc',
  'cad',
  'chf',
  'clp',
  'cny',
  'czk',
  'dkk',
  'dot',
  'eos',
  'eth',
  'eur',
  'gbp',
  'gel',
  'hkd',
  'huf',
  'idr',
  'ils',
  'inr',
  'jpy',
  'krw',
  'kwd',
  'link',
  'lkr',
  'ltc',
  'mmk',
  'mxn',
  'myr',
  'ngn',
  'nok',
  'nzd',
  'php',
  'pkr',
  'pln',
  'rub',
  'sar',
  'sats',
  'sek',
  'sgd',
  'sol',
  'thb',
  'try',
  'twd',
  'uah',
  'usd',
  'vef',
  'vnd',
  'xag',
  'xau',
  'xdr',
  'xlm',
  'xrp',
  'yfi',
  'zar',
] as const);

export const BLOCKBOOK_TICKER_PATH = 'api/v2/tickers/currency';

export function coinGeckoNativeQuoteUrl(
  asset: string,
  currency: string
): string {
  return `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    asset
  )}&vs_currencies=${encodeURIComponent(currency)}&include_24hr_change=true`;
}

type Quote = { available: true; price: number; priceChange24h?: number };

function field(body: unknown, key: string): unknown {
  return body !== null && typeof body === 'object' && Object.hasOwn(body, key)
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

export function readCoinGeckoNativeQuote(
  body: unknown,
  asset: string,
  currency: string
): Quote | undefined {
  const values = field(body, asset);
  const price = field(values, currency);
  if (typeof price !== 'number' || !Number.isFinite(price)) return;
  const change = field(values, `${currency}_24h_change`);
  return {
    available: true,
    price,
    priceChange24h:
      typeof change === 'number' && Number.isFinite(change)
        ? change
        : undefined,
  };
}

export function readBlockbookNativeQuote(
  body: unknown,
  currency: string
): Quote | undefined {
  const price = field(field(body, 'rates'), currency);
  if (typeof price !== 'number' || !Number.isFinite(price)) return;
  return { available: true, price, priceChange24h: undefined };
}
