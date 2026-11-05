import type { INetworkType } from '../types/network';

export type ChainInfo = {
  chain: INetworkType;
  chainId: number;
  chainSlug?: string;
  coinLabel?: string;
  coinShortcut?: string;
  explorers?: Array<{
    name: string;
    standard?: string;
    url: string;
  }>;
  icon?: string;
  infoURL?: string;
  name: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  networkId: number;
  rpc: Array<{
    isOpenSource?: boolean;
    tracking?: string;
    url: string;
  }>;
  shortName?: string;
  slip44?: number;
};

export function rankChainSuggestions(
  chains: readonly ChainInfo[],
  query: string
): Array<ChainInfo & { score: number }> {
  if (query.trim().length < 2) return [];
  const lowerQuery = query.toLowerCase().trim();

  const results: Array<ChainInfo & { score: number }> = [];
  for (const chain of chains) {
    let score = 0;
    const name = chain.name.toLowerCase();
    const symbol = chain.nativeCurrency.symbol.toLowerCase();
    const chainId = chain.chainId.toString();
    const coinLabel = chain.coinLabel?.toLowerCase() || '';
    const coinShortcut = chain.coinShortcut?.toLowerCase() || '';

    if (name === lowerQuery) score += 100;
    else if (name.startsWith(lowerQuery)) score += 50;
    else if (name.includes(lowerQuery)) score += 25;

    if (symbol === lowerQuery) score += 80;
    else if (symbol.startsWith(lowerQuery)) score += 40;
    else if (symbol.includes(lowerQuery)) score += 20;

    if (chainId === query) score += 90;
    else if (chainId.startsWith(query)) score += 45;

    if (coinLabel === lowerQuery) score += 100;
    else if (coinLabel.startsWith(lowerQuery)) score += 50;
    else if (coinLabel.includes(lowerQuery)) score += 25;

    if (coinShortcut === lowerQuery) score += 80;
    else if (coinShortcut.startsWith(lowerQuery)) score += 40;

    if (score > 0 && chain.rpc && chain.rpc.length > 0)
      results.push({ ...chain, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 6);
}

function rpcPreference(rpc: ChainInfo['rpc'][number]): number {
  if (rpc.tracking === 'none') return rpc.isOpenSource ? 100 : 50;
  return rpc.isOpenSource ? 25 : 0;
}

/** Prefer no tracking, then open source. Preserve catalogue order for ties. */
export function orderChainRpcs(rpcs: readonly ChainInfo['rpc'][number][]) {
  return [...rpcs].sort((a, b) => rpcPreference(b) - rpcPreference(a));
}
