import { removeScientificNotation } from '.';

// Truncate values without around using regex
const truncateNumberWithoutRound = (
  value: number | string,
  precision: number
): string => {
  const regex = new RegExp(`^-?\\d+(?:\.\\d{0,${precision || -1}})?`);

  const truncatedValue = value.toString().match(regex)[0];

  return truncatedValue;
};

// Get all type of values BigInt or not, truncate using the correct validation and return value formatted
export const verifyZerosInBalanceAndFormat = (
  balance: number,
  precision: number
): string => {
  if (!balance) return;

  const fullValue = removeScientificNotation(balance);

  const quantityOfZerosAfterDot = -Math.floor(
    Math.log10(fullValue as number) + 1
  );

  const firstNumber = fullValue.toString().charAt(0);

  const secondValueSplitted =
    fullValue > 0 &&
    (fullValue.toString().split('.')[1].charAt(0) as string | false);

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
    fractionValidation
      ? quantityOfZerosAfterDot + precision
      : defaultPrecisionValidated
  );

  return formattedAndTruncatedValue;
};
