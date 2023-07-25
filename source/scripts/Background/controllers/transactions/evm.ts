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

      // const queue = new Queue(3);
      const latestBlockNumber = await web3Provider.getBlockNumber();
      const adjustedBlock =
        latestBlockNumber - parseInt(String(currentBlockNumber), 16);

      const blocksToSearch =
        currentBlockNumber && adjustedBlock < 30
          ? adjustedBlock
          : rpcForbiddenList.includes(currentNetworkChainId)
          ? 10
          : 30;

      const fromBlock = latestBlockNumber - blocksToSearch;

      const txs = await getUserTransactionByDefaultProvider(
        fromBlock,
        latestBlockNumber
      );

      // //Doing this we prevent cases that user is receiving TX from other account and the
      // //RPC don't response the TX with Timestamp properly
      // queue.execute(
      //   async () =>
      //     await Promise.all(
      //       txs.map(async (pollingTx) => {
      //         if (pollingTx?.timestamp) {
      //           return pollingTx;
      //         }

      //         const getTxTimestamp = await getFormattedEvmTransactionResponse(
      //           web3Provider,
      //           pollingTx
      //         );

      //         return getTxTimestamp;
      //       })
      //     )
      // );

      // const results = await queue.done();

      // const txsWithTimestamp = results
      //   .filter((result) => result.success)
      //   .map(({ result }) => result);

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
