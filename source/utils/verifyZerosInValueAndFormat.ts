import { removeScientificNotation } from '.';

// Truncate values without rounding using regex
const truncateNumberWithoutRound = (
  value: number | string,
  precision: number
): string => {
  const regex = new RegExp(`^-?\\d+(?:\.\\d{0,${precision || -1}})?`);

  const truncatedValue = value.toString().match(regex)[0];

  return truncatedValue;
};

/**
 * Public helper to truncate a numeric string/number to a fixed number of decimal places
 * without rounding. Preserves sign and integer part.
 */
export const truncateToDecimals = (
  value: number | string,
  precision: number
): string => truncateNumberWithoutRound(value, Math.max(0, precision));

// Get all type of values BigInt or not, truncate using the correct validation and return value formatted
export const verifyZerosInBalanceAndFormat = (
  balance: number,
  precision: number
): string => {
  if (balance === 0) return '0';
  if (!balance) return;

  const fullValue = removeScientificNotation(balance) as number;

  const fullValueStr = fullValue.toString();
  const firstNumber = fullValueStr.charAt(0);
  const hasDecimalPoint = fullValueStr.includes('.');
  let secondValueSplitted: string | false = false;
  if (hasDecimalPoint) {
    secondValueSplitted =
      fullValue > 0 && (fullValueStr.split('.')[1].charAt(0) as string | false);
  }
  const valuesValidations = [
    Number(firstNumber) === 0 &&
      secondValueSplitted !== false &&
      Number(secondValueSplitted) === 0,
  ];
  const defaultPrecisionValidated =
    secondValueSplitted === false ? 0 : precision;

  const fractionValidation = valuesValidations.every(
    (validation) => validation === true
  );
  const formattedAndTruncatedValue = truncateNumberWithoutRound(
    fullValue,
    fractionValidation ? precision : defaultPrecisionValidated
  );

  return formattedAndTruncatedValue;
};
