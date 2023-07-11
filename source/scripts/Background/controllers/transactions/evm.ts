import flatMap from 'lodash/flatMap';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { IPaliAccount } from 'state/vault/types';

import { Queue } from './queue';
import { IEvmTransactionsController, IEvmTransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
  getFormattedEvmTransactionResponse,
  validateAndManageUserTransactions,
} from './utils';

const EvmTransactionsController = (
  web3Provider: CustomJsonRpcProvider
): IEvmTransactionsController => {
  const getUserTransactionByDefaultProvider = async (
    currentAccount: IPaliAccount,
    startBlock: number,
    endBlock: number
  ) => {
    const provider = web3Provider;

    const providerUserTxs = await findUserTxsInProviderByBlocksRange(
      provider,
      currentAccount.address,
      startBlock,
      endBlock
    );

    const treatedTxs = validateAndManageUserTransactions(providerUserTxs);

    return treatedTxs as IEvmTransactionResponse[];
  };

  const pollingEvmTransactions = async (currentAccount: IPaliAccount) => {
    try {
      const currentBlockNumber =
        store.getState().vault.currentBlockNumber?.number;
      const currentNetworkChainId =
        store.getState().vault.activeNetwork?.chainId;
      const rpcForbiddenList = [10];

      const queue = new Queue(3);
      const latestBlockNumber = await web3Provider.getBlockNumber();
      const blocksToSearch = currentBlockNumber
        ? latestBlockNumber - parseInt(currentBlockNumber, 16)
        : rpcForbiddenList.includes(currentNetworkChainId)
        ? 10
        : 30;

      const fromBlock = latestBlockNumber - blocksToSearch;

      const txs = await getUserTransactionByDefaultProvider(
        currentAccount,
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
                web3Provider,
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
    pollingEvmTransactions,
  };
};

export default EvmTransactionsController;
