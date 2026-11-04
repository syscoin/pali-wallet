import {
  isStrongWalletPassword,
  WALLET_PASSWORD_PATTERN,
} from './passwordPolicy';

describe('existing shared extension password policy', () => {
  it.each([
    ['Abcdefghij1!', true],
    ['Abcdefghi1!', false],
    ['ABCDEFGHIJ1!', false],
    ['abcdefghij1!', false],
    ['Abcdefghijk!', false],
    ['Abcdefghijk1', false],
    ['Aa1!😀😀😀😀', true],
    ['Abcdefghij1😀', false],
    ['Abcdefghij1!\n', false],
    ['Abcdefghij1!\u2028', false],
    ['Abcdefghij１!', false],
    ['  Abcdefghij1!  ', true],
  ])('preserves the existing rule for %p', (input, expected) => {
    expect(isStrongWalletPassword(input)).toBe(expected);
    expect(WALLET_PASSWORD_PATTERN.test(input)).toBe(expected);
  });

  it('rejects nonstrings without coercing them', () => {
    expect(isStrongWalletPassword({ toString: () => 'Abcdefghij1!' })).toBe(
      false
    );
    expect(isStrongWalletPassword(null)).toBe(false);
  });
});
