import { compact } from 'lodash';
import sys from 'syscoinjs-lib';

import { ISysTransaction, ISysTransactionsController } from './types';
import { validateAndManageUserTransactions } from './utils';

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
    const getSysTxs = await getInitialUserTransactionsByXpub(xpub, networkUrl);

    const treatedSysTxs = validateAndManageUserTransactions(getSysTxs);

    const validateIfManageState = Boolean(
      compact(getSysTxs as ISysTransaction[]).length === 0 ||
        compact(treatedSysTxs as ISysTransaction[]).length === 0
    );
    //This mean that we don't have any TXs to update in state, so we can stop here
    if (validateIfManageState) return;

    return treatedSysTxs as ISysTransaction[];
  };

  return {
    getInitialUserTransactionsByXpub,
    pollingSysTransactions,
  };
};

export default SysTransactionController;
