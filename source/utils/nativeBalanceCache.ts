import type {
  IKeyringAccountState,
  INativeBalanceCacheEntry,
  INetwork,
} from 'types/network';

export const NATIVE_BALANCE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_NETWORKS_PER_ACCOUNT = 25;

export const getNativeBalanceCacheKey = (
  network: Pick<INetwork, 'chainId' | 'kind' | 'url'>
): string =>
  JSON.stringify([network.kind, Number(network.chainId), network.url]);

export const isSameBalanceNetwork = (
  first: Pick<INetwork, 'chainId' | 'kind' | 'url'>,
  second: Pick<INetwork, 'chainId' | 'kind' | 'url'>
): boolean =>
  first.kind === second.kind &&
  Number(first.chainId) === Number(second.chainId) &&
  first.url === second.url;

export const getFreshNativeBalance = (
  account: Pick<IKeyringAccountState, 'nativeBalanceCache'>,
  network: Pick<INetwork, 'chainId' | 'kind' | 'url'>,
  now = Date.now()
): INativeBalanceCacheEntry | null => {
  const entry = account.nativeBalanceCache?.[getNativeBalanceCacheKey(network)];
  if (!entry || now - entry.updatedAt >= NATIVE_BALANCE_CACHE_TTL_MS) {
    return null;
  }

  return entry;
};

export const updateNativeBalanceCache = (
  cache: IKeyringAccountState['nativeBalanceCache'],
  network: Pick<INetwork, 'chainId' | 'kind' | 'url'>,
  balance: number | string,
  updatedAt = Date.now()
): Record<string, INativeBalanceCacheEntry> => {
  const entries = Object.entries({
    ...cache,
    [getNativeBalanceCacheKey(network)]: { balance, updatedAt },
  })
    .filter(
      ([, entry]) => updatedAt - entry.updatedAt < NATIVE_BALANCE_CACHE_TTL_MS
    )
    .sort(([, first], [, second]) => second.updatedAt - first.updatedAt)
    .slice(0, MAX_CACHED_NETWORKS_PER_ACCOUNT);

  return Object.fromEntries(entries);
};
