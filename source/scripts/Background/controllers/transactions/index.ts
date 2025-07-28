import {
  CustomJsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';

import store from 'state/store';
import { IAccountTransactions } from 'state/vault/types';
import { isTransactionInBlock } from 'utils/transactionUtils';

import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import { ITransactionsManager } from './types';
// Cache for transaction results
const transactionCache = new Map();
const CACHE_TTL = 60000; // 1 minute TTL

const TransactionsManager = (): ITransactionsManager => {
  const clearExpiredCache = () => {
    const now = Date.now();
    for (const [key, value] of transactionCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        transactionCache.delete(key);
      }
    }
  };

  const getCacheKey = (account: string, networkUrl: string) =>
    `${account}:${networkUrl}`;

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
    web3Provider: CustomJsonRpcProvider,
    accountTransactions?: IAccountTransactions,
    isPolling?: boolean,
    isRapidPolling?: boolean
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
      activeNetworkUrl
    );

    // Only use cache if there are no pending transactions
    // This ensures we always get fresh data when confirmations might have changed
    if (!hasUnconfirmedTxs) {
      const cachedResult = transactionCache.get(cacheKey);
      if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
        return cachedResult.data;
      }
    }
    let result;
    if (isBitcoinBased) {
      result = await SysTransactionController().pollingSysTransactions(
        currentAccount.xpub,
        activeNetworkUrl
      );
    } else {
      if (!web3Provider) {
        console.error('No valid web3Provider for EVM transaction polling');
        return [];
      }
      result = await EvmTransactionsController().pollingEvmTransactions(
        web3Provider,
        isPolling,
        isRapidPolling
      );
    }
    // Cache the result only if no pending transactions
    // This prevents caching stale confirmation data
    if (!hasUnconfirmedTxs) {
      transactionCache.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
      });
    }

    return result;
  };
  const clearCache = () => {
    transactionCache.clear();
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
