// Convert a JavaScript number to a base-10 integer string without scientific notation
// Truncates toward zero
export const numberToIntegerString = (num: number): string => {
  if (!isFinite(num) || isNaN(num)) {
    throw new Error(`Invalid number: ${num} (not finite)`);
  }
  if (num === 0) return '0';

  const isNegative = num < 0;
  const abs = Math.abs(num);
  if (abs < 1) return '0';

  const expStr = abs.toExponential();
  const match = expStr.match(/^(\d+)(?:\.(\d+))?e([+\-]?\d+)$/i);
  if (!match) {
    const truncated = Math.trunc(num);
    const s = truncated.toString();
    return s.includes('e') || s.includes('E')
      ? truncated.toLocaleString('en-US', { useGrouping: false })
      : s;
  }

  const mantInt = match[1];
  const mantFrac = match[2] || '';
  const exp = parseInt(match[3], 10);
  const digits = mantInt + mantFrac;
  const integerLength = 1 + exp;
  if (integerLength <= 0) return '0';

  let integerDigits: string;
  if (digits.length >= integerLength) {
    integerDigits = digits.slice(0, integerLength);
  } else {
    integerDigits = digits + '0'.repeat(integerLength - digits.length);
  }
  const normalized = integerDigits.replace(/^0+/, '') || '0';
  return isNegative && normalized !== '0' ? `-${normalized}` : normalized;
};

// Convert scientific notation string to an integer string without scientific notation
// Truncates toward zero
export const scientificToIntegerString = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(/^([+\-]?)(\d+)(?:\.(\d*))?[eE]([+\-]?\d+)$/);
  if (!match) {
    throw new Error(`Invalid scientific notation: ${value}`);
  }
  const sign = match[1] === '-' ? '-' : '';
  const intPart = match[2];
  const fracPart = match[3] || '';
  const exp = parseInt(match[4], 10);
  const digits = intPart + fracPart;
  const integerLength = intPart.length + exp;
  if (integerLength <= 0) return '0';
  let integerDigits: string;
  if (digits.length >= integerLength) {
    integerDigits = digits.slice(0, integerLength);
  } else {
    integerDigits = digits + '0'.repeat(integerLength - digits.length);
  }
  const normalized = integerDigits.replace(/^0+/, '') || '0';
  return sign && normalized !== '0' ? `${sign}${normalized}` : normalized;
};
