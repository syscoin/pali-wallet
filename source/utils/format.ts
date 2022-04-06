import format from 'date-fns/format';
import currency from 'currency.js';

/**
 * Add `...` to shorten a string. Keeps chars at the beginning and end
 */
export const ellipsis = (str: any, start = 7, end = 4): string => {
  if (typeof str !== 'string') return str;

  return `${str.substring(0, start)}...${str.substring(
    str.length - end,
    str.length
  )}`;
};

export const capitalizeFirstLetter = (string: string) =>
  string.charAt(0).toUpperCase() + string.slice(1);

const getYesterday = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);

  return date;
};

export const formatDate = (timestamp: string) => {
  const formatStyle = 'M-d-yyyy';
  const formatedDate = format(new Date(timestamp), formatStyle);

  const today = new Date();
  const yesterday = getYesterday();

  if (formatedDate === format(today, formatStyle)) return 'Today';
  if (formatedDate === format(yesterday, formatStyle)) return 'Yesterday';

  return formatedDate;
};

export const formatNumber = (num: number, min = 4, max = 4, maxSig = 8) =>
  num.toLocaleString(navigator.language, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    maximumSignificantDigits: maxSig,
  });

export const formatCurrency = (number: string, precision: number) => {
  if (Number(number) < 1e-6) {
    number = Number(number).toFixed(precision);
  }

  return currency(number, {
    separator: ',',
    symbol: '',
    precision,
  }).format();
};

/**
 * Truncate the `url` if length is greater than `size`
 *
 * Default `size` is 30
 */
export const formatUrl = (url: string, size = 30) => {
  if (url.length < size) return url;

  return `${url.slice(0, size)}...`;
};

export const formatSeedPhrase = (seed: string) => {
  const withoutDoubleSpacesRegex = /\s{2,}/g;
  const onlyLettersAndSpacesRegex = /[^a-zA-Z\s]/g;

  const onlyLettersAndSpacesSeed = seed.replace(onlyLettersAndSpacesRegex, ' ');
  const lowerCaseTransform = onlyLettersAndSpacesSeed.toLowerCase();

  const seedWithoutDoubleSpaces = lowerCaseTransform.replace(
    withoutDoubleSpacesRegex,
    ' '
  );
  const seedLength = seedWithoutDoubleSpaces.split(' ').length;
  if (seedLength === 12) {
    const formatedSeed = seedWithoutDoubleSpaces.trim();

    return formatedSeed;
  }
  return seed;
};

/**
 * Converts from `someInputText` to `Some Input Text`
 */
export const camelCaseToText = (input: string) => {
  input = capitalizeFirstLetter(input);
  // this regex splits the string without removing the delimiters
  return input.split(/(?=[A-Z])/).join(' ');
};
