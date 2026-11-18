import { findRegisteredEvmNetwork } from '../../../../source/shared/evmNetworks.ts';
import { assetMarketHistoryUrl, assetMarketUrl, readAssetMarket, readAssetMarketHistory, readTokenMarketId, tokenMarketIdentityUrl, type AssetMarket, type AssetMarketPurpose } from '../../../../source/shared/assetMarket.ts';
import { getDefaultUTXONetworks } from '../../../../source/utils/defaultNetworks.ts';
import { findUtxoNetwork, resolveUtxoNetwork, type UtxoNetwork } from '../core/utxoNetworks.ts';
import { isFiatCurrency, type FiatCurrency } from '../core/fiatPreference.ts';
import { findKnownNativeNetwork, type NativeNetworkRegistration } from '../custody/networkContext.ts';
import type { WalletHttpFetch } from '../platform/httpPolicy.ts';
import { readPublicMarketJson } from '../../../../source/shared/publicMarketRead.ts';
import { rememberNativeAssetIcon } from './assetIconCache.ts';

export type AssetMarketReference = Readonly<{
  kind: 'native' | 'token'; networkId: string; registration?: NativeNetworkRegistration | UtxoNetwork | null; contractAddress?: string;
}>;
export type AssetMarketSource = Readonly<{ kind: 'native'; id: string } | { kind: 'token'; platform: string; contract: string }>;
/** Reader-local monotonic expiry, separate from the provider's updatedAt. */
export type NativeAssetMarketResult = Readonly<{ data: AssetMarket; expiresAt: number }>;
export const nativeAssetMarketNow = () => performance.now();
/** Reuse only images accompanying the existing verified, registered market read. */
export function rememberNativeAssetMarketIcon(asset: AssetMarketReference, data: AssetMarket): void {
  if (asset.kind !== 'token' || !data.iconUri || !asset.contractAddress || !nativeAssetMarketSource(asset)) return;
  const network = findKnownNativeNetwork(asset.networkId, asset.registration?.kind === 'utxo' ? undefined : asset.registration);
  if (!network) return;
  rememberNativeAssetIcon({ kind: 'evm', chainId: network.chainId, contractAddress: asset.contractAddress }, network.registrationHash, data.iconUri);
}
export function nativeAssetMarketSource(asset: AssetMarketReference): AssetMarketSource | null {
  let utxo = findUtxoNetwork(asset.networkId);
  if (asset.registration?.kind === 'utxo') {
    try {
      utxo = resolveUtxoNetwork(asset.registration);
      if (utxo.id !== asset.networkId) return null;
    } catch { return null; }
  }
  if (utxo) {
    const id = getDefaultUTXONetworks()[utxo.chainId]?.coingeckoId;
    return asset.kind === 'native' && !utxo.testnet && id ? { kind: 'native', id } : null;
  }
  const known = findKnownNativeNetwork(asset.networkId, asset.registration?.kind === 'utxo' ? undefined : asset.registration);
  if (!known || known.testnet) return null;
  const metadata = findRegisteredEvmNetwork(known)?.network;
  if (asset.kind === 'native') return metadata?.coingeckoId ? { kind: 'native', id: metadata.coingeckoId } : null;
  const contract = asset.contractAddress?.toLowerCase();
  return metadata?.coingeckoPlatformId && contract && /^0x[0-9a-f]{40}$/.test(contract)
    ? { kind: 'token', platform: metadata.coingeckoPlatformId, contract } : null;
}

type MarketReadWork = {
  promise: Promise<NativeAssetMarketResult | null>;
  controller: AbortController;
  subscribers: number;
  settled: boolean;
};

function createMarketCache() {
  return {
    tokenIds: new Map<string, { id: string; expiresAt: number }>(),
    quotes: new Map<string, NativeAssetMarketResult>(),
  };
}

export function createNativeAssetMarketReader(
  fetch: WalletHttpFetch,
  purpose: AssetMarketPurpose,
  clock = nativeAssetMarketNow,
  market = createMarketCache()
) {
  if (purpose !== 'price' && purpose !== 'history') throw new Error('Invalid market purpose');
  const cache = new Map<string, NativeAssetMarketResult>();
  const { tokenIds, quotes } = market;
  const pending = new Map<string, MarketReadWork>();
  const tokenId = async (source: Extract<AssetMarketSource, { kind: 'token' }>, read: (url: string, limit: number) => Promise<unknown>, signal: AbortSignal) => {
    const key = JSON.stringify([source.platform, source.contract]);
    const cached = tokenIds.get(key), remaining = cached ? cached.expiresAt - clock() : 0;
    if (cached && remaining > 0 && remaining <= 86_400_000) return cached.id;
    const id = readTokenMarketId(await read(tokenMarketIdentityUrl(source.platform, source.contract), 512 * 1024), source.platform, source.contract);
    if (id && !signal.aborted) {
      tokenIds.delete(key); tokenIds.set(key, { id, expiresAt: clock() + 86_400_000 });
      if (tokenIds.size > 24) tokenIds.delete(tokenIds.keys().next().value!);
    }
    return id;
  };
  const load = async (source: AssetMarketSource, currency: FiatCurrency, key: string, request: AbortController) => {
    const timer = setTimeout(() => request.abort(), 8000);
    const read = (url: string, limit: number): Promise<unknown> => readPublicMarketJson(fetch, url, limit, request.signal);
    try {
      const id = source.kind === 'native' ? source.id : await tokenId(source, read, request.signal);
      if (!id || request.signal.aborted) return null;
      const quoteKey = JSON.stringify([id, currency]);
      const cachedQuote = quotes.get(quoteKey);
      const quote = cachedQuote && cachedQuote.expiresAt > clock() && cachedQuote.expiresAt - clock() <= 300_000
        ? Promise.resolve(cachedQuote)
        : read(assetMarketUrl(id, currency), 64 * 1024).then(body => {
          const data = readAssetMarket(body, id, currency, Date.now());
          if (!data || request.signal.aborted) return null;
          return Object.freeze({ data, expiresAt: clock() + 300_000 });
        });
      const history = purpose === 'history'
        ? read(assetMarketHistoryUrl(id, currency), 128 * 1024).then(body => readAssetMarketHistory(body, Date.now())).catch(() => [])
        : null;
      const observed = await quote;
      if (request.signal.aborted || !observed) return null;
      const samples = history ? await history : null;
      const result = samples
        ? Object.freeze({ ...observed, data: Object.freeze({ ...observed.data,
          prices: Object.freeze(samples.map(point => point.price)),
          priceTimestamps: Object.freeze(samples.map(point => point.timestamp)) }) })
        : observed;
      if (pending.get(key)?.controller === request && pending.get(key)?.subscribers) {
        if (observed !== cachedQuote) {
          quotes.delete(quoteKey);
          quotes.set(quoteKey, observed);
          if (quotes.size > 24) quotes.delete(quotes.keys().next().value!);
        }
        cache.delete(key); cache.set(key, result);
        if (cache.size > 24) cache.delete(cache.keys().next().value!);
      }
      return result;
    } catch { return null; }
    finally { clearTimeout(timer); request.abort(); }
  };
  return async (source: AssetMarketSource, currency: FiatCurrency, owner: AbortSignal): Promise<NativeAssetMarketResult | null> => {
    if (owner.aborted || !isFiatCurrency(currency)) return null;
    const key = JSON.stringify([source, currency]), cached = cache.get(key), now = clock();
    if (cached && cached.expiresAt > now && cached.expiresAt - now <= 300_000) return cached;
    let work = pending.get(key);
    if (!work || work.controller.signal.aborted) {
      const controller = new AbortController();
      work = { controller, subscribers: 0, settled: false, promise: Promise.resolve(null) };
      pending.set(key, work);
      const captured = work;
      work.promise = load(source, currency, key, controller).finally(() => {
        captured.settled = true;
        if (pending.get(key) === captured) pending.delete(key);
      });
    }
    const selected = work;
    selected.subscribers++;
    return new Promise(resolve => {
      let complete = false;
      const finish = (result: NativeAssetMarketResult | null) => {
        if (complete) return;
        complete = true;
        owner.removeEventListener('abort', cancel);
        selected.subscribers--;
        if (!selected.subscribers && !selected.settled) selected.controller.abort();
        resolve(owner.aborted ? null : result);
      };
      const cancel = () => finish(null);
      owner.addEventListener('abort', cancel, { once: true });
      selected.promise.then(finish, () => finish(null));
    });
  };
}

export function createNativeAssetMarketReaders(fetch: WalletHttpFetch, clock = nativeAssetMarketNow) {
  const market = createMarketCache();
  return {
    price: createNativeAssetMarketReader(fetch, 'price', clock, market),
    history: createNativeAssetMarketReader(fetch, 'history', clock, market),
  };
}

const marketReaders = new WeakMap<WalletHttpFetch, ReturnType<typeof createNativeAssetMarketReaders>>();
export function nativeAssetMarketReaders(fetch: WalletHttpFetch) {
  const existing = marketReaders.get(fetch);
  if (existing) return existing;
  const readers = createNativeAssetMarketReaders(fetch);
  marketReaders.set(fetch, readers);
  return readers;
}
