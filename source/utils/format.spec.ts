import {
  capitalizeFirstLetter,
  ellipsis,
  formatCurrency,
  formatDate,
  formatUrl,
} from './format';

describe('Format', () => {
  //* ellipsis
  it('should minify a string', () => {
    const input = 'alaksdjalsdkjlaskdj';
    const output = ellipsis(input);

    expect(output.length).toBeLessThan(input.length);
  });

  //* capitalizeFirstLetter
  it('should capitalize the first letter of a string', () => {
    const input = 'lorem ipsum';
    const output = capitalizeFirstLetter(input);

    expect(output.at(0)).toBe(input.at(0)?.toUpperCase());
  });

  //* formatCurrency
  it('should format a currency value', () => {
    const input = '12.3456789';
    const precision = 5;

    const output = formatCurrency(input, precision);

    const afterDot = output.split('.')[1];
    expect(afterDot.length).toBe(precision);
  });

  //* formatDate
  it('should format a date to mm-dd-yyyy', () => {
    const input = new Date(12 * 1000).toDateString();
    const output = formatDate(input);

    // regex to match 'xx-xx-xxxx' with numbers only
    expect(output).toMatch(RegExp('(\\d{2}-){2}\\d{4}'));
  });

  //* formatUrl
  it('should format an URL', () => {
    const input = 'www.testusingjest.com/users/values';
    const output = formatUrl(input);

    expect(input.length).toBeGreaterThanOrEqual(output.length);
    expect(output.endsWith('...')).toBe(true);
  });
});
