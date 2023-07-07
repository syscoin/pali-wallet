import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import isEmpty from 'lodash/isEmpty';
import last from 'lodash/last';
import omit from 'lodash/omit';
import range from 'lodash/range';
import uniqWith from 'lodash/uniqWith';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { setCurrentBlockNumber } from 'state/vault';

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
): Promise<IEvmTransactionResponse[] | any> => {
  const rangeBlocksToRun = range(startBlock, endBlock);

  const batchRequest = rangeBlocksToRun.map((blockNumber) =>
    provider.sendBatch('eth_getBlockByNumber', [
      `0x${blockNumber.toString(16)}`,
      true,
    ])
  );

  const userTxs = Promise.all(batchRequest)
    .then((responses) => {
      // Handle the responses

      store.dispatch(
        setCurrentBlockNumber(
          omit(last(responses) as any, 'transactions') as any
        )
      );

      return flatMap(
        responses.map((response: any) => {
          const lastBlockNumber =
            rangeBlocksToRun[rangeBlocksToRun.length - 1] + 1;
          const currentBlockNumber = parseInt(response.number, 16);

          const filterTxsByAddress = response.transactions
            .filter(
              (tx) =>
                tx?.from?.toLowerCase() === userAddress.toLowerCase() ||
                tx?.to?.toLowerCase() === userAddress.toLowerCase()
            )
            .map((txWithConfirmations) => ({
              ...txWithConfirmations,
              chainId: Number(txWithConfirmations.chainId),
              confirmations: lastBlockNumber - currentBlockNumber,
            }));

          return flatMap(filterTxsByAddress);
        })
      );
    })
    .catch((error) => {
      // Handle any errors

      console.error(error);
    });

  return userTxs;
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
