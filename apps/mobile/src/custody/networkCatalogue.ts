import {
  EVM_CHAIN_CATALOGUE_URL,
  parseEvmChainCatalogue,
} from '../../../../source/shared/chainCatalogueData.ts';
import {
  orderChainRpcs,
  type ChainInfo,
} from '../../../../source/shared/chainCatalogue.ts';
import type { WalletHttpFetch } from '../platform/httpPolicy.ts';
import {
  abortable,
  boundedCatalogueResponseText,
  cancelResponseBody,
} from '../platformRpc.ts';

const CATALOGUE_TIMEOUT_MS = 8000;

export type NativeNetworkSuggestion = Readonly<{
  chainId: number;
  name: string;
  isTestnet: boolean;
  nativeCurrency: Readonly<{ symbol: string }>;
  rpc: readonly [Readonly<{ url: string }>];
}>;

function usableSuggestionUrl(url: string): boolean {
  if (url !== url.trim() || /[{}<>]|%7[bd]|%3[ce]/i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      !parsed.hash;
  } catch {
    return false;
  }
}

function nativeSuggestions(chains: readonly ChainInfo[]): readonly NativeNetworkSuggestion[] {
  const seen = new Set<number>();
  const suggestions: NativeNetworkSuggestion[] = [];
  for (const chain of chains) {
    if (chain.chainId < 1 || chain.nativeCurrency.decimals !== 18 ||
        seen.has(chain.chainId)) continue;
    const rpc = orderChainRpcs(chain.rpc).find(({ url }) => usableSuggestionUrl(url));
    if (!rpc) continue;
    suggestions.push({
      chainId: chain.chainId, name: chain.name, isTestnet: chain.isTestnet === true,
      nativeCurrency: { symbol: chain.nativeCurrency.symbol }, rpc: [{ url: rpc.url }],
    });
    seen.add(chain.chainId);
  }
  return suggestions;
}

/** A network view owns one lazy lookup at a time. Only Retry replaces a failure. */
export function createNativeChainCatalogue(fetch: WalletHttpFetch, timeoutMs = CATALOGUE_TIMEOUT_MS) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new Error('Invalid network catalogue timeout');
  let result: Promise<readonly NativeNetworkSuggestion[]> | undefined;
  let failed = false;

  const load = async () => {
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const request = fetch(EVM_CHAIN_CATALOGUE_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }).then((response) => {
        if (signal.aborted) cancelResponseBody(response);
        return response;
      });
      const response = await abortable(request, signal);
      const contentType = response.headers.get('content-type');
      if (!response.ok || response.redirected ||
          (response.url && response.url !== EVM_CHAIN_CATALOGUE_URL) ||
          (contentType && !/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(contentType))) {
        cancelResponseBody(response);
        throw new Error('Network search unavailable');
      }
      const body = await boundedCatalogueResponseText(response, signal);
      return nativeSuggestions(parseEvmChainCatalogue(JSON.parse(body)));
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };

  return (retry = false) => {
    if (!result || (retry && failed)) {
      failed = false;
      result = Promise.resolve().then(load).catch((error: unknown) => {
        failed = true;
        throw error;
      });
    }
    return result;
  };
}
