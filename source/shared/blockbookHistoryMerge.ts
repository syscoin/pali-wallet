/**
 * A validated fresh account-history row supersedes its retained txid, even
 * when a reorg reduces confirmations or returns it to the pending pool.
 * Rows absent from a partial response remain retained. Sorting, limits and
 * duplicate rows within either source keep their existing caller semantics.
 */
export function mergeFreshBlockbookHistory<T extends { txid: string }>(
  fresh: readonly T[],
  retained: readonly T[]
): T[] {
  const freshIds = new Set(fresh.map((row) => row.txid.toLowerCase()));
  return [
    ...fresh,
    ...retained.filter(
      (row) =>
        typeof row.txid !== 'string' || !freshIds.has(row.txid.toLowerCase())
    ),
  ];
}
