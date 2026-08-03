export const EVM_TRANSACTION_HISTORY_SOURCE = {
  ExplorerPending: 'explorer-pendingtxlist',
  ExplorerTokenTransfer: 'explorer-tokentx',
  ExplorerTransaction: 'explorer-txlist',
} as const;

export type EvmTransactionHistorySource =
  (typeof EVM_TRANSACTION_HISTORY_SOURCE)[keyof typeof EVM_TRANSACTION_HISTORY_SOURCE];

interface IEvmNonceHistoryTransaction {
  from?: unknown;
  historySource?: EvmTransactionHistorySource | string;
  nonce?: unknown;
  r?: unknown;
  s?: unknown;
  smartAccountExecutionFrom?: unknown;
  type?: unknown;
  v?: unknown;
}

export const parseEvmInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed =
    typeof value === 'string' && value.toLowerCase().startsWith('0x')
      ? parseInt(value, 16)
      : Number(value);

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const isZeroEvmValue = (value: unknown): boolean => {
  if (typeof value === 'number') {
    return value === 0;
  }
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.toLowerCase().replace(/^0x/, '').replace(/^0+/, '');
  return normalized.length === 0;
};

const hasZeroSignature = (tx: IEvmNonceHistoryTransaction): boolean =>
  tx.r !== undefined &&
  tx.s !== undefined &&
  tx.v !== undefined &&
  isZeroEvmValue(tx.r) &&
  isZeroEvmValue(tx.s) &&
  isZeroEvmValue(tx.v);

/**
 * Returns the nonce only when the history row represents an EOA transaction
 * sent by the requested address. Explorer token-event placeholders, ERC-4337
 * display rows, and unsigned L1-to-L2 priority operations do not consume the
 * EOA's sequential nonce.
 */
export const getEoaNonceFromHistoryTransaction = (
  tx: IEvmNonceHistoryTransaction,
  address: string
): number | undefined => {
  if (
    typeof tx.from !== 'string' ||
    tx.from.toLowerCase() !== address.toLowerCase() ||
    tx.historySource === EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer ||
    Boolean(tx.smartAccountExecutionFrom)
  ) {
    return undefined;
  }

  const transactionType = parseEvmInteger(tx.type);
  if (transactionType === 0x7f || hasZeroSignature(tx)) {
    return undefined;
  }

  return parseEvmInteger(tx.nonce);
};

/**
 * Explorer APIs may omit type/signature metadata, and old persisted rows also
 * predate it. Such rows need a transaction-by-hash check before they can
 * advance an EOA nonce beyond the provider's canonical latest value.
 */
export const needsEoaNonceHistoryVerification = (
  tx: IEvmNonceHistoryTransaction
): boolean =>
  parseEvmInteger(tx.type) === undefined &&
  (tx.r === undefined || tx.s === undefined || tx.v === undefined);
