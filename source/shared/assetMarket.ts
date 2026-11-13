import { trustedAssetIconUri } from './assetIconIdentity.ts';

/** Public display data only. Never use market quotes for transaction amounts. */
export type AssetMarket = Readonly<{
  change24h: number | null;
  high24h: number | null;
  iconUri?: string;
  low24h: number | null;
  marketCap: number | null;
  price: number;
  prices: readonly number[];
  updatedAt: number;
}>;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
export const validMarketId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);

/** Shared plot geometry keeps the visible line and interactive sample marker aligned. */
export function assetMarketCoordinates(
  prices: readonly number[]
): readonly { x: number; y: number }[] | null {
  if (
    prices.length < 2 ||
    prices.length > 241 ||
    !prices.every((value) => positive(value) !== null)
  )
    return null;
  const low = Math.min(...prices),
    range = Math.max(...prices) - low;
  return prices.map((value, index) => ({
    x: (index * 300) / (prices.length - 1),
    y: range ? 112 - ((value - low) / range) * 104 : 60,
  }));
}

export function assetMarketLine(prices: readonly number[]): string | null {
  return (
    assetMarketCoordinates(prices)
      ?.map(
        ({ x, y }, index) =>
          `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
      )
      .join(' ') ?? null
  );
}

export type AssetMarketPurpose = 'price' | 'history';

export function assetMarketUrl(
  id: string,
  currency: string,
  purpose: AssetMarketPurpose
): string {
  if (
    !validMarketId(id) ||
    !/^[a-z]{2,8}$/.test(currency) ||
    !['price', 'history'].includes(purpose)
  )
    throw new Error('Invalid market identity');
  return `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&ids=${id}&sparkline=${
    purpose === 'history' && currency === 'usd'
  }&price_change_percentage=24h`;
}

export function assetMarketHistoryUrl(id: string, currency: string): string {
  if (!validMarketId(id) || !/^[a-z]{2,8}$/.test(currency))
    throw new Error('Invalid market identity');
  return `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=${currency}&days=7`;
}

const samplePrices = (prices: readonly number[]): readonly number[] =>
  Object.freeze(
    prices.filter(
      (_, index) =>
        index % Math.ceil(prices.length / 240) === 0 ||
        index === prices.length - 1
    )
  );

/** /market_chart returns ordered [Unix milliseconds, requested-currency price] pairs. */
export function readAssetMarketHistory(
  body: unknown,
  now: number
): readonly number[] {
  const raw = record(body)?.prices;
  if (
    !Number.isFinite(now) ||
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.length > 1024
  )
    return [];
  let previous = -1;
  const prices: number[] = [];
  for (const point of raw) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isSafeInteger(point[0]) ||
      point[0] <= previous ||
      point[0] < now - 8 * 86_400_000 ||
      point[0] > now + 300_000 ||
      positive(point[1]) === null
    )
      return [];
    previous = point[0];
    prices.push(point[1]);
  }
  return previous < now - 86_400_000 ? [] : samplePrices(prices);
}

export function tokenMarketIdentityUrl(
  platform: string,
  contract: string
): string {
  if (!validMarketId(platform) || !/^0x[0-9a-f]{40}$/.test(contract))
    throw new Error('Invalid market identity');
  return `https://api.coingecko.com/api/v3/coins/${platform}/contract/${contract}`;
}

export function readTokenMarketId(
  body: unknown,
  platform: string,
  contract: string
): string | null {
  const data = record(body),
    address = record(data?.platforms)?.[platform];
  return validMarketId(data?.id) &&
    typeof address === 'string' &&
    address.toLowerCase() === contract.toLowerCase()
    ? data.id
    : null;
}

export function readAssetMarket(
  body: unknown,
  id: string,
  currency: string,
  now: number
): AssetMarket | null {
  if (
    !/^[a-z]{2,8}$/.test(currency) ||
    !Array.isArray(body) ||
    body.length !== 1
  )
    return null;
  const data = record(body[0]);
  if (!data || data.id !== id) return null;
  const price = positive(data.current_price);
  const updatedAt =
    typeof data.last_updated === 'string' ? Date.parse(data.last_updated) : NaN;
  if (
    price === null ||
    !Number.isFinite(updatedAt) ||
    updatedAt > now + 300_000 ||
    updatedAt < now - 86_400_000
  )
    return null;
  // CoinGecko's market-list sparkline is USD, even for another vs_currency.
  const raw =
    currency === 'usd' ? record(data.sparkline_in_7d)?.price : undefined;
  const valid =
    Array.isArray(raw) &&
    raw.length >= 2 &&
    raw.length <= 1024 &&
    raw.every((value) => positive(value) !== null);
  const prices = valid ? samplePrices(raw) : [];
  return Object.freeze({
    ...(trustedAssetIconUri(data.image)
      ? { iconUri: trustedAssetIconUri(data.image)! }
      : {}),
    price,
    updatedAt,
    prices: Object.freeze(prices),
    change24h:
      typeof data.price_change_percentage_24h === 'number' &&
      Number.isFinite(data.price_change_percentage_24h)
        ? data.price_change_percentage_24h
        : null,
    high24h: positive(data.high_24h),
    low24h: positive(data.low_24h),
    marketCap: positive(data.market_cap),
  });
}
