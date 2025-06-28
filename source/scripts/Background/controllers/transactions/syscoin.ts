import clone from 'lodash/clone';

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import store from 'state/store';
import { TransactionsType } from 'state/vault/types';

import { ISysTransaction, ISysTransactionsController } from './types';
import { treatAndSortTransactions } from './utils';

const SysTransactionController = (): ISysTransactionsController => {
  const getInitialUserTransactionsByXpub = async (
    xpub: string,
    networkUrl: string
  ): Promise<ISysTransaction[]> => {
    try {
      const requestOptions = 'details=txs&pageSize=30';

      const { transactions }: { transactions: ISysTransaction[] } =
        await fetchBackendAccountCached(networkUrl, xpub, requestOptions, true);

      // Ensure we always return an array, even if transactions is falsy
      return Array.isArray(transactions) ? transactions : [];
    } catch (error) {
      console.error('Error fetching transactions by xpub:', error);
      // Re-throw the error so it propagates up and keeps loading state active
      throw error;
    }
  };

  const pollingSysTransactions = async (
    xpub: string,
    networkUrl: string
  ): Promise<ISysTransaction[]> => {
    const { activeAccount, activeNetwork, accountTransactions } =
      store.getState().vault;

    const getSysTxs = await getInitialUserTransactionsByXpub(xpub, networkUrl);

    // Ensure syscoinUserTransactions is always an array
    const syscoinUserTransactions = clone(
      accountTransactions[activeAccount.type]?.[activeAccount.id]?.[
        TransactionsType.Syscoin
      ]?.[activeNetwork.chainId] || []
    ) as ISysTransaction[];

    // Ensure both values are arrays before spreading
    const validGetSysTxs = Array.isArray(getSysTxs) ? getSysTxs : [];
    const validSyscoinUserTransactions = Array.isArray(syscoinUserTransactions)
      ? syscoinUserTransactions
      : [];

    const mergedArrays = [...validGetSysTxs, ...validSyscoinUserTransactions];

    // Use the optimized function that deduplicates, sorts, and limits in one go
    return treatAndSortTransactions(mergedArrays, 30) as ISysTransaction[];
  };

  return {
    getInitialUserTransactionsByXpub,
    pollingSysTransactions,
  };
};

export default SysTransactionController;
