import clone from 'lodash/clone';
import * as sys from 'syscoinjs-lib';

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
  txs: number;
  unconfirmedBalance: string;
  unconfirmedTxs: number;
}

const MAX_SNAPSHOT_ENTRIES = 20;
const accountActivitySnapshots = new Map<string, IAccountActivitySnapshot>();
const txSummaryUnsupportedBackends = new Set<string>();

const getSnapshotKey = (networkUrl: string, xpubOrAddress: string) =>
  `${networkUrl}::${xpubOrAddress}`;

const getHistoryRequestOptions = (
  networkUrl: string,
  _xpubOrAddress: string,
  page?: number,
  pageSize = 30
) => {
  const details = txSummaryUnsupportedBackends.has(networkUrl)
    ? 'txslight'
    : 'txsummary';
  const pageOption = page !== undefined ? `&page=${page}` : '';

  return `details=${details}${pageOption}&pageSize=${pageSize}`;
};

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

const readHistoryCount = (value: unknown): number | null => {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^\d+$/.test(String(value))
  )
    return null;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : null;
};

const isHistoryResponseObject = (data: any) =>
  data !== null &&
  typeof data === 'object' &&
  !Array.isArray(data) &&
  data.error === undefined;

const isUnsupportedTxSummaryResponse = (
  accountData: any,
  requestOptions: string
) =>
  requestOptions.includes('details=txsummary') &&
  isHistoryResponseObject(accountData) &&
  ['txs', 'unconfirmedTxs'].every(
    (key) =>
      accountData[key] === undefined ||
      readHistoryCount(accountData[key]) !== null
  ) &&
  accountData.transactions === undefined &&
  ((readHistoryCount(accountData.txs) ?? 0) > 0 ||
    (readHistoryCount(accountData.unconfirmedTxs) ?? 0) > 0);

// Blockbook omits empty transaction arrays. Only explicit zero counts can
// distinguish that normal response from a malformed or basic-only payload.
const validateAccountHistory = (data: any, allowEmptyPage: boolean) => {
  if (
    !isHistoryResponseObject(data) ||
    ['txs', 'unconfirmedTxs'].some(
      (key) => data[key] !== undefined && readHistoryCount(data[key]) === null
    )
  )
    throw new Error('Invalid Blockbook history response');

  const zeroCounts =
    readHistoryCount(data.txs) === 0 &&
    readHistoryCount(data.unconfirmedTxs) === 0;
  const transactions = data.transactions;
  if (Array.isArray(transactions)) {
    if (
      transactions.some(
        (tx: any) => !tx || typeof tx.txid !== 'string' || tx.txid.length === 0
      ) ||
      (!transactions.length && !allowEmptyPage && !zeroCounts)
    )
      throw new Error('Incomplete Blockbook history response');
    return normalizeAccountHistory(data);
  }
  if (
    transactions === undefined &&
    (zeroCounts ||
      (allowEmptyPage &&
        readHistoryCount(data.txs) !== null &&
        readHistoryCount(data.unconfirmedTxs) !== null)) &&
    (!Array.isArray(data.txids) || data.txids.length === 0)
  )
    return { ...data, transactions: [] };
  throw new Error('Incomplete Blockbook history response');
};

// Only account-history responses carry queried-account ownership flags. A raw
// /tx read or txslight's transaction-wide value/valueIn aliases cannot supply
// these totals. Older responses without explicit ownership stay unresolved.
const normalizeAccountHistory = (accountData: any) => {
  if (!Array.isArray(accountData?.transactions)) return accountData;
  return {
    ...accountData,
    transactions: accountData.transactions.map((tx: any) => {
      if (
        tx?.addressValueIn !== undefined ||
        tx?.addressValueOut !== undefined ||
        !Array.isArray(tx?.vin) ||
        !tx.vin.length ||
        !Array.isArray(tx?.vout) ||
        !tx.vout.length ||
        [...tx.vin, ...tx.vout].some(
          (entry) =>
            entry?.isOwn !== undefined && typeof entry.isOwn !== 'boolean'
        ) ||
        ![...tx.vin, ...tx.vout].some((entry) => entry?.isOwn === true)
      )
        return tx;
      const atomic = (value: unknown) => {
        if (
          (typeof value !== 'string' && typeof value !== 'number') ||
          (typeof value === 'number' && !Number.isSafeInteger(value)) ||
          !/^\d+$/.test(String(value))
        )
          throw new Error('Invalid account-history amount');
        return BigInt(String(value));
      };
      try {
        const sum = (entries: any[], ownedOnly = false) =>
          entries.reduce(
            (total, entry) =>
              total +
              (ownedOnly && entry?.isOwn !== true
                ? BigInt(0)
                : atomic(entry?.value)),
            BigInt(0)
          );
        if (sum(tx.vin) !== sum(tx.vout) + atomic(tx.fees)) return tx;
        return {
          ...tx,
          addressValueIn: sum(tx.vin, true).toString(),
          addressValueOut: sum(tx.vout, true).toString(),
        };
      } catch {
        return tx;
      }
    }),
  };
};

const fetchAccountHistory = async (
  networkUrl: string,
  xpubOrAddress: string,
  requestOptions: string,
  allowEmptyPage = false
) => {
  let accountData: any = null;

  try {
    accountData = await fetchBackendAccountCached(
      networkUrl,
      xpubOrAddress,
      requestOptions,
      true
    );
    if (!isUnsupportedTxSummaryResponse(accountData, requestOptions)) {
      return validateAccountHistory(accountData, allowEmptyPage);
    }
  } catch (error) {
    if (!requestOptions.includes('details=txsummary')) {
      throw error;
    }

    console.warn(
      '[SysTransactionController] txsummary history fetch failed, falling back:',
      error
    );
  }

  // Only a successful basic-only response proves missing txsummary support.
  // Transient, inconsistent and malformed responses do not change capability.
  if (isUnsupportedTxSummaryResponse(accountData, requestOptions))
    txSummaryUnsupportedBackends.add(networkUrl);
  const fallbackOptions = requestOptions.replace(
    'details=txsummary',
    'details=txslight'
  );
  return validateAccountHistory(
    await fetchBackendAccountCached(
      networkUrl,
      xpubOrAddress,
      fallbackOptions,
      true
    ),
    allowEmptyPage
  );
};

const SysTransactionController = (): ISysTransactionsController => {
  const fetchTransactionDetailsFromBlockbook = async (
    txid: string,
    networkUrl: string
  ): Promise<ISysTransaction | null> => {
    if (!txid || !networkUrl) return null;

    const transaction = await sys.utils.fetchBackendRawTx(networkUrl, txid);

    return transaction || null;
  };

  const getInitialUserTransactionsByXpub = async (
    xpubOrAddress: string,
    networkUrl: string
  ): Promise<ISysTransaction[]> => {
    const accountData = await fetchAccountHistory(
      networkUrl,
      xpubOrAddress,
      getHistoryRequestOptions(networkUrl, xpubOrAddress)
    );

    // Record the account summary so rapid polling can detect changes cheaply
    storeActivitySnapshot(
      getSnapshotKey(networkUrl, xpubOrAddress),
      buildActivitySnapshot(accountData)
    );

    const transactions = (accountData as any)?.transactions as
      | ISysTransaction[]
      | undefined;

    // Ensure we always return an array, even if transactions is falsy
    return Array.isArray(transactions) ? transactions : [];
  };

  const pollingSysTransactions = async (
    xpubOrAddress: string,
    networkUrl: string,
    isRapidPolling = false
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
            true
          );
          const currentSnapshot = buildActivitySnapshot(basicData);

          if (snapshotsEqual(previousSnapshot, currentSnapshot)) {
            // Nothing changed on the backend - keep current local state
            return Array.isArray(syscoinUserTransactions)
              ? syscoinUserTransactions
              : [];
          }
        } catch (error) {
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
      networkUrl
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
        return [];
      }
    }

    const mergedArrays = [...validGetSysTxs, ...validSyscoinUserTransactions];

    // Use the optimized function that deduplicates, sorts, and limits in one go
    return treatAndSortTransactions(mergedArrays, 30) as ISysTransaction[];
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
    const transactions = (accountData as any)?.transactions as
      | ISysTransaction[]
      | undefined;
    return Array.isArray(transactions) ? transactions : [];
  };

  return {
    fetchTransactionDetailsFromBlockbook,
    getInitialUserTransactionsByXpub,
    pollingSysTransactions,
    fetchTransactionsPageFromBlockbook,
  };
};

export default SysTransactionController;
