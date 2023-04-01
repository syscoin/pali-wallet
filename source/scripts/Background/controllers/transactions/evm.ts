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
  let LAST_PROCESSED_BLOCK = -1;

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

    console.log('providerUserTxs', providerUserTxs);

    const treatedTxs = validateAndManageUserTransactions(providerUserTxs);

    console.log('treatedTxsEVM', treatedTxs);

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

    LAST_PROCESSED_BLOCK = toBlock;

    return txs;
  };

  const pollingEvmTransactions = async (
    isBitcoinBased: boolean,
    currentAccount: IKeyringAccountState,
    networkUrl: string
  ) => {
    store.dispatch(setIsLoadingTxs(true));
    const provider = new ethers.providers.JsonRpcProvider(networkUrl);

    const latestBlockNumber = await provider.getBlockNumber();

    const fromBlock = latestBlockNumber - 30; // Get only the last 30 blocks;

    if (Boolean(isBitcoinBased || latestBlockNumber === LAST_PROCESSED_BLOCK)) {
      return;
    }

    const txs = await getUserTransactionByDefaultProvider(
      currentAccount,
      networkUrl,
      fromBlock,
      latestBlockNumber
    );

    console.log('after tx', txs);
    LAST_PROCESSED_BLOCK = latestBlockNumber;

    store.dispatch(setIsLoadingTxs(false));
    return flatMap(txs);
  };

  return {
    getUserTransactionByDefaultProvider,
    firstRunForProviderTransactions,
    pollingEvmTransactions,
  };
};

export default EvmTransactionsController;
