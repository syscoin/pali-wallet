import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import { ITransactionsManager } from './types';

const TransactionsManager = (): ITransactionsManager => {
  const updateTransactionsFromCurrentAccount = async (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    activeNetworkUrl: string
  ) => {
    switch (isBitcoinBased) {
      case true:
        try {
          const getSysTxs =
            await SysTransactionController().getInitialUserTransactionsByXpub(
              currentAccount.xpub,
              activeNetworkUrl
            );

          return getSysTxs;
        } catch (sysUpdateTxs) {
          return sysUpdateTxs;
        }
      case false:
        try {
          const getEvmTxs =
            await EvmTransactionsController().firstRunForProviderTransactions(
              currentAccount,
              activeNetworkUrl
            );

          return getEvmTxs;
        } catch (evmUpdateTxs) {
          return evmUpdateTxs;
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
