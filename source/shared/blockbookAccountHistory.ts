/** Existing Blockbook account-history semantics shared by wallet hosts.
 * Transport, cancellation, size limits, cache and publication remain host-owned.
 * Account-relative amounts require Blockbook account ownership data, not raw /tx aliases.
 */
export type BlockbookAccountFetch = (
  networkUrl: string,
  identifier: string,
  requestOptions: string,
  parseData: boolean
) => Promise<any>;

export const readHistoryCount = (value: unknown): number | null => {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^\d+$/.test(String(value))
  )
    return null;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : null;
};

export const isHistoryResponseObject = (data: any) =>
  data !== null &&
  typeof data === 'object' &&
  !Array.isArray(data) &&
  data.error === undefined;

export const isUnsupportedTxSummaryResponse = (
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
export const validateAccountHistory = (data: any, allowEmptyPage: boolean) => {
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
export const normalizeAccountHistory = (accountData: any) => {
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

/** Keep one instance for the host lifetime to retain its existing backend capability memo. */
export function createBlockbookAccountHistory(
  fetchAccount: BlockbookAccountFetch,
  onFallback?: (error: unknown) => void
) {
  const txSummaryUnsupportedBackends = new Set<string>();
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

  const fetchAccountHistory = async (
    networkUrl: string,
    xpubOrAddress: string,
    requestOptions: string,
    allowEmptyPage = false
  ) => {
    let accountData: any = null;

    try {
      accountData = await fetchAccount(
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

      onFallback?.(error);
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
      await fetchAccount(networkUrl, xpubOrAddress, fallbackOptions, true),
      allowEmptyPage
    );
  };

  return { getHistoryRequestOptions, fetchAccountHistory };
}
