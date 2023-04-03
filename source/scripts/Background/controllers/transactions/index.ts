import { ethers } from 'ethers';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import {
  IEvmTransactionResponse,
  ISysTransaction,
  ITransactionsManager,
} from './types';
import {
  getFormattedEvmTransactionResponse,
  manageAndDealWithUserTxs,
} from './utils';

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

  const getTransactionsToSaveAfterSend = async (
    isBitcoinBased: boolean,
    tx: IEvmTransactionResponse | ISysTransaction,
    networkUrl?: string
  ) => {
    if (isBitcoinBased) {
      const treatedTxs = manageAndDealWithUserTxs(tx);

      return treatedTxs;
    } else {
      const provider = new ethers.providers.JsonRpcProvider(networkUrl);

      const formattedTx = await getFormattedEvmTransactionResponse(
        provider,
        tx as IEvmTransactionResponse
      );

      const treatedTxs = manageAndDealWithUserTxs(formattedTx);

      return treatedTxs;
    }
  };

  return {
    evm: EvmTransactionsController(),
    sys: SysTransactionController(),
    utils: {
      updateTransactionsFromCurrentAccount,
      getTransactionsToSaveAfterSend,
    },
  };
};

export default TransactionsManager;
