import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { IPaliAccount } from 'state/vault/types';

import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import { IEvmTransactionResponse, ITransactionsManager } from './types';

const TransactionsManager = (
  web3Provider: CustomJsonRpcProvider
): ITransactionsManager => {
  const evmTransactionsController = EvmTransactionsController(web3Provider);
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
            await evmTransactionsController.pollingEvmTransactions();

          return getEvmTxs;
        } catch (evmTxError) {
          return evmTxError;
        }
    }
  };
  const checkPendingTransactions = async (
    pendingTransactions: IEvmTransactionResponse[]
  ): Promise<IEvmTransactionResponse[]> => {
    console.log('checkPendingTransactions', pendingTransactions);
    const { currentBlock: stateBlock } = store.getState().vault;
    const latestBlockNumber = stateBlock
      ? parseInt(String(stateBlock.number), 16)
      : await web3Provider.getBlockNumber();

    console.log('latestBlockNumber', latestBlockNumber);

    //todo: we'll need to take care if promise.all will not break anything
    const confirmedTransactions = Promise.all(
      pendingTransactions.map(async (transaction) => {
        const tx = await web3Provider.getTransaction(transaction.hash);
        console.log('tx', tx);
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

    console.log('confirmedTransactions', confirmedTransactions);
    return (await confirmedTransactions).filter((tx) => tx.confirmations > 0);
  };
  return {
    evm: evmTransactionsController,
    sys: SysTransactionController(),
    utils: {
      updateTransactionsFromCurrentAccount,
      checkPendingTransactions,
    },
  };
};

export default TransactionsManager;
