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

export const manageAndDealWithUserTxs = (
  tx: IEvmTransactionResponse | ISysTransaction
): IEvmTransactionResponse[] | ISysTransaction[] => {
  const { accounts, activeAccount, isBitcoinBased } = store.getState().vault;

  const { transactions: userTransactions } = accounts[activeAccount];

  const txIdValidated = isBitcoinBased ? 'txid' : 'hash';

  const txAlreadyExists = Boolean(
    !isEmpty(compact(userTransactions)) &&
      userTransactions.find(
        (txs: IEvmTransactionResponse) =>
          txs[txIdValidated]?.toLowerCase() === tx[txIdValidated]?.toLowerCase()
      )
  );

  const clonedUserTransactionsArray = clone(
    isBitcoinBased
      ? (compact(userTransactions) as ISysTransaction[])
      : (Object.values(userTransactions) as IEvmTransactionResponse[])
  );

  const userTxsLimitLength = clonedUserTransactionsArray.length >= 30;

  const compareArrays = (
    arrayToCompare: IEvmTransactionResponse[] | ISysTransaction[]
  ) => {
    const isArrayEquals = isEqual(clonedUserTransactionsArray, arrayToCompare);

    return !isArrayEquals ? arrayToCompare : [];
  };

  switch (txAlreadyExists) {
    //Only try to update Confirmations property if is different
    case true:
      const manageArray = compact(
        Object.values(userTransactions)
      ) as IEvmTransactionResponse[];

      const searchForTxIndex = manageArray.findIndex(
        (userTxs) =>
          userTxs[txIdValidated].toLowerCase() ===
            tx[txIdValidated].toLowerCase() &&
          userTxs.confirmations !== tx.confirmations
      );

      if (searchForTxIndex === -1) return compareArrays(manageArray);

      const changedArray = manageArray.map((item) => {
        const isIndexToChange = Boolean(
          item[txIdValidated] === manageArray[searchForTxIndex][txIdValidated]
        );

        if (isIndexToChange)
          return Object.assign({}, item, { confirmations: tx.confirmations });

        return item;
      });

      return compareArrays(changedArray);

    case false:
      if (!userTxsLimitLength) {
        const arrayToAdd = clone(
          isBitcoinBased
            ? (compact(userTransactions) as ISysTransaction[])
            : (compact(
                Object.values(userTransactions)
              ) as IEvmTransactionResponse[])
        );

        arrayToAdd.unshift(tx as ISysTransaction & IEvmTransactionResponse);

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

export const validateAndManageUserTransactions = (
  providerTxs: IEvmTransactionResponse[] | ISysTransaction[]
): IEvmTransactionResponse[] | ISysTransaction[] => {
  const treatedTxs = flatMap(
    // @ts-ignore @ts-expect-error FIX TYPE HERE LATER TO ACCEPT SYS AND EVM TXS
    providerTxs.map((tx: any) => manageAndDealWithUserTxs(tx))
  ) as IEvmTransactionResponse[] | ISysTransaction[];

  // @ts-ignore FIX TYPE HERE LATER TO ACCEPT SYS AND EVM TXS
  return treatedTxs;
};
