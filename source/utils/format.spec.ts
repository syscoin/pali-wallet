import {
  capitalizeFirstLetter,
  ellipsis,
  formatCurrency,
  formatDate,
  formatSeedPhrase,
  truncate,
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
    const input = new Date(12 * 1000);
    const output = formatDate(String(input));

    // regex to match 'xx-xx-xxxx' with numbers only
    // m should be between 1 and 12
    // d should be between 1 and 31
    expect(output).toMatch(
      /(0[1-9]|[0-1][0-2]|[1-9])-(0[0-9]|1[0-9]|2[0-9]|3[0,1]|[1-9])-[0-9]{4}/g
    );
  });

  //* truncate
  it('should truncate a string', () => {
    const input = 'www.testusingjest.com/users/values';
    const output = truncate(input);

    expect(input.length).toBeGreaterThanOrEqual(output.length);
    expect(output.endsWith('...')).toBe(true);
  });

  //* formatSeedPhrase
  // remove double spaces, numbers and symbols
  // transform in lowerCase
  it('should format a Seed Phrase', () => {
    const input =
      ' this? test! phrase   phone3 here use hello annual fury letter snack globe ';
    const output = formatSeedPhrase(input);
    const outputLenght = String(output).split(' ').length;

    expect(output).toBe(
      'this test phrase phone here use hello annual fury letter snack globe'
    );
    expect(outputLenght).toBe(12);
  });

  it('normalizes single line breaks, tabs and nonbreaking spaces between seed words', () => {
    const words = Array(11).fill('abandon').concat('about');
    const expected = words.join(' ');
    for (const separator of ['\n', '\r\n', '\t', '\u00a0']) {
      expect(formatSeedPhrase(` \t${words.join(separator)}\n `)).toBe(expected);
    }
    expect(formatSeedPhrase(words.slice(1).join('\n'))).toEqual({
      seedLength: 11,
      seedLengthError: true,
    });
  });
});
