export const UTXO_REVIEW_FUNDING_CHANGED = 'UTXO_REVIEW_FUNDING_CHANGED';
export const UTXO_FUNDING_UNAVAILABLE = 'UTXO_FUNDING_UNAVAILABLE';

export function isUtxoFundingError(
  code: unknown
): code is
  | typeof UTXO_FUNDING_UNAVAILABLE
  | typeof UTXO_REVIEW_FUNDING_CHANGED {
  return (
    code === UTXO_FUNDING_UNAVAILABLE || code === UTXO_REVIEW_FUNDING_CHANGED
  );
}
