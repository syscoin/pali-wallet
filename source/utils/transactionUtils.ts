/**
 * Helper function to check if a transaction is in a block (confirmed)
 * Works for both EVM (blockNumber) and UTXO (blockHeight/height) transactions
 *
 * This is more reliable than checking confirmations field which can be buggy
 * (some APIs return confirmations: 0 even for confirmed transactions)
 */
export const isTransactionInBlock = (tx: any): boolean => {
  const blockNumber = tx?.blockNumber;
  const blockHeight = tx?.blockHeight;
  const height = tx?.height;

  // Check if any block field exists and is a valid positive number
  return (
    (blockNumber !== null && blockNumber !== undefined && blockNumber > 0) ||
    (blockHeight !== null && blockHeight !== undefined && blockHeight > 0) ||
    (height !== null && height !== undefined && height > 0)
  );
};

/**
 * Get the block identifier from a transaction
 * Returns the block number/height or null if not in a block
 */
export const getTransactionBlockInfo = (tx: any): number | null => {
  const blockNumber = tx?.blockNumber;
  const blockHeight = tx?.blockHeight;
  const height = tx?.height;

  // Return the block number only if it's a valid positive number
  if (blockNumber !== null && blockNumber !== undefined && blockNumber > 0) {
    return blockNumber;
  }
  if (blockHeight !== null && blockHeight !== undefined && blockHeight > 0) {
    return blockHeight;
  }
  if (height !== null && height !== undefined && height > 0) {
    return height;
  }
  return null;
};
