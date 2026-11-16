import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import clone from 'lodash/clone';
import compact from 'lodash/compact';
import isEmpty from 'lodash/isEmpty';

import {
  belongsToEvmHistoryAccount,
  getEvmHistoryDirection,
  markEvmHistoryOrphaned,
  selectEvmHistoryRepresentatives,
} from '../../../../shared/evmHistory';
import store from 'state/store';
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
  return await getEvmTransactionTimestamp(
    provider,
    tx as unknown as IEvmTransactionResponse
  );
};

const HISTORY_READ_TIMEOUT_MS = 20000;
// Keep immutable bodies across the manager's one-minute display-result expiry.
// Every reuse still verifies the cached anchor against the current chain.
const HISTORY_CACHE_TTL_MS = 5 * 60000;
const HISTORY_CACHE_BLOCKS = 64;
const HISTORY_CACHE_BYTES = 8 * 1024 * 1024;

type HistoryBlock = {
  hash: string;
  number: number;
  parentHash: string;
  timestamp: number;
  transactions: IEvmTransactionResponse[];
};
type HistoryScanCache = {
  blocks: Map<number, HistoryBlock>;
  scope: string;
  updatedAt: number;
};
const historyScans = new WeakMap<CustomJsonRpcProvider, HistoryScanCache>();
const historyScope = () => {
  const { activeAccount, accounts, activeNetwork } = store.getState().vault;
  return JSON.stringify([
    activeNetwork?.chainId,
    activeNetwork?.url,
    activeAccount?.type,
    activeAccount?.id,
    accounts?.[activeAccount?.type]?.[
      activeAccount?.id
    ]?.address?.toLowerCase(),
  ]);
};
const historyNumber = (value: unknown): number => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))
    throw new Error('Invalid history block quantity');
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result))
    throw new Error('Invalid history block quantity');
  return result;
};
const historyHash = (value: unknown): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new Error('Invalid history block hash');
  return value.toLowerCase();
};
const historyHeader = (value: any) => ({
  number: historyNumber(value?.number),
  hash: historyHash(value?.hash),
  parentHash: historyHash(value?.parentHash),
});

/** Bounded display scan; only complete, canonically checked block windows are reused. */
export const findUserTxsInProviderByBlocksRange = async (
  provider: CustomJsonRpcProvider,
  numBlocks: number,
  isCurrentRead: () => boolean = () => true,
  signal?: AbortSignal
): Promise<IEvmTransactionResponse[]> => {
  if (store.getState().vault.isBitcoinBased) return [];
  if (!Number.isSafeInteger(numBlocks) || numBlocks < 0 || numBlocks > 1000)
    throw new Error('Invalid history block range');
  const scope = historyScope();
  const chainId = BigInt(store.getState().vault.activeNetwork.chainId);
  const deadline = new AbortController();
  const abort = () => deadline.abort(provider.signal.reason);
  provider.signal?.addEventListener('abort', abort, { once: true });
  const cancel = () => deadline.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(
    () => deadline.abort(new Error('History refresh timed out')),
    HISTORY_READ_TIMEOUT_MS
  );
  const check = () => {
    if (deadline.signal.aborted) throw deadline.signal.reason;
    if (
      provider.signal?.aborted ||
      !isCurrentRead() ||
      historyScope() !== scope
    )
      throw new Error('History context changed');
  };
  const request = async (calls: { method: string; params: unknown[] }[]) => {
    check();
    const results = await provider.readMany(calls, { signal: deadline.signal });
    check();
    return results.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  };
  const readMany = (params: unknown[][]): Promise<any[]> =>
    request(
      params.map((values) => ({
        method: 'eth_getBlockByNumber',
        params: values,
      }))
    );
  const verifyChain = async () => {
    const [actual] = await request([{ method: 'eth_chainId', params: [] }]);
    if (typeof actual !== 'string' || BigInt(actual) !== chainId)
      throw new Error('History network changed');
  };
  try {
    check();
    await verifyChain();
    check();
    const [rawTip] = await readMany([['latest', false]]);
    const tip = historyHeader(rawTip);
    const start = Math.max(0, tip.number - numBlocks);
    const cached = historyScans.get(provider);
    let blocks = new Map<number, HistoryBlock>();
    if (
      cached?.scope === scope &&
      cached.blocks.size > 0 &&
      Date.now() - cached.updatedAt < HISTORY_CACHE_TTL_MS
    ) {
      const oldTip = Math.max(...cached.blocks.keys());
      if (oldTip <= tip.number) {
        const observed =
          oldTip === tip.number
            ? tip
            : historyHeader(
                (await readMany([[`0x${oldTip.toString(16)}`, false]]))[0]
              );
        if (observed.hash === cached.blocks.get(oldTip)?.hash)
          blocks = new Map(cached.blocks);
      }
    }
    const missing: number[] = [];
    for (let number = start; number <= tip.number; number++) {
      if (!blocks.has(number)) missing.push(number);
    }
    for (let offset = 0; offset < missing.length; offset += 5) {
      const chunk = missing.slice(offset, offset + 5);
      const values = await readMany(
        chunk.map((number) => [`0x${number.toString(16)}`, true])
      );
      values.forEach((raw, index) => {
        const header = historyHeader(raw);
        if (
          header.number !== chunk[index] ||
          !Array.isArray(raw.transactions) ||
          raw.transactions.some(
            (tx: unknown) => !tx || typeof tx !== 'object' || Array.isArray(tx)
          )
        )
          throw new Error('Invalid history block');
        blocks.set(header.number, {
          ...header,
          timestamp: historyNumber(raw.timestamp),
          transactions: raw.transactions,
        });
      });
    }
    const window: HistoryBlock[] = [];
    for (let number = start; number <= tip.number; number++) {
      const block = blocks.get(number)!;
      if (
        !block ||
        (window.length && block.parentHash !== window[window.length - 1].hash)
      )
        throw new Error('History block chain changed');
      window.push(block);
    }
    const finalTip = historyHeader(
      (await readMany([[`0x${tip.number.toString(16)}`, false]]))[0]
    );
    if (finalTip.hash !== tip.hash || blocks.get(tip.number)?.hash !== tip.hash)
      throw new Error('History block chain changed');
    await verifyChain();
    check();
    const retained = new Map<number, HistoryBlock>();
    let retainedBytes = 0;
    for (const block of window.slice(-HISTORY_CACHE_BLOCKS).reverse()) {
      retainedBytes += JSON.stringify(block).length * 2;
      if (retainedBytes > HISTORY_CACHE_BYTES) break;
      retained.set(block.number, block);
    }
    historyScans.set(provider, {
      scope,
      updatedAt: Date.now(),
      blocks: retained,
    });
    const transactions = window.flatMap((block) =>
      block.transactions
        .filter((tx) => tx?.from || tx?.to)
        .map((tx) => ({
          ...tx,
          chainId: Number(tx.chainId),
          confirmations: tx.blockNumber
            ? Math.max(0, tip.number - historyNumber(tx.blockNumber))
            : 0,
          timestamp: block.timestamp,
          nonce:
            typeof tx.nonce === 'string' ? historyNumber(tx.nonce) : tx.nonce,
        }))
    );
    const { activeAccount, accountTransactions } = store.getState().vault;
    const existing =
      accountTransactions?.[activeAccount.type]?.[activeAccount.id]?.ethereum?.[
        Number(chainId)
      ] || [];
    const observedHashes = new Set(
      transactions.map((tx) => String(tx.hash).toLowerCase())
    );
    const orphaned = existing
      .filter((tx: any) => {
        const canonical = blocks.get(Number(tx.blockNumber));
        return (
          canonical &&
          Number(tx.blockNumber) >= start &&
          Number(tx.blockNumber) <= tip.number &&
          typeof tx.blockHash === 'string' &&
          canonical.hash !== tx.blockHash.toLowerCase() &&
          !observedHashes.has(String(tx.hash).toLowerCase())
        );
      })
      .map((tx: any) => markEvmHistoryOrphaned(tx));
    return [...transactions, ...orphaned] as IEvmTransactionResponse[];
  } catch (error) {
    historyScans.delete(provider);
    throw error;
  } finally {
    clearTimeout(timer);
    provider.signal?.removeEventListener('abort', abort);
    signal?.removeEventListener('abort', cancel);
  }
};

// Optimized function that deduplicates, sorts, and limits in one go
export const treatAndSortTransactions = (
  transactions: UnifiedTransaction[],
  limit = 30
): UnifiedTransaction[] => selectEvmHistoryRepresentatives(transactions, limit);

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

  // Safety check: validate account access path
  if (
    !accounts[activeAccount.type] ||
    !accounts[activeAccount.type]?.[activeAccount.id]
  ) {
    console.warn(
      'validateAndManageUserTransactions: account not found',
      activeAccount
    );
    return [];
  }

  const account = accounts[activeAccount.type]?.[activeAccount.id];
  if (!account) {
    console.warn(
      'validateAndManageUserTransactions: account became undefined after check'
    );
    return [];
  }
  const userAddress = account.address.toLowerCase();

  const filteredTxs = providerTxs
    .filter((tx: any) => belongsToEvmHistoryAccount(tx, userAddress))
    .map((tx: any) => ({
      ...tx,
      direction: getEvmHistoryDirection(tx, userAddress),
    }));

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

  // Deduplicate, sort, and limit to 30 transactions in one optimized pass
  return treatAndSortTransactions(mergedTxs, 30);
};
