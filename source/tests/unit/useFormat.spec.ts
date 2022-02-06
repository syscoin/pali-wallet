import {
  capitalizeFirstLetter,
  ellipsis,
  formatCurrency,
  formatDistanceDate,
  formatURL,
} from 'hooks/useFormat';

describe('useFormat methods test', () => {
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

  //* formatDistanceDate
  it('should format a date to mm-dd-yyyy', () => {
    const input = new Date(12 * 1000).toDateString();
    const output = formatDistanceDate(input);

    // regex to match 'xx-xx-xxxx' with numbers only
    expect(output).toMatch(RegExp('(\\d{2}-){2}\\d{4}'));
  });

  //* formatURL
  it('should format an URL', () => {
    const input = 'www.testusingjest.com/users/values';
    const output = formatURL(input);

    expect(input.length).toBeGreaterThanOrEqual(output.length);
    expect(output.endsWith('...')).toBe(true);
  });
});
