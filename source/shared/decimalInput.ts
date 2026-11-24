/** Normalize decimal entry only; exact amount parsers still validate precision and range. */
export function normalizeDecimalInput(value: string, locale: string): string {
  // Canonical dot entry remains valid in every language. Never strip grouping,
  // spaces or mixed separators, which could silently change the intended value.
  if (!/^[0-9]*,[0-9]*$/.test(value) || !locale) return value;
  try {
    // Hermes on iOS supports format(), but not NumberFormat.formatToParts().
    const sample = new Intl.NumberFormat(locale, { useGrouping: false }).format(
      1.1
    );
    return sample.includes(',') ? value.replace(',', '.') : value;
  } catch {
    return value;
  }
}
