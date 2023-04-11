import { IPaliAccount } from 'state/vault/types';

import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import { ITransactionsManager } from './types';

const TransactionsManager = (): ITransactionsManager => {
  const updateTransactionsFromCurrentAccount = async (
    currentAccount: IPaliAccount,
    isBitcoinBased: boolean,
    activeNetworkUrl: string
  ) => {
    switch (isBitcoinBased) {
      case true:
        try {
          const getSysTxs =
            await SysTransactionController().pollingSysTransactions(
              currentAccount.xpub,
              activeNetworkUrl
            );

          return getSysTxs;
        } catch (sysTxError) {
          return sysTxError;
        }
      case false:
        try {
          const getEvmTxs =
            await EvmTransactionsController().pollingEvmTransactions(
              currentAccount,
              activeNetworkUrl
            );

          return getEvmTxs;
        } catch (evmTxError) {
          return evmTxError;
        }
    }
  };
  return {
    evm: EvmTransactionsController(),
    sys: SysTransactionController(),
    utils: {
      updateTransactionsFromCurrentAccount,
    },
  };
};

export default TransactionsManager;
