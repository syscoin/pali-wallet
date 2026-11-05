import type { ChainInfo } from './chainCatalogue';
import type { INetworkType } from '../types/network';

export const EVM_CHAIN_CATALOGUE_URL = 'https://chainlist.org/rpcs.json';

const MAX_ROWS = 8192;
const MAX_RPCS = 256;
const MAX_URL_LENGTH = 2048;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown, maxLength: number) =>
  typeof value === 'string' &&
  value.length <= maxLength &&
  value.trim() &&
  !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)
    ? value
    : undefined;

const unsignedInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Project ChainList metadata only. A listed endpoint carries no authority. */
export function parseEvmChainCatalogue(value: unknown): ChainInfo[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS)
    throw new Error('Invalid ChainList data');

  const chains: ChainInfo[] = [];
  for (const entry of value) {
    const row = record(entry);
    const currency = record(row?.nativeCurrency);
    const name = text(row?.name, 200);
    const symbol = text(currency?.symbol, 40);
    const decimals = currency?.decimals;
    const chainId = row?.chainId;
    if (
      !row ||
      !name ||
      !symbol ||
      !unsignedInteger(chainId) ||
      !unsignedInteger(decimals) ||
      decimals > 255
    )
      continue;

    const rpc: ChainInfo['rpc'] = [];
    for (const item of Array.isArray(row.rpc)
      ? row.rpc.slice(0, MAX_RPCS)
      : []) {
      const candidate = record(item);
      const url = text(candidate?.url, MAX_URL_LENGTH);
      if (!url) continue;
      rpc.push({
        url,
        isOpenSource: candidate?.isOpenSource === true,
        tracking: text(candidate?.tracking, 40),
      });
    }

    const explorers: NonNullable<ChainInfo['explorers']> = [];
    for (const item of Array.isArray(row.explorers)
      ? row.explorers.slice(0, 16)
      : []) {
      const candidate = record(item);
      const url = text(candidate?.url, MAX_URL_LENGTH);
      if (url)
        explorers.push({
          name: text(candidate?.name, 200) ?? name,
          standard: text(candidate?.standard, 40),
          url,
        });
    }
    chains.push({
      chain: 'ethereum' as INetworkType.Ethereum,
      chainId,
      chainSlug: text(row.chainSlug, 100),
      explorers,
      icon: text(row.icon, 100),
      infoURL: text(row.infoURL, MAX_URL_LENGTH),
      isTestnet: typeof row.isTestnet === 'boolean' ? row.isTestnet : undefined,
      name,
      nativeCurrency: {
        decimals,
        name: text(currency?.name, 200) ?? symbol,
        symbol,
      },
      networkId: unsignedInteger(row.networkId) ? row.networkId : chainId,
      rpc,
      shortName: text(row.shortName, 100),
    });
  }
  return chains;
}
