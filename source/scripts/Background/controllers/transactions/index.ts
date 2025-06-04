import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { IPaliAccount } from 'state/vault/types';

import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import { IEvmTransactionResponse, ITransactionsManager } from './types';

// Cache for transaction results
const transactionCache = new Map();
const CACHE_TTL = 60000; // 1 minute TTL

const TransactionsManager = (
  web3Provider: CustomJsonRpcProvider
): ITransactionsManager => {
  const evmTransactionsController = EvmTransactionsController(web3Provider);

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

  // Helper function to check if account has pending transactions
  const hasPendingTransactions = (
    account: IPaliAccount,
    isBitcoinBased: boolean,
    chainId: number
  ) => {
    const chain = isBitcoinBased ? 'syscoin' : 'ethereum';
    const transactions = account.transactions?.[chain]?.[chainId] || [];
    return (
      Array.isArray(transactions) &&
      transactions.some((tx: any) => tx.confirmations === 0)
    );
  };

  const updateTransactionsFromCurrentAccount = async (
    currentAccount: IPaliAccount,
    isBitcoinBased: boolean,
    activeNetworkUrl: string
  ) => {
    // Clear expired cache entries
    clearExpiredCache();

    const { activeNetwork } = store.getState().vault;

    // Check if this account has pending transactions that need confirmation updates
    const hasUnconfirmedTxs = hasPendingTransactions(
      currentAccount,
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

    try {
      let result;
      if (isBitcoinBased) {
        // Check if the xpub is valid for UTXO (not an Ethereum public key)
        if (currentAccount.xpub && currentAccount.xpub.startsWith('0x')) {
          console.error(
            'Invalid xpub for UTXO network - account has Ethereum public key instead of Bitcoin xpub'
          );
          // Return empty array for invalid xpub
          return [];
        }

        result = await SysTransactionController().pollingSysTransactions(
          currentAccount.xpub,
          activeNetworkUrl
        );
      } else {
        result = await evmTransactionsController.pollingEvmTransactions();
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
    } catch (error) {
      console.error('Transaction polling error:', error);
      return error;
    }
  };

  const checkPendingTransactions = async (
    pendingTransactions: IEvmTransactionResponse[]
  ): Promise<IEvmTransactionResponse[]> => {
    const { currentBlock: stateBlock, isBitcoinBased } = store.getState().vault;

    // Don't check pending transactions for UTXO networks
    if (isBitcoinBased) {
      console.log('Skipping pending transaction check for UTXO network');
      return [];
    }

    const latestBlockNumber = stateBlock
      ? parseInt(String(stateBlock.number), 16)
      : await web3Provider.getBlockNumber();

    //todo: we'll need to take care if promise.all will not break anything
    const confirmedTransactions = await Promise.all(
      pendingTransactions.map(async (transaction) => {
        const tx = await web3Provider.getTransaction(transaction.hash);
        return {
          ...transaction,
          confirmations:
            tx.blockNumber <= latestBlockNumber
              ? latestBlockNumber - tx.blockNumber
              : 0,
          blockNumber: tx.blockNumber ?? null,
          blockHash: tx.blockHash ?? null,
        };
      })
    );

    return confirmedTransactions.filter((tx) => tx.confirmations > 0);
  };

  const clearCache = () => {
    transactionCache.clear();
  };

  return {
    evm: evmTransactionsController,
    sys: SysTransactionController(),
    utils: {
      updateTransactionsFromCurrentAccount,
      checkPendingTransactions,
      clearCache,
    },
  };
};

export default TransactionsManager;
