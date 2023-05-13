import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';

import { IPaliAccount } from 'state/vault/types';

import { Queue } from './queue';
import { IEvmTransactionsController, IEvmTransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
  getFormattedEvmTransactionResponse,
  validateAndManageUserTransactions,
} from './utils';

const EvmTransactionsController = (): IEvmTransactionsController => {
  const getUserTransactionByDefaultProvider = async (
    currentAccount: IPaliAccount,
    networkUrl: string,
    startBlock: number,
    endBlock: number
  ) => {
    const provider = new ethers.providers.JsonRpcProvider(networkUrl);

    const providerUserTxs = await findUserTxsInProviderByBlocksRange(
      provider,
      currentAccount.address,
      startBlock,
      endBlock
    );

    const treatedTxs = validateAndManageUserTransactions(providerUserTxs);

    return treatedTxs as IEvmTransactionResponse[];
  };

  const firstRunForProviderTransactions = async (
    currentAccount: IPaliAccount,
    networkUrl: string
  ) => {
    const provider = new ethers.providers.JsonRpcProvider(networkUrl);

    const latestBlockNumber = await provider.getBlockNumber();
    const fromBlock = latestBlockNumber - 30; // Get only the last 30 blocks
    const toBlock = latestBlockNumber;

    const txs = await getUserTransactionByDefaultProvider(
      currentAccount,
      networkUrl,
      fromBlock,
      toBlock
    );

    return txs;
  };

  const pollingEvmTransactions = async (
    currentAccount: IPaliAccount,
    networkUrl: string,
    provider: any
  ) => {
    try {
      const queue = new Queue(3);
      const latestBlockNumber = await provider.getBlockNumber();

      const fromBlock = latestBlockNumber - 30; // Get only the last 30 blocks;

      const txs = await getUserTransactionByDefaultProvider(
        currentAccount,
        networkUrl,
        fromBlock,
        latestBlockNumber
      );

      //Doing this we prevent cases that user is receiving TX from other account and the
      //RPC don't response the TX with Timestamp properly
      queue.execute(
        async () =>
          await Promise.all(
            txs.map(async (pollingTx) => {
              if (pollingTx?.timestamp) {
                return pollingTx;
              }

              const getTxTimestamp = await getFormattedEvmTransactionResponse(
                provider,
                pollingTx
              );

              return getTxTimestamp;
            })
          )
      );

      const results = await queue.done();

      const txsWithTimestamp = results
        .filter((result) => result.success)
        .map(({ result }) => result);

      return flatMap(txsWithTimestamp);
    } catch (error) {
      console.log(error);
    }
  };

  return {
    getUserTransactionByDefaultProvider,
    firstRunForProviderTransactions,
    pollingEvmTransactions,
  };
};

export default EvmTransactionsController;
