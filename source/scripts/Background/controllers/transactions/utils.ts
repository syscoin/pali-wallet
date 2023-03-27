import { ethers } from 'ethers';
import { range, flatMap, isEqual } from 'lodash';

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

      const filterTxsByAddress = currentBlock.transactions.filter(
        (tx) =>
          tx.from.toLowerCase() === userAddress.toLowerCase() ||
          tx.to.toLowerCase() === userAddress.toLowerCase()
      );

      return flatMap(filterTxsByAddress);
    })
  );

  return flatMap(userProviderTxs);
};

export const validateAndManageUserTransactions = (
  providerTxs: ITransactionResponse[]
) => {
  const { accounts, activeAccount } = store.getState().vault;

  const { transactions: userTransactions } = accounts[activeAccount];

  const userTxsLimitLength = userTransactions.length >= 30;

  const compareArrays = (arrayToCompare: ITransactionResponse[]) => {
    const clonedUserTxsArray = [...userTransactions] as ITransactionResponse[];

    const isArrayEquals = isEqual(clonedUserTxsArray, arrayToCompare);

    return !isArrayEquals ? arrayToCompare : [];
  };

  const manageAndDealTxs = (tx: ITransactionResponse) => {
    const txAlreadyExists = Boolean(
      userTransactions.find(
        (txs: ITransactionResponse) =>
          txs.hash.toLowerCase() === tx.hash.toLowerCase()
      )
    );
    switch (txAlreadyExists) {
      //Only try to update Confirmations property if is different
      case true:
        const manageArray = [...userTransactions] as ITransactionResponse[];

        const searchForTxIndex = manageArray.findIndex(
          (userTxs) =>
            userTxs.hash.toLowerCase() === tx.hash.toLowerCase() &&
            userTxs.confirmations !== tx.confirmations
        );

        if (searchForTxIndex === -1) break;

        manageArray.map((item) => {
          if (item.hash !== manageArray[searchForTxIndex].hash) return item;
          return { ...item, confirmations: tx.confirmations };
        });

        return compareArrays(manageArray);

      case false:
        if (!userTxsLimitLength) {
          const arrayToAdd = [...userTransactions];

          arrayToAdd.unshift(tx);

          return compareArrays(arrayToAdd);
        } else {
          const arrayToManage = [...userTransactions];

          arrayToManage.pop();

          arrayToManage.unshift(tx);

          return compareArrays(arrayToManage);
        }
      default:
        break;
    }
  };

  const treatedTxs = flatMap(providerTxs.map((tx) => manageAndDealTxs(tx)));

  return treatedTxs;
};
