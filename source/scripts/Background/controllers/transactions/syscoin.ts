import clone from 'lodash/clone';
import * as sys from 'syscoinjs-lib';

import {
  createBlockbookAccountHistory,
  readHistoryCount,
} from '../../../../shared/blockbookAccountHistory';
import { mergeFreshBlockbookHistory } from '../../../../shared/blockbookHistoryMerge';
import {
  UTXO_DETAIL_OBSERVATION,
  UTXO_SUMMARY_OBSERVATION,
} from '../../../../shared/utxoDetailFreshness';
import { assertUtxoDetailPayloadBudget } from '../../../../shared/utxoTransactionDetailCache';
import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import store from 'state/store';
import { TransactionsType } from 'state/vault/types';

import { ISysTransaction, ISysTransactionsController } from './types';
import { treatAndSortTransactions } from './utils';

// Snapshot of the Blockbook account summary captured at the last history fetch.
// Used by rapid polling to detect whether anything changed via a cheap
// `details=basic` probe before paying for transaction history.
interface IAccountActivitySnapshot {
  balance: string;
  hasMore?: boolean;
  txs: number;
  unconfirmedBalance: string;
  unconfirmedTxs: number;
}

// Keep pagination evidence alongside the exact read, outside persisted wallet rows.
const pageContinuation = new WeakMap<ISysTransaction[], boolean>();
export const getBlockbookHistoryHasMore = (rows: unknown) =>
  Array.isArray(rows) ? pageContinuation.get(rows) : undefined;
const withContinuation = (rows: ISysTransaction[], hasMore?: boolean) => {
  if (hasMore !== undefined) pageContinuation.set(rows, hasMore);
  return rows;
};
const historyRows = (data: any, page: number) => {
  const rows = Array.isArray(data?.transactions) ? data.transactions : [];
  const total = readHistoryCount(data?.totalPages);
  const reportedPage = readHistoryCount(data?.page);
  // Blockbook clamps requests beyond the end to its final page.
  const matchesPage =
    data?.page === undefined ||
    reportedPage === page ||
    (reportedPage === total && total !== null && page > total);
  return withContinuation(
    rows,
    total !== null && matchesPage ? page < total : undefined
  );
};

const MAX_SNAPSHOT_ENTRIES = 20;
const accountActivitySnapshots = new Map<string, IAccountActivitySnapshot>();
let observationEpoch: string | undefined;
let observationSequence = 0;
const nextObservation = () => {
  observationEpoch ??= Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('');
  return `${observationEpoch}:${++observationSequence}`;
};
// The account fetcher can deliver one physical response to several callers.
const historyObservations = new WeakMap<object, string>();
const { getHistoryRequestOptions, fetchAccountHistory } =
  createBlockbookAccountHistory(
    fetchBackendAccountCached,
    (error) => {
      console.warn(
        '[SysTransactionController] txsummary history fetch failed, falling back:',
        error
      );
    },
    (source, rows) => {
      let observation = historyObservations.get(source);
      if (!observation) {
        observation = nextObservation();
        historyObservations.set(source, observation);
      }
      return rows.map((row) => ({
        ...row,
        [UTXO_SUMMARY_OBSERVATION]: observation,
      }));
    }
  );

const assertHistoryReadCurrent = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw Object.assign(new Error('History read cancelled'), {
      name: 'AbortError',
    });
};

const getSnapshotKey = (networkUrl: string, xpubOrAddress: string) =>
  `${networkUrl}::${xpubOrAddress}`;

const buildActivitySnapshot = (accountData: any): IAccountActivitySnapshot => ({
  balance: String(accountData?.balance ?? ''),
  // XPUB `details=basic` may expose the per-address aggregate count while
  // history details expose deduplicated wallet transactions. Compare the stable
  // aggregate when Blockbook provides it.
  txs: Number(accountData?.addrTxCount ?? accountData?.txs ?? 0),
  unconfirmedBalance: String(accountData?.unconfirmedBalance ?? ''),
  unconfirmedTxs: Number(accountData?.unconfirmedTxs ?? 0),
});

const snapshotsEqual = (
  a: IAccountActivitySnapshot,
  b: IAccountActivitySnapshot
) =>
  a.txs === b.txs &&
  a.unconfirmedTxs === b.unconfirmedTxs &&
  a.balance === b.balance &&
  a.unconfirmedBalance === b.unconfirmedBalance;

const storeActivitySnapshot = (
  key: string,
  snapshot: IAccountActivitySnapshot
) => {
  // Simple insertion-order eviction to keep the map bounded
  if (
    !accountActivitySnapshots.has(key) &&
    accountActivitySnapshots.size >= MAX_SNAPSHOT_ENTRIES
  ) {
    const oldestKey = accountActivitySnapshots.keys().next().value;
    if (oldestKey !== undefined) {
      accountActivitySnapshots.delete(oldestKey);
    }
  }
  accountActivitySnapshots.set(key, snapshot);
};

const SysTransactionController = (): ISysTransactionsController => {
  const fetchTransactionDetailsFromBlockbook: ISysTransactionsController['fetchTransactionDetailsFromBlockbook'] =
    async (txid, networkUrl, read) => {
      if (!txid || !networkUrl) return null;

      const observation = nextObservation();
      const transaction = await sys.utils.fetchBackendRawTx(
        networkUrl,
        txid,
        read
      );

      if (
        !transaction ||
        typeof transaction !== 'object' ||
        Array.isArray(transaction)
      )
        return null;
      assertUtxoDetailPayloadBudget(transaction);
      return { ...transaction, [UTXO_DETAIL_OBSERVATION]: observation };
    };

  const getInitialUserTransactionsByXpub = async (
    xpubOrAddress: string,
    networkUrl: string,
    signal?: AbortSignal
  ): Promise<ISysTransaction[]> => {
    const accountData = await fetchAccountHistory(
      networkUrl,
      xpubOrAddress,
      getHistoryRequestOptions(networkUrl, xpubOrAddress),
      false,
      signal && {
        assertCurrent: () => assertHistoryReadCurrent(signal),
        fetch: (url, identifier, options, parseData) =>
          fetchBackendAccountCached(
            url,
            identifier,
            options,
            parseData,
            signal
          ),
      }
    );
    assertHistoryReadCurrent(signal);

    const rows = historyRows(accountData, 1);
    storeActivitySnapshot(getSnapshotKey(networkUrl, xpubOrAddress), {
      ...buildActivitySnapshot(accountData),
      hasMore: getBlockbookHistoryHasMore(rows),
    });
    return rows;
  };

  const pollingSysTransactions = async (
    xpubOrAddress: string,
    networkUrl: string,
    isRapidPolling = false,
    signal?: AbortSignal
  ): Promise<ISysTransaction[]> => {
    const { activeAccount, activeNetwork, accountTransactions } =
      store.getState().vault;

    // Ensure syscoinUserTransactions is always an array
    const syscoinUserTransactions = clone(
      accountTransactions[activeAccount.type]?.[activeAccount.id]?.[
        TransactionsType.Syscoin
      ]?.[activeNetwork.chainId] || []
    ) as ISysTransaction[];

    // Rapid polling (post-send confirmation checks) probes the cheap
    // `details=basic` summary first and only fetches transaction history
    // when the account actually changed since the last history fetch. The
    // basic probe shares the same request the balance controller fires in
    // the same cycle (deduplicated).
    if (isRapidPolling) {
      const snapshotKey = getSnapshotKey(networkUrl, xpubOrAddress);
      const previousSnapshot = accountActivitySnapshots.get(snapshotKey);

      if (previousSnapshot) {
        try {
          const basicData = await fetchBackendAccountCached(
            networkUrl,
            xpubOrAddress,
            'details=basic&pageSize=0',
            true,
            signal
          );
          assertHistoryReadCurrent(signal);
          const currentSnapshot = buildActivitySnapshot(basicData);

          if (snapshotsEqual(previousSnapshot, currentSnapshot)) {
            // Nothing changed on the backend - keep current local state
            return withContinuation(
              syscoinUserTransactions,
              previousSnapshot.hasMore
            );
          }
        } catch (error) {
          assertHistoryReadCurrent(signal);
          // Probe failed - fall through to the history fetch below
          console.warn(
            '[SysTransactionController] Rapid poll basic probe failed, falling back to history fetch:',
            error
          );
        }
      }
    }

    const getSysTxs = await getInitialUserTransactionsByXpub(
      xpubOrAddress,
      networkUrl,
      signal
    );

    // Ensure both values are arrays before spreading
    const validGetSysTxs = Array.isArray(getSysTxs) ? getSysTxs : [];
    const validSyscoinUserTransactions = Array.isArray(syscoinUserTransactions)
      ? syscoinUserTransactions
      : [];

    // If backend explicitly returns an empty array and we have no unconfirmed transactions,
    // trust the backend - don't merge with potentially stale local state
    if (
      validGetSysTxs.length === 0 &&
      validSyscoinUserTransactions.length > 0
    ) {
      // Check if all local transactions are confirmed (not pending)
      const hasUnconfirmedLocal = validSyscoinUserTransactions.some(
        (tx) => !tx.confirmations || tx.confirmations === 0
      );

      // If no unconfirmed transactions, trust the backend's empty response
      if (!hasUnconfirmedLocal) {
        return withContinuation([], getBlockbookHistoryHasMore(getSysTxs));
      }
    }

    const mergedArrays = mergeFreshBlockbookHistory(
      validGetSysTxs,
      validSyscoinUserTransactions
    );

    // Use the optimized function that deduplicates, sorts, and limits in one go
    return withContinuation(
      treatAndSortTransactions(mergedArrays, 30) as ISysTransaction[],
      getBlockbookHistoryHasMore(getSysTxs)
    );
  };

  const fetchTransactionsPageFromBlockbook = async (
    xpubOrAddress: string,
    networkUrl: string,
    page: number,
    pageSize: number = 30
  ): Promise<ISysTransaction[]> => {
    const requestOptions = getHistoryRequestOptions(
      networkUrl,
      xpubOrAddress,
      page,
      pageSize
    );
    const accountData = await fetchAccountHistory(
      networkUrl,
      xpubOrAddress,
      requestOptions,
      page > 1
    );
    return historyRows(accountData, page);
  };

  return {
    fetchTransactionDetailsFromBlockbook,
    getInitialUserTransactionsByXpub,
    pollingSysTransactions,
    fetchTransactionsPageFromBlockbook,
  };
};

export default SysTransactionController;
