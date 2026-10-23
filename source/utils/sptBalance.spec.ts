import { isSptBalanceAvailable } from './sptBalance';

describe('optional SPT balance availability', () => {
  it.each([
    0,
    -1,
    2.5,
    '0',
    '0.00000000',
    '-0.00000001',
    '+2.5',
    '.5',
    '2.',
    ' 2.50 ',
    '9007199254740993.12345678',
    '9'.repeat(400),
  ])('recognizes the finite decimal balance %p without conversion', (value) => {
    expect(isSptBalanceAvailable(value)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    ' \n\t ',
    NaN,
    Infinity,
    -Infinity,
    'NaN',
    'Infinity',
    '-Infinity',
    '1e3',
    '0x10',
    '1,000',
    '1.2.3',
    '2 tokens',
    '--1',
    '.',
    true,
    [],
    {},
  ])('does not substitute zero for the unknown balance %p', (value) => {
    expect(isSptBalanceAvailable(value)).toBe(false);
  });
});
