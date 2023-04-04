import sys from 'syscoinjs-lib';

import store from 'state/store';
import { setIsLoadingTxs } from 'state/vault';

import { ISysTransaction, ISysTransactionsController } from './types';

const SysTransactionController = (): ISysTransactionsController => {
  const getInitialUserTransactionsByXpub = async (
    xpub: string,
    networkUrl: string
  ): Promise<ISysTransaction[]> => {
    try {
      const requestOptions = 'details=txs&pageSize=30';

      const { transactions }: { transactions: ISysTransaction[] } =
        await sys.utils.fetchBackendAccount(
          networkUrl,
          xpub,
          requestOptions,
          true
        );

      return transactions;
    } catch (error) {
      return error;
    }
  };

  const pollingSysTransactions = async (
    xpub: string,
    networkUrl: string
  ): Promise<ISysTransaction[]> => {
    store.dispatch(setIsLoadingTxs(true));

    const getSysTxs = await getInitialUserTransactionsByXpub(xpub, networkUrl);

    store.dispatch(setIsLoadingTxs(false));

    return getSysTxs;
  };

  return {
    getInitialUserTransactionsByXpub,
    pollingSysTransactions,
  };
};

export default SysTransactionController;
