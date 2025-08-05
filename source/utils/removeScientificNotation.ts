import BigNumber from 'bignumber.js';

export const removeScientificNotation = (
  number: number | string
): number | string => {
  const stringValue = number?.toString();
  // Check for scientific notation (e or E)
  if (stringValue && (stringValue.includes('e') || stringValue.includes('E'))) {
    // Use toFixed to convert to decimal notation
    // BigNumber handles large and small numbers properly
    return new BigNumber(number).toFixed();
  }
  return number;
};

export default removeScientificNotation;
