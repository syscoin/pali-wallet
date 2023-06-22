import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import isEmpty from 'lodash/isEmpty';
import range from 'lodash/range';
import uniqWith from 'lodash/uniqWith';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';

import { Queue } from './queue';
import { ISysTransaction, IEvmTransactionResponse } from './types';

export const getEvmTransactionTimestamp = async (
  provider: CustomJsonRpcProvider,
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
  provider: CustomJsonRpcProvider,
  transaction: IEvmTransactionResponse
) => {
  const tx = await provider.getTransaction(transaction.hash);

  if (!tx) {
    return await getEvmTransactionTimestamp(provider, transaction);
  }
  return await getEvmTransactionTimestamp(provider, tx);
};

export const findUserTxsInProviderByBlocksRange = async (
  provider: CustomJsonRpcProvider,
  userAddress: string,
  startBlock: number,
  endBlock: number
): Promise<IEvmTransactionResponse[]> => {
  const rangeBlocksToRun = range(startBlock, endBlock);
  const queue = new Queue(3);

  rangeBlocksToRun.forEach((blockNumber) => {
    if (blockNumber < 0) {
      blockNumber = blockNumber * -1;
    }
    queue.execute(async () => {
      const currentBlock = await provider.send('eth_getBlockByNumber', [
        `0x${blockNumber.toString(16)}`,
        true,
      ]);
      const filterTxsByAddress = currentBlock.transactions.filter(
        (tx) =>
          tx?.from?.toLowerCase() === userAddress.toLowerCase() ||
          tx?.to?.toLowerCase() === userAddress.toLowerCase()
      );
      return flatMap(filterTxsByAddress);
    });
  });

  const results = await queue.done();
  const userProviderTxs = results
    .filter((result) => result.success)
    .map(({ result }) => result);

  return flatMap(userProviderTxs);
};

export const treatDuplicatedTxs = (
  transactions: IEvmTransactionResponse[] | ISysTransaction[]
) =>
  uniqWith(
    transactions,
    (
      a: IEvmTransactionResponse | ISysTransaction,
      b: IEvmTransactionResponse | ISysTransaction
    ) => {
      const idA = 'hash' in a ? a.hash : a.txid;
      const idB = 'hash' in b ? b.hash : b.txid;

      const TSTAMP_PROP = 'timestamp';
      const BLOCKTIME_PROP = 'blockTime';

      if (idA.toLowerCase() === idB.toLowerCase()) {
        // Keep the transaction with the higher confirmation number
        if (a.confirmations > b.confirmations) {
          // Preserve timestamp if available and valid
          if (
            b[TSTAMP_PROP] &&
            (!a[TSTAMP_PROP] || a[TSTAMP_PROP] < b[TSTAMP_PROP])
          ) {
            a[TSTAMP_PROP] = b[TSTAMP_PROP];
          }
          // Preserve blockTime if available and valid
          if (
            b[BLOCKTIME_PROP] &&
            (!a[BLOCKTIME_PROP] || a[BLOCKTIME_PROP] < b[BLOCKTIME_PROP])
          ) {
            a[BLOCKTIME_PROP] = b[BLOCKTIME_PROP];
          }
        } else {
          // Preserve timestamp if available and valid
          if (
            a[TSTAMP_PROP] &&
            (!b[TSTAMP_PROP] || b[TSTAMP_PROP] < a[TSTAMP_PROP])
          ) {
            b[TSTAMP_PROP] = a[TSTAMP_PROP];
          }
          // Preserve blockTime if available and valid
          if (
            a[BLOCKTIME_PROP] &&
            (!b[BLOCKTIME_PROP] || b[BLOCKTIME_PROP] < a[BLOCKTIME_PROP])
          ) {
            b[BLOCKTIME_PROP] = a[BLOCKTIME_PROP];
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
  //If providedTxs is empty only return an empty array to we don't need to dispatch any Tx or validated it with the userTxs state
  if (isEmpty(providerTxs)) return [];

  const { accounts, activeAccount, isBitcoinBased } = store.getState().vault;

  const { transactions: userTransactions } =
    accounts[activeAccount.type][activeAccount.id];

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
