/** Normalize decimal entry only; exact amount parsers still validate precision and range. */
export function normalizeDecimalInput(value: string, locale: string): string {
  // Canonical dot entry remains valid in every language. Never strip grouping,
  // spaces or mixed separators, which could silently change the intended value.
  if (!/^[0-9]*,[0-9]*$/.test(value) || !locale) return value;
  try {
    const separator = new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === 'decimal')?.value;
    return separator === ',' ? value.replace(',', '.') : value;
  } catch {
    return value;
  }
}
