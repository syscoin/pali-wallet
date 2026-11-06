import type { ChainInfo } from './chainCatalogue';
import type { INetworkType } from '../types/network';
import type { coins } from '@sidhujag/sysweb3-network';

/** Project public suggestions from the pinned SDK coin table. Endpoints are not verified here. */
export function projectUtxoChainCatalogue(
  table: readonly (typeof coins)[number][]
): ChainInfo[] {
  return table.flatMap((coin) => {
    const urls = coin.blockchainLink?.url;
    if (!urls?.length) return [];
    const rpcUrls = Array.isArray(urls) ? urls : [urls];
    const chainId = coin.chainId ?? coin.slip44;
    const name = coin.name || coin.coinLabel;
    const icon =
      coin.coinName?.toLowerCase().replace(/\s+/g, '') ||
      coin.coinLabel?.toLowerCase().replace(/\s+/g, '') ||
      coin.shortcut?.toLowerCase() ||
      coin.coinShortcut?.toLowerCase() ||
      '';
    return [
      {
        chain: 'syscoin' as INetworkType.Syscoin,
        chainId,
        chainSlug: coin.shortcut?.toLowerCase(),
        explorers: rpcUrls.map((url) => ({
          name: coin.name,
          standard: 'blockbook',
          url,
        })),
        icon,
        name,
        nativeCurrency: {
          decimals: coin.decimals,
          name: coin.coinName,
          symbol: coin.coinShortcut || coin.shortcut || '',
        },
        networkId: chainId,
        rpc: rpcUrls.map((url) => ({
          isOpenSource: true,
          tracking: 'none',
          url,
        })),
        shortName: coin.shortcut,
        slip44: coin.slip44,
        coinLabel: coin.coinLabel,
        coinShortcut: coin.coinShortcut,
      },
    ];
  });
}
