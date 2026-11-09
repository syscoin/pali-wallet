type Outpoint = { txid: string; vout: number };
// Preserve the pinned SDK's capacity while counting each protected output once.
const MAX_EXCLUDED_OUTPOINTS = 1000;
const invalid = () =>
  Object.assign(new Error('Invalid protected UTXO selection.'), {
    error: true,
    code: 'INVALID_EXCLUDED_UTXOS',
  });

/** Validate both protection sources before passing their canonical union to the SDK. */
export function unionUtxoExclusions(left: unknown, right: unknown): Outpoint[] {
  const unique = new Map<string, Outpoint>();
  for (const group of [left, right]) {
    if (!Array.isArray(group)) throw invalid();
    for (const entry of group) {
      if (
        !entry ||
        typeof entry.txid !== 'string' ||
        !/^[0-9a-fA-F]{64}$/.test(entry.txid) ||
        !Number.isSafeInteger(entry.vout) ||
        entry.vout < 0 ||
        entry.vout > 0xffffffff
      )
        throw invalid();
      const txid = entry.txid.toLowerCase();
      const vout = entry.vout === 0 ? 0 : entry.vout;
      unique.set(`${txid}:${vout}`, { txid, vout });
      if (unique.size > MAX_EXCLUDED_OUTPOINTS) throw invalid();
    }
  }
  return [...unique.values()];
}
