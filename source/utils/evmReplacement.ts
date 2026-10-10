import {
  getEoaNonceFromHistoryTransaction,
  needsEoaNonceHistoryVerification,
  parseEvmInteger,
} from './evmNonce';
import { isTransactionInBlock } from './transactionUtils';

export type EvmSettlementStatus =
  | 'pending'
  | 'replacementPending'
  | 'replaced'
  | 'confirmed'
  | 'failed';

export type EvmMinedNonceIndex = Map<string, Set<string>>;
const hashKey = (value: unknown) =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
const integer = (value: unknown) =>
  typeof value === 'number' ||
  (typeof value === 'string' && /^(?:0x[0-9a-f]+|\d+)$/i.test(value))
    ? parseEvmInteger(value)
    : undefined;

export const buildEvmTransactionHashIndex = (transactions: readonly any[]) =>
  new Map<string, any>(
    transactions
      .filter((tx) => hashKey(tx?.hash))
      .map((tx) => [hashKey(tx.hash)!, tx])
  );

// These functions receive outer transactions from one account's chain bucket,
// never decoded token events or smart-account display projections.
const nonceKey = (tx: any, chainId: number): string | undefined => {
  if (
    typeof tx?.from !== 'string' ||
    !/^0x[0-9a-f]{40}$/i.test(tx.from) ||
    (tx.chainId !== undefined && integer(tx.chainId) !== chainId) ||
    integer(tx.nonce) === undefined
  )
    return undefined;
  const outer = { ...tx, smartAccountExecutionFrom: undefined };
  const nonce = getEoaNonceFromHistoryTransaction(outer, tx.from);
  return nonce === undefined
    ? undefined
    : `${chainId}:${tx.from.toLowerCase()}:${nonce}`;
};

export const isEvmNonceReplacement = (
  original: any,
  candidate: any,
  chainId: number
): boolean => {
  const hash = hashKey(original?.hash);
  const otherHash = hashKey(candidate?.hash);
  const key = nonceKey(original, chainId);
  return Boolean(
    hash &&
      otherHash &&
      hash !== otherHash &&
      key &&
      nonceKey(candidate, chainId) === key
  );
};

/** Resolve a known legacy chain before refresh removes its intermediate hops. */
export const getEvmReplacementRootHash = (
  tx: any,
  chainId: number,
  lookup: Map<string, any>
): string | undefined => {
  const key = nonceKey(tx, chainId);
  if (!key || !hashKey(tx?.hash)) return undefined;
  const seen = new Set<string>();
  let row = tx;
  for (let depth = 0; depth < 30; depth += 1) {
    const hash = hashKey(row.hash);
    if (!hash || seen.has(hash)) return undefined;
    seen.add(hash);
    if (!row.replacesHash) return hash;
    const parent = hashKey(row.replacesHash);
    row = parent && lookup.get(parent);
    if (!row || nonceKey(row, chainId) !== key) return undefined;
  }
  return undefined;
};

/** Build once per history update; missing provenance cannot prove replacement. */
export const buildEvmMinedNonceIndex = (
  transactions: readonly any[],
  chainId: number
): EvmMinedNonceIndex => {
  const index: EvmMinedNonceIndex = new Map();
  for (const tx of transactions) {
    const hash = hashKey(tx?.hash);
    const key = nonceKey(tx, chainId);
    if (
      !hash ||
      !key ||
      !isTransactionInBlock(tx) ||
      needsEoaNonceHistoryVerification(tx)
    )
      continue;
    const hashes = index.get(key) || new Set<string>();
    hashes.add(hash);
    index.set(key, hashes);
  }
  return index;
};

export const getEvmSettlementStatus = (
  tx: any,
  chainId: number,
  mined: EvmMinedNonceIndex = new Map()
): EvmSettlementStatus => {
  if (tx?.chainId !== undefined && integer(tx.chainId) !== chainId)
    return 'pending';
  // An attempted replacement may lose. This hash's own mined result wins.
  if (isTransactionInBlock(tx)) {
    const receiptStatus = integer(tx?.txreceipt_status);
    if (receiptStatus === 0 || receiptStatus === 1)
      return receiptStatus === 0 ? 'failed' : 'confirmed';
    if (typeof tx?.success === 'boolean')
      return tx.success ? 'confirmed' : 'failed';
    return tx?.isError === '1' || tx?.isError === 1 || tx?.isError === true
      ? 'failed'
      : 'confirmed';
  }
  const hash = hashKey(tx?.hash);
  const key = nonceKey(tx, chainId);
  const winners = key && mined.get(key);
  // Conflicting indexed blocks are ambiguous; do not choose a winner.
  if (hash && winners && winners.size === 1 && !winners.has(hash))
    return 'replaced';
  return tx?.isReplaced === true || tx?.status === 'replaced'
    ? 'replacementPending'
    : 'pending';
};

/** Recover only recorded wallet intent, including linked legacy replacements. */
export const hasEvmCancellationIntent = (
  tx: any,
  transactions: readonly any[],
  chainId: number,
  lookup = buildEvmTransactionHashIndex(transactions)
): boolean => {
  if (tx?.chainId !== undefined && integer(tx.chainId) !== chainId)
    return false;
  if (tx?.isCancel === true) return true;
  const key = nonceKey(tx, chainId);
  if (!key) return false;
  const seen = new Set<string>();
  let parent = hashKey(tx?.replacesHash);
  for (let depth = 0; parent && depth < 30; depth += 1) {
    if (seen.has(parent)) break;
    seen.add(parent);
    const row = lookup.get(parent);
    if (!row || nonceKey(row, chainId) !== key) break;
    if (row.isCancel === true) return true;
    parent = hashKey(row.replacesHash);
  }
  return false;
};

export const evmSettlementLabel = (status: EvmSettlementStatus) =>
  status === 'replaced' || status === 'replacementPending'
    ? `transactions.${status}`
    : `send.${status}`;

export const evmSettlementClass = (status: EvmSettlementStatus) =>
  status === 'confirmed'
    ? 'text-brand-green'
    : status === 'failed' || status === 'replaced'
    ? 'text-warning-error'
    : 'text-brand-orange';
