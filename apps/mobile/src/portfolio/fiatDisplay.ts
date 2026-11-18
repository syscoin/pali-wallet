/** Approximate display only. Never use this number in transaction arithmetic. */
export function formatIndicativeFiat(value: number, currency: string, locale: string): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const code = currency.toUpperCase();
  // CoinGecko also quotes in non-ISO units. Keep their precision explicit.
  const unitDigits: Record<string, number> = { BITS: 2, LINK: 8, SATS: 0 };
  const digits = unitDigits[code] ?? new Intl.NumberFormat(locale, { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined) return null;
  const format = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const smallest = 10 ** -digits;
  return value > 0 && value < smallest
    ? `< ${format.format(smallest)} ${code}`
    : `≈ ${format.format(value)} ${code}`;
}
