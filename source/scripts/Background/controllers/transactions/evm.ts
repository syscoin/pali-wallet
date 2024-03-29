import flatMap from 'lodash/flatMap';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';

import { IEvmTransactionsController, IEvmTransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
  validateAndManageUserTransactions,
} from './utils';

const EvmTransactionsController = (
  web3Provider: CustomJsonRpcProvider
): IEvmTransactionsController => {
  const getUserTransactionByDefaultProvider = async (
    startBlock: number,
    endBlock: number
  ) => {
    const provider = web3Provider;

    const providerUserTxs = await findUserTxsInProviderByBlocksRange(
      provider,
      startBlock,
      endBlock
    );

    const treatedTxs = validateAndManageUserTransactions(providerUserTxs);

    return treatedTxs as IEvmTransactionResponse[];
  };

  const pollingEvmTransactions = async () => {
    try {
      const currentBlockNumber = store.getState().vault.currentBlock?.number;
      const currentNetworkChainId =
        store.getState().vault.activeNetwork?.chainId;
      const rpcForbiddenList = [10];

      const latestBlockNumber = await web3Provider.getBlockNumber();
      const adjustedBlock =
        latestBlockNumber - parseInt(String(currentBlockNumber), 16);

      let blocksToSearch;

      if (
        currentBlockNumber &&
        currentNetworkChainId &&
        rpcForbiddenList.includes(currentNetworkChainId)
      ) {
        blocksToSearch = Math.min(10, adjustedBlock);
      } else if (
        currentNetworkChainId &&
        rpcForbiddenList.includes(currentNetworkChainId)
      ) {
        blocksToSearch = 10;
      } else if (
        currentBlockNumber &&
        adjustedBlock > 0 &&
        adjustedBlock < 30
      ) {
        blocksToSearch = adjustedBlock;
      } else if (currentBlockNumber && adjustedBlock < 0) {
        blocksToSearch = 30;
      } else {
        blocksToSearch = 30;
      }

      const fromBlock = latestBlockNumber - blocksToSearch;

      const txs = await getUserTransactionByDefaultProvider(
        fromBlock,
        latestBlockNumber
      );

      return flatMap(txs);
    } catch (error) {
      console.log(error);
    }
  };

  return {
    getUserTransactionByDefaultProvider,
    pollingEvmTransactions,
  };
};

export default EvmTransactionsController;
