import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { setIsLoadingTxs } from 'state/vault';

import { IEvmTransactionsController, IEvmTransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
  validateAndManageUserTransactions,
} from './utils';

const EvmTransactionsController = (): IEvmTransactionsController => {
  const getUserTransactionByDefaultProvider = async (
    currentAccount: IKeyringAccountState,
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
    currentAccount: IKeyringAccountState,
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
    currentAccount: IKeyringAccountState,
    networkUrl: string
  ) => {
    store.dispatch(setIsLoadingTxs(true));
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
    } finally {
      store.dispatch(setIsLoadingTxs(false));
    }
  };

  return {
    getUserTransactionByDefaultProvider,
    firstRunForProviderTransactions,
    pollingEvmTransactions,
  };
};

export default EvmTransactionsController;
