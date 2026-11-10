/** Approximate display only. Never use this number in transaction arithmetic. */
export function formatIndicativeFiat(value: number, currency: string): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const code = currency.toUpperCase();
  const options = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).resolvedOptions();
  const digits = options.maximumFractionDigits;
  if (digits === undefined) return null;
  const format = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const smallest = 10 ** -digits;
  return value > 0 && value < smallest
    ? `< ${format.format(smallest)} ${code}`
    : `≈ ${format.format(value)} ${code}`;
}
