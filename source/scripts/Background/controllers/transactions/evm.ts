import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';

import { IPaliAccount } from 'state/vault/types';

import { IEvmTransactionsController, IEvmTransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
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
    networkUrl: string
  ) => {
    try {
      const provider = new ethers.providers.JsonRpcProvider(networkUrl);

      const latestBlockNumber = await provider.getBlockNumber();

      const fromBlock = latestBlockNumber - 30; // Get only the last 30 blocks;

      const txs = await getUserTransactionByDefaultProvider(
        currentAccount,
        networkUrl,
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
    firstRunForProviderTransactions,
    pollingEvmTransactions,
  };
};

export default EvmTransactionsController;
