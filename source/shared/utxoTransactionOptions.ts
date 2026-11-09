export type UtxoTransactionOptions = Readonly<{
  rbf: boolean;
  zdag?: boolean;
  zdagUnavailable?: true;
}>;

/** The installed SDK and extension default to replace-by-fee. */
export function snapshotUtxoRbf(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean')
    throw new Error('Invalid UTXO transaction options');
  return value;
}

/** BIP125 signalling is a property of the reviewed bytes, not a form label. */
export function inspectUtxoRbf(
  inputs: readonly Readonly<{ sequence?: number }>[]
): boolean {
  if (
    !inputs.length ||
    inputs.some(
      ({ sequence }) =>
        !Number.isSafeInteger(sequence) ||
        sequence! < 0 ||
        sequence! > 0xffffffff
    )
  )
    throw new Error('Invalid UTXO input sequence');
  return inputs.some(({ sequence }) => sequence! < 0xfffffffe);
}

export function reviewUtxoTransactionOptions(
  rbf: boolean,
  asset: boolean,
  requestedRbf?: boolean
): UtxoTransactionOptions {
  if (
    requestedRbf !== undefined &&
    rbf !== requestedRbf &&
    (!asset || requestedRbf)
  )
    throw new Error('UTXO_OPTIONS_CHANGED');
  // The existing SDK can disable Z-DAG for allocation transactions above its
  // size limit. Preserve that fallback and disclose the actual reviewed option.
  return Object.freeze({
    rbf,
    ...(asset ? { zdag: !rbf } : {}),
    ...(asset && requestedRbf === false && rbf
      ? { zdagUnavailable: true as const }
      : {}),
  });
}
