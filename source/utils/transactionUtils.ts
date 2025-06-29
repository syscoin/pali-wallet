/**
 * Helper function to check if a transaction is in a block (confirmed)
 * Works for both EVM (blockNumber) and UTXO (blockHeight/height) transactions
 *
 * This is more reliable than checking confirmations field which can be buggy
 * (some APIs return confirmations: 0 even for confirmed transactions)
 */
export const isTransactionInBlock = (tx: any): boolean =>
  (tx?.blockNumber !== null && tx?.blockNumber !== undefined) ||
  (tx?.blockHeight !== null && tx?.blockHeight !== undefined) ||
  (tx?.height !== null && tx?.height !== undefined);

/**
 * Get the block identifier from a transaction
 * Returns the block number/height or null if not in a block
 */
export const getTransactionBlockInfo = (tx: any): number | null => {
  if (tx?.blockNumber !== null && tx?.blockNumber !== undefined) {
    return tx.blockNumber;
  }
  if (tx?.blockHeight !== null && tx?.blockHeight !== undefined) {
    return tx.blockHeight;
  }
  if (tx?.height !== null && tx?.height !== undefined) {
    return tx.height;
  }
  return null;
};
