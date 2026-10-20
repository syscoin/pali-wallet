import { IKeyringAccountState } from '@sidhujag/sysweb3-keyring';

import { getController } from 'scripts/Background';
import store from 'state/store';
import { IAccountTransactions } from 'state/vault/types';
import { isTransactionInBlock } from 'utils/transactionUtils';

import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import { ITransactionsManager } from './types';
// Cache for transaction results
const transactionCache = new Map();
interface ITransactionRead {
  full: boolean;
  promise: Promise<any>;
  scope?: string;
  startedAt: number;
}
const transactionCacheOwners = new Map<string, ITransactionRead>();
const CACHE_TTL = 60000; // 1 minute TTL
const IN_FLIGHT_TTL = 5000; // Match the transport deduplication window.

const TransactionsManager = (): ITransactionsManager => {
  const clearExpiredCache = () => {
    const now = Date.now();
    for (const [key, value] of transactionCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        transactionCache.delete(key);
      }
    }
  };

  const getCacheKey = (account: string, networkUrl: string, apiUrl?: string) =>
    `${account}:${networkUrl}${apiUrl ? `:${apiUrl}` : ''}`;

  // Helper function to check if account has pending transactions based on passed transaction data
  const hasPendingTransactions = (
    accountTransactions: any,
    isBitcoinBased: boolean,
    chainId: number
  ) => {
    const chain = isBitcoinBased ? 'syscoin' : 'ethereum';
    const transactions = accountTransactions?.[chain]?.[chainId] || [];
    return (
      Array.isArray(transactions) &&
      transactions.some((tx: any) => !isTransactionInBlock(tx))
    );
  };
  const updateTransactionsFromCurrentAccount = async (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    activeNetworkUrl: string,
    accountTransactions?: IAccountTransactions,
    isPolling?: boolean,
    isRapidPolling?: boolean,
    forceRefresh?: boolean,
    requestScope?: string,
    isCurrentRead?: () => boolean
  ) => {
    // Clear expired cache entries
    clearExpiredCache();

    const { activeNetwork } = store.getState().vault;

    // Check if this account has pending transactions that need confirmation updates
    const hasUnconfirmedTxs = hasPendingTransactions(
      accountTransactions,
      isBitcoinBased,
      activeNetwork.chainId
    );

    // Generate cache key
    const cacheKey = getCacheKey(
      isBitcoinBased ? currentAccount.xpub : currentAccount.address,
      activeNetworkUrl,
      isBitcoinBased ? undefined : activeNetwork.apiUrl
    );

    const pendingRead = transactionCacheOwners.get(cacheKey);
    if (
      !forceRefresh &&
      pendingRead?.full &&
      pendingRead.scope === requestScope
    ) {
      if (Date.now() - pendingRead.startedAt <= IN_FLIGHT_TTL)
        return pendingRead.promise;
      // A stuck full read must not block retry or become a rapid local no-op.
      forceRefresh = true;
    }

    // Only use cache if there are no pending transactions
    // This ensures we always get fresh data when confirmations might have changed
    if (!forceRefresh && !hasUnconfirmedTxs) {
      const cachedResult = transactionCache.get(cacheKey);
      if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
        return cachedResult.data;
      }
    }
    // Once a fresh read starts, older completed data must not overtake it.
    transactionCache.delete(cacheKey);
    const cacheOwner = {
      full: !isRapidPolling || Boolean(forceRefresh),
      scope: requestScope,
      startedAt: Date.now(),
    } as ITransactionRead;
    transactionCacheOwners.set(cacheKey, cacheOwner);
    cacheOwner.promise = (async () => {
      try {
        let result;
        if (isBitcoinBased) {
          result = await SysTransactionController().pollingSysTransactions(
            currentAccount.xpub,
            activeNetworkUrl,
            isRapidPolling && !forceRefresh
          );
        } else {
          // Always pull the latest provider at call time (prevents stale references across network switches)
          const web3Provider =
            getController().wallet.ethereumTransaction.web3Provider;
          result = await EvmTransactionsController().pollingEvmTransactions(
            web3Provider,
            isPolling,
            isRapidPolling && !forceRefresh,
            isCurrentRead
          );
        }
        // Cache the result only if no pending transactions
        // This prevents caching stale confirmation data
        if (
          !hasUnconfirmedTxs &&
          transactionCacheOwners.get(cacheKey) === cacheOwner
        ) {
          transactionCache.set(cacheKey, {
            data: result,
            timestamp: Date.now(),
          });
        }

        return result;
      } finally {
        if (transactionCacheOwners.get(cacheKey) === cacheOwner)
          transactionCacheOwners.delete(cacheKey);
      }
    })();
    return cacheOwner.promise;
  };
  const clearCache = () => {
    transactionCache.clear();
    transactionCacheOwners.clear();
  };

  return {
    sys: SysTransactionController(),
    utils: {
      updateTransactionsFromCurrentAccount,
      clearCache,
    },
  };
};

export default TransactionsManager;
