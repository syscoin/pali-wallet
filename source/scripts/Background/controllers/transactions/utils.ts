import { ethers } from 'ethers';
import { range, flatMap, isEqual, isEmpty, compact, clone } from 'lodash';

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

  const txsWithTimestampTreated = await Promise.all(
    flatMap(userProviderTxs).map(
      async (tx) => await getFormattedEvmTransactionResponse(provider, tx)
    )
  );

  return flatMap(txsWithTimestampTreated);
};

export const validateAndManageUserTransactions = (
  providerTxs: IEvmTransactionResponse[] | ISysTransaction[]
): IEvmTransactionResponse[] | ISysTransaction[] => {
  const { accounts, activeAccount, isBitcoinBased } = store.getState().vault;

  const { transactions: userTransactions } = accounts[activeAccount];

  const userTxsLimitLength = userTransactions.length >= 30;

  const compareArrays = (arrayToCompare: IEvmTransactionResponse[]) => {
    const clonedUserTxsArray = [
      ...userTransactions,
    ] as IEvmTransactionResponse[];

    const isArrayEquals = isEqual(clonedUserTxsArray, arrayToCompare);

    return !isArrayEquals ? arrayToCompare : [];
  };

  const manageAndDealTxs = (
    tx: IEvmTransactionResponse | ISysTransaction
  ): IEvmTransactionResponse[] | ISysTransaction[] => {
    const txIdValidated = isBitcoinBased ? 'txid' : 'hash';

    const txAlreadyExists = Boolean(
      !isEmpty(compact(userTransactions)) &&
        userTransactions.find(
          (txs: IEvmTransactionResponse) =>
            txs[txIdValidated]?.toLowerCase() ===
            tx[txIdValidated]?.toLowerCase()
        )
    );

    switch (txAlreadyExists) {
      //Only try to update Confirmations property if is different
      case true:
        const manageArray = [...userTransactions] as IEvmTransactionResponse[];

        const searchForTxIndex = manageArray.findIndex(
          (userTxs) =>
            userTxs[txIdValidated].toLowerCase() ===
              tx[txIdValidated].toLowerCase() &&
            userTxs.confirmations !== tx.confirmations
        );

        if (searchForTxIndex === -1) break;

        manageArray.map((item) => {
          if (
            item[txIdValidated] !== manageArray[searchForTxIndex][txIdValidated]
          )
            return item;
          return { ...item, confirmations: tx.confirmations };
        });

        return compareArrays(manageArray);

      case false:
        if (!userTxsLimitLength) {
          const arrayToAdd = clone(
            isBitcoinBased ? compact(userTransactions) : userTransactions
          );

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

  //@ts-ignore FIX TYPE HERE LATER TO ACCEPT SYS AND EVM TXS
  const treatedTxs = flatMap(providerTxs.map((tx) => manageAndDealTxs(tx)));
  //@ts-ignore FIX TYPE HERE LATER TO ACCEPT SYS AND EVM TXS
  return treatedTxs;
};
