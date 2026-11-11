const MAX_SYMBOL_LENGTH = 32;
const SIGNIFICANT_DIGITS = 6;

/** Compact display only. The original text remains the exact amount for details and accessibility. */
export function compactActivityAmountLabel(text: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[ \t]+(.+))?$/.exec(text);
  if (!match) return text;

  const rawInteger = match[2];
  if (rawInteger === undefined) return text;
  const sign = match[1] ?? '';
  const rawFraction = match[3] ?? '';
  const symbol = match[4] ?? '';
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const firstFractionDigit = rawFraction.search(/[1-9]/);
  const tiny = integer === '0' && firstFractionDigit >= SIGNIFICANT_DIGITS;
  let number: string;
  let approximate = false;

  if (integer.length > 9 || tiny) {
    const digits = tiny
      ? rawFraction.slice(firstFractionDigit)
      : integer + rawFraction;
    const exponent = tiny ? -(firstFractionDigit + 1) : integer.length - 1;
    const kept = digits.slice(0, SIGNIFICANT_DIGITS);
    const fraction = kept.slice(1).replace(/0+$/, '');
    approximate = /[1-9]/.test(digits.slice(SIGNIFICANT_DIGITS));
    number = `${kept.charAt(0)}${fraction ? `.${fraction}` : ''}e${exponent >= 0 ? '+' : ''}${exponent}`;
  } else {
    const fraction = rawFraction.slice(0, SIGNIFICANT_DIGITS).replace(/0+$/, '');
    approximate = /[1-9]/.test(rawFraction.slice(SIGNIFICANT_DIGITS));
    number = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
  }

  const units = symbol.length > MAX_SYMBOL_LENGTH
    ? `${symbol.slice(0, MAX_SYMBOL_LENGTH - 1).replace(/[\uD800-\uDBFF]$/, '')}…`
    : symbol;
  return `${approximate ? '≈' : ''}${sign}${number}${units ? ` ${units}` : ''}`;
}
