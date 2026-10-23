/** Whether an optional SPT balance is known, without coercing decimal precision. */
export const isSptBalanceAvailable = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;

  // Signed balances can represent pending deltas. Availability is separate
  // from whether that balance can fund a positive transfer.
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim());
};
