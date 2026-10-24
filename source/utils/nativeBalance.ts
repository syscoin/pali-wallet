/** Native balances use -1 for unknown; zero is a valid loaded balance. */
export const isNativeBalanceAvailable = (value: unknown): boolean =>
  (typeof value === 'number' ||
    (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0;
