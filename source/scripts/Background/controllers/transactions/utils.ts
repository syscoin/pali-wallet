import { ethers } from 'ethers';
import { compact, range, flatMap } from 'lodash';

import store from 'state/store';

import { ITransactionResponse } from './types';

export const getTransactionTimestamp = async (
  provider:
    | ethers.providers.EtherscanProvider
    | ethers.providers.JsonRpcProvider,
  transaction: ITransactionResponse
) => {
  const { timestamp } = await provider.getBlock(
    Number(transaction.blockNumber)
  );

  return {
    ...transaction,
    timestamp,
  } as ITransactionResponse;
};

export const getFormattedTransactionResponse = async (
  provider:
    | ethers.providers.EtherscanProvider
    | ethers.providers.JsonRpcProvider,
  transaction: ITransactionResponse
) => {
  const tx = await provider.getTransaction(transaction.hash);

  if (!tx) {
    return await getTransactionTimestamp(provider, transaction);
  }
  return await getTransactionTimestamp(provider, tx);
};

export const findUserTxsInProviderByBlocksRange = async (
  provider:
    | ethers.providers.EtherscanProvider
    | ethers.providers.JsonRpcProvider,
  userAddress: string,
  startBlock: number,
  endBlock: number
): Promise<ITransactionResponse[]> => {
  const rangeBlocksToRun = range(startBlock, endBlock);
  console.log('rangeBlocksToRun', rangeBlocksToRun);

  const userProviderTxs = await Promise.all(
    rangeBlocksToRun.map(async (blockNumber) => {
      const currentBlock = await provider.getBlockWithTransactions(blockNumber);

      const filterTxsByAddress = currentBlock.transactions.filter((tx) => {
        const isTxValidForCurrentUser = Boolean(
          tx.from.toLowerCase() === userAddress.toLowerCase() ||
            tx.to.toLowerCase() === userAddress.toLowerCase()
        );

        if (isTxValidForCurrentUser) return tx;

        return [];
      });

      return filterTxsByAddress;
    })
  );

  return flatMap(compact(userProviderTxs));
};

export const validateAndManageUserTransactions = (
  providerTx: ITransactionResponse
) => {
  const { accounts, activeAccount } = store.getState().vault;

  const { transactions: userTransactions } = accounts[activeAccount];

  const userTxsLimitLength = userTransactions.length >= 30;

  const clonedUserTxs: ITransactionResponse[] = [...userTransactions];

  const txAlreadyExists = Boolean(
    clonedUserTxs.find(
      (txs: ITransactionResponse) =>
        txs.hash.toLowerCase() === providerTx.hash.toLowerCase()
    )
  );

  console.log('outside switch', clonedUserTxs);

  switch (txAlreadyExists) {
    //Only try to update Confirmations property if is different
    case true:
      const searchForTxIndex = clonedUserTxs.findIndex(
        (userTxs) =>
          userTxs.hash.toLowerCase() === providerTx.hash.toLowerCase() &&
          userTxs.confirmations !== providerTx.confirmations
      );

      if (searchForTxIndex === -1) break;

      const updatedTxsValue = [
        ...clonedUserTxs,
        (clonedUserTxs[searchForTxIndex].confirmations =
          providerTx.confirmations),
      ];

      return updatedTxsValue;

    case false:
      if (!userTxsLimitLength) {
        console.log('before unshift', clonedUserTxs);
        clonedUserTxs.unshift(providerTx);

        console.log('later unshift', clonedUserTxs);

        return clonedUserTxs;
      } else {
        console.log('before pop', clonedUserTxs);
        clonedUserTxs.pop();

        console.log('later pop', clonedUserTxs);

        clonedUserTxs.unshift(providerTx);

        console.log('later unshift', clonedUserTxs);

        return clonedUserTxs;
      }
    default:
      break;
  }
};
