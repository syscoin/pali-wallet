type BlockPlacement = Readonly<{
  blockHeight?: unknown;
  blockNumber?: unknown;
  height?: unknown;
}>;

function positiveBlock(value: unknown): number | null {
  if (typeof value === 'string') {
    if (value.length > 32 || !/^(?:\d+|0x[0-9a-f]+)$/i.test(value)) return null;
  } else if (typeof value !== 'number' && typeof value !== 'bigint') {
    return null;
  }
  const height = Number(value);
  return Number.isSafeInteger(height) && height > 0 ? height : null;
}

/** Prefer observed block placement to an explorer's confirmation counter. */
export const getTransactionBlockInfo = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') return null;
  const tx = value as BlockPlacement;
  return (
    positiveBlock(tx.blockNumber) ??
    positiveBlock(tx.blockHeight) ??
    positiveBlock(tx.height)
  );
};

export const isTransactionInBlock = (tx: unknown): boolean =>
  getTransactionBlockInfo(tx) !== null;
