import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import last from 'lodash/last';
import omit from 'lodash/omit';
import range from 'lodash/range';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { setCurrentBlock, setMultipleTransactionToState } from 'state/vault';
import { TransactionsType } from 'state/vault/types';

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
  const { isBitcoinBased } = store.getState().vault;

  // This function is EVM-specific, shouldn't be called for UTXO networks
  if (isBitcoinBased) {
    console.warn(
      'findUserTxsInProviderByBlocksRange called on UTXO network - returning empty array'
    );
    return [];
  }

  const rangeBlocksToRun = range(startBlock, endBlock);
  const BATCH_SIZE = 10; // Maximum blocks per batch to avoid "Batch size too large" errors
  const allResponses = [];

  // Process blocks in chunks to avoid batch size limits
  for (let i = 0; i < rangeBlocksToRun.length; i += BATCH_SIZE) {
    const chunk = rangeBlocksToRun.slice(i, i + BATCH_SIZE);

    const batchRequest = chunk.map((blockNumber) =>
      provider.sendBatch('eth_getBlockByNumber', [
        `0x${blockNumber.toString(16)}`,
        true,
      ])
    );

    const responses = await Promise.all(batchRequest);
    allResponses.push(...responses);
  }

  store.dispatch(
    setCurrentBlock(omit(last(allResponses) as any, 'transactions') as any)
  );

  // Get the actual latest block number for accurate confirmation calculation
  const latestBlockNumber = await provider.getBlockNumber();

  return flatMap(
    allResponses.map((response: any) => {
      const filterTxsByAddress = response.transactions
        .filter((tx) => tx?.from || tx?.to)
        .map((txWithConfirmations) => {
          // Calculate confirmations based on actual latest block number
          // Confirmations = (latest block number - transaction block number) + 1
          // But if transaction is in pending state (blockNumber is null), confirmations = 0
          const txBlockNumber = txWithConfirmations.blockNumber
            ? parseInt(txWithConfirmations.blockNumber, 16)
            : null;

          const confirmations = txBlockNumber
            ? Math.max(0, latestBlockNumber - txBlockNumber)
            : 0;

          return {
            ...txWithConfirmations,
            chainId: Number(txWithConfirmations.chainId),
            confirmations,
            timestamp: Number(response.timestamp),
          };
        });

      return filterTxsByAddress;
    })
  );
};

export const treatDuplicatedTxs = (
  transactions: IEvmTransactionResponse[] | ISysTransaction[]
) => {
  // Group transactions by their ID (hash or txid)
  const txGroups = new Map<
    string,
    (IEvmTransactionResponse | ISysTransaction)[]
  >();

  for (const tx of transactions) {
    const id = ('hash' in tx ? tx.hash : tx.txid).toLowerCase();
    if (!txGroups.has(id)) {
      txGroups.set(id, []);
    }
    txGroups.get(id)!.push(tx);
  }

  // For each group, select the best transaction and merge properties
  const deduplicatedTxs = [];

  for (const [, txGroup] of txGroups) {
    if (txGroup.length === 1) {
      deduplicatedTxs.push(txGroup[0]);
      continue;
    }

    // Find the transaction with the highest confirmations
    let bestTx = txGroup[0];
    for (let i = 1; i < txGroup.length; i++) {
      const currentTx = txGroup[i];
      if (currentTx.confirmations > bestTx.confirmations) {
        bestTx = currentTx;
      }
    }

    // Create a merged transaction preserving the best properties from all duplicates
    const mergedTx = { ...bestTx };

    // Preserve the earliest valid timestamp
    const TSTAMP_PROP = 'timestamp';
    const BLOCKTIME_PROP = 'blockTime';

    for (const tx of txGroup) {
      // Preserve earliest timestamp if available and valid
      if (
        tx[TSTAMP_PROP] &&
        (!mergedTx[TSTAMP_PROP] || tx[TSTAMP_PROP] < mergedTx[TSTAMP_PROP])
      ) {
        mergedTx[TSTAMP_PROP] = tx[TSTAMP_PROP];
      }

      // Preserve earliest blockTime if available and valid
      if (
        tx[BLOCKTIME_PROP] &&
        (!mergedTx[BLOCKTIME_PROP] ||
          tx[BLOCKTIME_PROP] < mergedTx[BLOCKTIME_PROP])
      ) {
        mergedTx[BLOCKTIME_PROP] = tx[BLOCKTIME_PROP];
      }
    }

    deduplicatedTxs.push(mergedTx);
  }

  return deduplicatedTxs;
};

//todo: there's a potential issue here when we call this function and the active account has changed
export const validateAndManageUserTransactions = (
  providerTxs: IEvmTransactionResponse[]
): IEvmTransactionResponse[] => {
  // If providerTxs is empty, return an empty array
  if (isEmpty(providerTxs)) return [];

  const { accounts, isBitcoinBased, activeAccount, activeNetwork } =
    store.getState().vault;

  // Safety check: if activeNetwork is undefined, return empty array
  if (!activeNetwork) {
    console.warn(
      'validateAndManageUserTransactions: activeNetwork is undefined'
    );
    return [];
  }

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

      const transactionType = isBitcoinBased
        ? TransactionsType.Syscoin
        : TransactionsType.Ethereum;

      const accountTransactions =
        account.transactions?.[transactionType]?.[activeNetwork.chainId];

      const updatedTxs = accountTransactions
        ? (compact(clone(accountTransactions)) as IEvmTransactionResponse[] &
            ISysTransaction[])
        : [];

      const mergedTxs = [
        ...updatedTxs,
        ...(filteredTxs as IEvmTransactionResponse[] & ISysTransaction[]),
      ];

      const deduplicatedTxs = treatDuplicatedTxs(mergedTxs);

      if (filteredTxs.length > 0) {
        store.dispatch(
          setMultipleTransactionToState({
            chainId: activeNetwork.chainId,
            networkType: TransactionsType.Ethereum,
            transactions: deduplicatedTxs,
            accountId: Number(accountId),
            accountType: accountType as any,
          })
        );
      }

      if (
        accountType === activeAccount.type &&
        Number(accountId) === activeAccount.id
      ) {
        userTx = deduplicatedTxs;
      }
    }
  }

  return userTx || [];
};
