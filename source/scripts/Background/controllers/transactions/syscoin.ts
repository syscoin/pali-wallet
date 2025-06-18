import clone from 'lodash/clone';

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import store from 'state/store';
import { TransactionsType } from 'state/vault/types';

import { ISysTransaction, ISysTransactionsController } from './types';
import { treatDuplicatedTxs } from './utils';

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
      // Return empty array instead of error object to prevent iteration issues
      return [];
    }
  };

  const pollingSysTransactions = async (
    xpub: string,
    networkUrl: string
  ): Promise<ISysTransaction[]> => {
    const { accounts, activeAccount, activeNetwork } = store.getState().vault;

    const { transactions: userTransactions } =
      accounts[activeAccount.type][activeAccount.id];

    const getSysTxs = await getInitialUserTransactionsByXpub(xpub, networkUrl);

    // Ensure syscoinUserTransactions is always an array
    const syscoinUserTransactions = clone(
      userTransactions?.[TransactionsType.Syscoin]?.[activeNetwork.chainId] ||
        []
    ) as ISysTransaction[];

    // Ensure both values are arrays before spreading
    const validGetSysTxs = Array.isArray(getSysTxs) ? getSysTxs : [];
    const validSyscoinUserTransactions = Array.isArray(syscoinUserTransactions)
      ? syscoinUserTransactions
      : [];

    const mergedArrays = [...validGetSysTxs, ...validSyscoinUserTransactions];

    return treatDuplicatedTxs(mergedArrays) as ISysTransaction[];
  };

  return {
    getInitialUserTransactionsByXpub,
    pollingSysTransactions,
  };
};

export default SysTransactionController;
