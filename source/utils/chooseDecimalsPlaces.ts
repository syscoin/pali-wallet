export const chooseDecimalsPlaces = (value: number | string, precision = 2) => {
  const valueInNumber = Number(value);

  const decimals = valueInNumber.toString().split('.')[1];

  const decimalsLength = decimals && decimals.length;

  const factor = Math.pow(10, precision);

  return decimalsLength > 2
    ? Math.floor(valueInNumber * factor) / factor
    : valueInNumber.toFixed(2);
};
