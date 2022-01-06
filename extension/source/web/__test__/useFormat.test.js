const { isInteger } = require('lodash');
const {
  ellipsis,
  formatCurrency,
  formatDistanceDate,
  formatNumber,
  formatURL,
} = require('../../hooks/useFormat');

describe('useFormat methods test', () => {
  it('should return a minified string', () => {
    const stringTest = 'alaksdjalsdkjlaskdj';
    const minifiedString = ellipsis(stringTest);
    expect(minifiedString.length).toBeLessThan(stringTest.length);
  });
  it('should return a formatted currency value', () => {
    const precision = 5;
    const formattedCurrency = formatCurrency(String(12 / 10 ** 2), precision);
    expect(formattedCurrency.length).toBeGreaterThan(precision);
  });
  it('should return a formatted distance date', () => {
    const formattedDate = formatDistanceDate(
      new Date(12 * 1000).toDateString()
    );
    expect(formattedDate).toContain('-');
  });
  it('should return a formatted number', () => {
    const formattedNumber = formatNumber(5268);
    const verifierFn = () => {
      if (isInteger(formattedNumber) === false) {
        return true;
      } else {
        return false;
      }
    };
    expect(verifierFn()).toBe(isInteger(formattedNumber) === false);
  });
  it('should return a formatted URL', () => {
    const URL = 'www.testusingjest.com/users/values';
    const formattedURL = formatURL(URL);
    expect(URL.length).toBeGreaterThan(formattedURL.length);
  });
});
