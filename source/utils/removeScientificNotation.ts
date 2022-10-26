import BigNumber from 'bignumber.js';

export const removeScientificNotation = (
  number: number | string
): number | string => {
  const notationExists = number.toString().indexOf('-');
  if (notationExists !== -1) {
    return new BigNumber(number).toFormat();
  }
  return number;
};

export default removeScientificNotation;
