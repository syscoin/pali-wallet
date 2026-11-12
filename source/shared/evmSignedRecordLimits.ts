/** Shared storage and envelope budgets, without loading the record repository. */
export const EVM_SIGNED_RECORD_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  transactions: 4096,
  chunkBytes: 48 * 1024,
});
