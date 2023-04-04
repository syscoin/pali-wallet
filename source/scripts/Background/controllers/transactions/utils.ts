import { ethers } from 'ethers';
import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import range from 'lodash/range';
import uniqWith from 'lodash/uniqWith';

import store from 'state/store';

import { ISysTransaction, IEvmTransactionResponse } from './types';

export const getEvmTransactionTimestamp = async (
  provider:
    | ethers.providers.EtherscanProvider
    | ethers.providers.JsonRpcProvider,
  transaction: IEvmTransactionResponse
) => {
  const { timestamp } = await provider.getBlock(
    Number(transaction.blockNumber)
  );

  return {
    ...transaction,
    timestamp,
  } as IEvmTransactionResponse;
};

export const getFormattedEvmTransactionResponse = async (
  provider:
    | ethers.providers.EtherscanProvider
    | ethers.providers.JsonRpcProvider,
  transaction: IEvmTransactionResponse
) => {
  const tx = await provider.getTransaction(transaction.hash);

  if (!tx) {
    return await getEvmTransactionTimestamp(provider, transaction);
  }
  return await getEvmTransactionTimestamp(provider, tx);
};

export const findUserTxsInProviderByBlocksRange = async (
  provider:
    | ethers.providers.EtherscanProvider
    | ethers.providers.JsonRpcProvider,
  userAddress: string,
  startBlock: number,
  endBlock: number
): Promise<IEvmTransactionResponse[]> => {
  const rangeBlocksToRun = range(startBlock, endBlock);

  const userProviderTxs = await Promise.all(
    rangeBlocksToRun.map(async (blockNumber) => {
      const currentBlock = await provider.getBlockWithTransactions(blockNumber);

      const filterTxsByAddress = currentBlock.transactions.filter(
        (tx) =>
          tx?.from?.toLowerCase() === userAddress.toLowerCase() ||
          tx?.to?.toLowerCase() === userAddress.toLowerCase()
      );

      return flatMap(filterTxsByAddress);
    })
  );

  return flatMap(userProviderTxs);
};

const treatDuplicatedTxs = (transactions: IEvmTransactionResponse[]) =>
  uniqWith(
    transactions,
    (a: IEvmTransactionResponse, b: IEvmTransactionResponse) => {
      if (a.hash.toLowerCase() === b.hash.toLowerCase()) {
        // Keep the transaction with the higher confirmation number
        console.log(a.hash.toLowerCase() === b.hash.toLowerCase());
        if (a.confirmations > b.confirmations) {
          // Preserve timestamp if available
          if (b.timestamp && !a.timestamp) {
            a.timestamp = b.timestamp;
          }
        } else {
          // Preserve timestamp if available
          if (a.timestamp && !b.timestamp) {
            b.timestamp = a.timestamp;
          }
        }
        return true;
      }
      return false;
    }
  );

export const validateAndManageUserTransactions = (
  providerTxs: IEvmTransactionResponse[]
): IEvmTransactionResponse[] => {
  const { accounts, activeAccount, isBitcoinBased } = store.getState().vault;

  const { transactions: userTransactions } = accounts[activeAccount];

  const userClonedArray = clone(
    isBitcoinBased
      ? (compact(userTransactions) as ISysTransaction[])
      : (compact(Object.values(userTransactions)) as IEvmTransactionResponse[])
  );

  const mergeArrays = [
    ...providerTxs,
    ...userClonedArray,
  ] as IEvmTransactionResponse[];

  const uniqueTxsArray = treatDuplicatedTxs(mergeArrays);

  return uniqueTxsArray as IEvmTransactionResponse[];
};
