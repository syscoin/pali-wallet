import { EVM_NETWORK_DEFINITIONS } from '../../../../source/shared/evmNetworks.ts';
import { assetMarketUrl, readAssetMarket, readTokenMarketId, tokenMarketIdentityUrl, type AssetMarket } from '../../../../source/shared/assetMarket.ts';
import { getDefaultUTXONetworks } from '../../../../source/utils/defaultNetworks.ts';
import { findUtxoNetwork } from '../core/utxoNetworks.ts';
import { isFiatCurrency, type FiatCurrency } from '../core/fiatPreference.ts';
import { NATIVE_NETWORKS, type NativeNetworkRegistration } from '../custody/networkContext.ts';
import type { WalletHttpFetch } from '../platform/httpPolicy.ts';
import { abortable, boundedResponseText, cancelResponseBody } from '../platformRpc.ts';
import { rememberNativeAssetIcon } from './assetIconCache.ts';

export type AssetMarketReference = Readonly<{
  kind: 'native' | 'token'; networkId: string; registration?: NativeNetworkRegistration | null; contractAddress?: string;
}>;
export type AssetMarketSource = Readonly<{ kind: 'native'; id: string } | { kind: 'token'; platform: string; contract: string }>;
/** Reuse only images accompanying the existing verified, registered market read. */
export function rememberNativeAssetMarketIcon(asset: AssetMarketReference, data: AssetMarket): void {
  if (asset.kind !== 'token' || !data.iconUri || !asset.contractAddress || !nativeAssetMarketSource(asset)) return;
  const network = NATIVE_NETWORKS.find(value => value.id === asset.networkId);
  if (!network) return;
  rememberNativeAssetIcon({ kind: 'evm', chainId: network.chainId, contractAddress: asset.contractAddress }, network.registrationHash, data.iconUri);
}
export function nativeAssetMarketSource(asset: AssetMarketReference): AssetMarketSource | null {
  const utxo = findUtxoNetwork(asset.networkId);
  if (utxo) {
    const id = getDefaultUTXONetworks()[utxo.chainId]?.coingeckoId;
    return asset.kind === 'native' && !utxo.testnet && id ? { kind: 'native', id } : null;
  }
  const known = NATIVE_NETWORKS.find(value => value.id === asset.networkId);
  if (!known || known.testnet || (asset.registration && known.registrationHash !== asset.registration.registrationHash)) return null;
  const metadata = EVM_NETWORK_DEFINITIONS.find(value => value.id === asset.networkId)?.network;
  if (asset.kind === 'native') return metadata?.coingeckoId ? { kind: 'native', id: metadata.coingeckoId } : null;
  const contract = asset.contractAddress?.toLowerCase();
  return metadata?.coingeckoPlatformId && contract && /^0x[0-9a-f]{40}$/.test(contract)
    ? { kind: 'token', platform: metadata.coingeckoPlatformId, contract } : null;
}

export function createNativeAssetMarketReader(fetch: WalletHttpFetch, clock = () => performance.now()) {
  const cache = new Map<string, { data: AssetMarket; expires: number }>();
  return async (source: AssetMarketSource, currency: FiatCurrency, owner: AbortSignal): Promise<AssetMarket | null> => {
    if (owner.aborted || !isFiatCurrency(currency)) return null;
    const key = JSON.stringify([source, currency]), cached = cache.get(key);
    if (cached && cached.expires > clock() && cached.expires - clock() <= 300_000) return cached.data;
    const request = new AbortController(), cancel = () => request.abort();
    owner.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 8000);
    const read = async (url: string, limit: number): Promise<unknown> => {
      const pending = fetch(url, { method: 'GET', signal: request.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })
        .then(response => { if (request.signal.aborted) cancelResponseBody(response); return response; });
      const response = await abortable(pending, request.signal);
      if (request.signal.aborted || !response.ok || response.redirected || (response.url && response.url !== url)) {
        cancelResponseBody(response); throw new Error('Market unavailable');
      }
      return JSON.parse(await boundedResponseText(response, request.signal, limit));
    };
    try {
      const id = source.kind === 'native' ? source.id : readTokenMarketId(await read(tokenMarketIdentityUrl(source.platform, source.contract), 512 * 1024), source.platform, source.contract);
      if (!id || request.signal.aborted) return null;
      const data = readAssetMarket(await read(assetMarketUrl(id, currency), 64 * 1024), id, Date.now());
      if (request.signal.aborted || !data) return null;
      cache.delete(key); cache.set(key, { data, expires: clock() + 300_000 });
      if (cache.size > 24) cache.delete(cache.keys().next().value!);
      return data;
    } catch { return null; }
    finally { clearTimeout(timer); owner.removeEventListener('abort', cancel); cancel(); }
  };
}
