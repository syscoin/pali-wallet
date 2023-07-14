import { isNil } from 'lodash';
import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import isEmpty from 'lodash/isEmpty';
import last from 'lodash/last';
import omit from 'lodash/omit';
import range from 'lodash/range';
import uniqWith from 'lodash/uniqWith';

import {
  CustomJsonRpcProvider,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { setAccountPropertyByIdAndType, setCurrentBlock } from 'state/vault';

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

  const responses = await Promise.all(batchRequest);

  store.dispatch(
    setCurrentBlock(omit(last(responses) as any, 'transactions') as any)
  );

  const lastBlockNumber = rangeBlocksToRun[rangeBlocksToRun.length - 1] + 1;

  return flatMap(
    responses.map((response: any) => {
      const currentBlock = parseInt(response.number, 16);

      const filterTxsByAddress = response.transactions
        .filter((tx) => tx?.from || tx?.to)
        .map((txWithConfirmations) => ({
          ...txWithConfirmations,
          chainId: Number(txWithConfirmations.chainId),
          confirmations: lastBlockNumber - currentBlock,
          timestamp: Number(response.timestamp),
        }));

      return filterTxsByAddress;
    })
  );
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
            (!a[TSTAMP_PROP] || a[TSTAMP_PROP] > b[TSTAMP_PROP])
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
            (!b[TSTAMP_PROP] || b[TSTAMP_PROP] > a[TSTAMP_PROP])
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
  // If providerTxs is empty, return an empty array
  if (isEmpty(providerTxs)) return [];

  const { accounts, isBitcoinBased, activeAccount, activeNetwork } =
    store.getState().vault;

  let userTx;

  for (const accountType in accounts) {
    for (const accountId in accounts[accountType]) {
      const account = accounts[accountType][accountId];
      const userAddress = account.address.toLowerCase();

      const filteredTxs = providerTxs.filter(
        (tx) =>
          (tx.from?.toLowerCase() === userAddress ||
            tx.to?.toLowerCase() === userAddress) &&
          !isNil(tx.blockHash) &&
          !isNil(tx.blockNumber)
      );

      console.log('filteredTxs', filteredTxs);

      const updatedTxs = isBitcoinBased
        ? (compact(
            clone(
              account.transactions.syscoin
                .filter((sysTx) => sysTx.chainId === activeNetwork.chainId)
                .map((sysTransaction) => sysTransaction.transaction)
            )
          ) as ISysTransaction[])
        : (compact(
            clone(
              account.transactions.ethereum
                .filter((evmTx) => evmTx.chainId === activeNetwork.chainId)
                .map((evmTransaction) => evmTransaction.transaction)
            )
          ) as IEvmTransactionResponse[]);

      console.log('updatedTxs', updatedTxs);

      const mergedTxs = [
        ...updatedTxs,
        ...(filteredTxs as IEvmTransactionResponse[] & ISysTransaction[]),
      ];

      const uniqueTxs: {
        [key: string]: IEvmTransactionResponse | ISysTransaction;
      } = {};

      mergedTxs.forEach((tx: IEvmTransactionResponse) => {
        const hash = tx.hash;
        if (
          !uniqueTxs[hash] ||
          uniqueTxs[hash].confirmations < tx.confirmations
        ) {
          uniqueTxs[hash] = tx;
        }
      });

      const uniqueTxsWithChainId = Object.values(uniqueTxs).map((tx) => ({
        chainId: activeNetwork.chainId,
        transaction: tx,
      }));

      const filteredUpdatedTxs = uniqueTxsWithChainId;

      if (filteredTxs.length > 0) {
        console.log('if filteredTxs');
        store.dispatch(
          setAccountPropertyByIdAndType({
            id: Number(accountId),
            type: accountType as KeyringAccountType,
            property: 'transactions',
            value: {
              syscoin: [...account.transactions.syscoin],
              ethereum: [...filteredUpdatedTxs],
            },
          })
        );
      }

      if (
        accountType === activeAccount.type &&
        Number(accountId) === activeAccount.id
      ) {
        userTx = updatedTxs;
      }
    }
  }

  return userTx;
};
