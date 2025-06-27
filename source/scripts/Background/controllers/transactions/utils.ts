import clone from 'lodash/clone';
import compact from 'lodash/compact';
import flatMap from 'lodash/flatMap';
import isEmpty from 'lodash/isEmpty';
import range from 'lodash/range';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { setMultipleTransactionToState } from 'state/vault';
import { TransactionsType } from 'state/vault/types';

import { ISysTransaction, IEvmTransactionResponse } from './types';

// Add this type at the top of the file (or near the imports)
type UnifiedTransaction = IEvmTransactionResponse | ISysTransaction;

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
  numBlocks: number
): Promise<IEvmTransactionResponse[] | any> => {
  const { isBitcoinBased } = store.getState().vault;

  // This function is EVM-specific, shouldn't be called for UTXO networks
  if (isBitcoinBased) {
    console.warn(
      'findUserTxsInProviderByBlocksRange called on UTXO network - returning empty array'
    );
    return [];
  }

  // Get the latest block number first
  const latestBlockNumber = await provider.getBlockNumber();

  // Calculate the range: from (latest - numBlocks) to latest
  const startBlock = Math.max(0, latestBlockNumber - numBlocks);
  const endBlock = latestBlockNumber;

  const rangeBlocksToRun = range(startBlock, endBlock + 1); // +1 to include endBlock

  // Start with a conservative batch size and let it adapt based on provider limits
  let currentBatchSize = 5; // Conservative starting point
  const allResponses = [];

  // Process blocks in chunks with dynamic batch size
  let i = 0;
  let chunkCount = 0;
  let consecutiveErrors = 0;

  while (i < rangeBlocksToRun.length) {
    const chunk = rangeBlocksToRun.slice(i, i + currentBatchSize);

    try {
      // Use sendBatch to send all block requests in a single batch
      const batchParams = chunk.map((blockNumber) => [
        `0x${blockNumber.toString(16)}`,
        true,
      ]);

      const responses = await provider.sendBatch(
        'eth_getBlockByNumber',
        batchParams
      );
      allResponses.push(...responses);

      // Reset consecutive errors on success
      consecutiveErrors = 0;

      // Move to next chunk
      i += currentBatchSize;
      chunkCount++;

      // Add progressive delay between chunks to avoid rate limiting
      if (i < rangeBlocksToRun.length) {
        // Base delay: 100ms, increases by 50ms every 10 chunks
        const baseDelay = 100;
        const progressiveDelay = Math.floor(chunkCount / 10) * 50;
        const delay = Math.min(baseDelay + progressiveDelay, 500); // Cap at 500ms

        if (chunkCount % 10 === 0) {
          console.log(
            `Processed ${chunkCount} chunks, current delay: ${delay}ms`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error: any) {
      console.error('Error fetching blocks:', error);
      consecutiveErrors++;

      // Check for rate limiting errors
      const isRateLimitError =
        (error.message &&
          (error.message.includes('rate limit') ||
            error.message.includes('Too many requests') ||
            error.message.includes('429'))) ||
        error.status === 429 ||
        error.code === 429;

      if (isRateLimitError) {
        // Exponential backoff for rate limiting
        const backoffDelay = Math.min(
          1000 * Math.pow(2, consecutiveErrors),
          10000
        ); // Max 10 seconds
        console.warn(`Rate limit hit, waiting ${backoffDelay}ms before retry`);
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        continue; // Retry the same chunk
      }

      // Check for various batch size limit errors
      const isBatchSizeError =
        (error.message &&
          (error.message.includes('Batch size too large') ||
            error.message.includes('Batch of more than') ||
            (error.message.includes('batch') &&
              error.message.includes('not allowed')))) ||
        (error.body &&
          typeof error.body === 'string' &&
          error.body.includes('Batch of more than'));

      if (isBatchSizeError) {
        // Extract batch limit from error message if possible
        const batchLimitMatch =
          error.message?.match(/Batch of more than (\d+)/) ||
          error.body?.match(/Batch of more than (\d+)/);

        if (batchLimitMatch && batchLimitMatch[1]) {
          const maxAllowed = parseInt(batchLimitMatch[1]);
          currentBatchSize = Math.min(currentBatchSize, maxAllowed);
          console.warn(
            `Batch size limit detected: max ${maxAllowed} allowed. Reducing batch size to ${currentBatchSize}`
          );
        } else if (currentBatchSize > 1) {
          // If we can't parse the limit, reduce by half
          currentBatchSize = Math.max(1, Math.floor(currentBatchSize / 2));
          console.warn(
            `Batch size error detected. Reducing batch size to ${currentBatchSize}`
          );
        }

        // Retry the same chunk with smaller batch size
        continue;
      } else if (currentBatchSize > 1) {
        // For other errors, try reducing batch size anyway
        currentBatchSize = Math.max(1, Math.floor(currentBatchSize / 2));
        console.warn(
          `Unknown error, reducing batch size to ${currentBatchSize} and retrying`
        );
        continue;
      } else {
        // If we're already at batch size 1, skip this block
        console.error(
          `Failed to fetch block ${chunk[0]} even with batch size 1:`,
          error
        );
        i += 1; // Move to next block
      }
    }
  }

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

export const treatDuplicatedTxs = (transactions: UnifiedTransaction[]) => {
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

export const validateAndManageUserTransactions = (
  providerTxs: IEvmTransactionResponse[]
): UnifiedTransaction[] => {
  // If providerTxs is empty, return an empty array
  if (isEmpty(providerTxs)) return [];

  const {
    accounts,
    activeAccount,
    activeNetwork,
    accountTransactions: vaultAccountTransactions,
  } = store.getState().vault;

  // Safety check: if activeNetwork is undefined, return empty array
  if (!activeNetwork) {
    console.warn(
      'validateAndManageUserTransactions: activeNetwork is undefined'
    );
    return [];
  }

  const account = accounts[activeAccount.type][activeAccount.id];
  const userAddress = account.address.toLowerCase();

  const filteredTxs = providerTxs
    .filter(
      (tx) =>
        (tx.from?.toLowerCase() === userAddress ||
          tx.to?.toLowerCase() === userAddress) &&
        // For pending transactions (confirmations === 0), don't require blockHash/blockNumber
        // For confirmed transactions, require both blockHash and blockNumber
        (tx.confirmations === 0 || (tx.blockHash && tx.blockNumber))
    )
    .map((tx) => {
      // Add direction field to transaction
      const fromAddress = tx.from?.toLowerCase();
      const toAddress = tx.to?.toLowerCase();

      // Determine transaction direction
      let direction = 'unknown';
      if (fromAddress === userAddress && toAddress !== userAddress) {
        direction = 'sent';
      } else if (fromAddress !== userAddress && toAddress === userAddress) {
        direction = 'received';
      } else if (fromAddress === userAddress && toAddress === userAddress) {
        direction = 'self';
      }

      return {
        ...tx,
        direction,
      };
    });

  // Always use Ethereum for EVM
  const transactionType = TransactionsType.Ethereum;

  const accountTransactions =
    vaultAccountTransactions[activeAccount.type]?.[activeAccount.id]?.[
      transactionType
    ]?.[activeNetwork.chainId];

  const updatedTxs = accountTransactions
    ? (compact(clone(accountTransactions)) as UnifiedTransaction[])
    : [];

  // When merging transactions, use the union type
  const mergedTxs: UnifiedTransaction[] = [...updatedTxs, ...filteredTxs];

  // After deduplication, sort by confirmations ascending (pending first), then by timestamp descending
  const deduplicatedTxs = treatDuplicatedTxs(mergedTxs);
  const sortedTxs = deduplicatedTxs.sort((a, b) => {
    if (a.confirmations !== b.confirmations) {
      return a.confirmations - b.confirmations; // pending (0) first
    }
    // If confirmations are equal, sort by timestamp descending
    return (b.timestamp || 0) - (a.timestamp || 0);
  });

  if (filteredTxs.length > 0) {
    store.dispatch(
      setMultipleTransactionToState({
        chainId: activeNetwork.chainId,
        networkType: TransactionsType.Ethereum,
        transactions: sortedTxs,
        accountId: activeAccount.id,
        accountType: activeAccount.type,
      })
    );
  }

  return sortedTxs;
};
