import assert from 'node:assert/strict';
import test from 'node:test';
import { isStrongWalletPassword } from '../../../source/shared/passwordPolicy.ts';

const valid = 'Abcdefghij1!';
const cases: readonly [string, string, boolean][] = [
  ['exact twelve characters', valid, true],
  ['eleven characters', 'Abcdefghi1!', false],
  ['lowercase required', 'ABCDEFGHIJ1!', false],
  ['uppercase required', 'abcdefghij1!', false],
  ['ASCII number required', 'Abcdefghijk!', false],
  ['listed symbol required', 'Abcdefghijk1', false],
  ['spaces preserved', '  Abcdefghij1!  ', true],
  ['newline rejected', `${valid}\n`, false],
  ['Unicode line separator rejected', `${valid}\u2028`, false],
  ['ASCII letters are not replaced with accented letters', 'Éééééééééé1!', false],
  ['fullwidth digit is not ASCII number', 'Abcdefghij１!', false],
  ['emoji is not a listed symbol', 'Abcdefghij1😀', false],
  ['existing UTF16 length behavior', 'Aa1!😀😀😀😀', true],
];
for (const [name, input, expected] of cases) {
  test(`shared extension policy: ${name}`, () => {
    assert.equal(isStrongWalletPassword(input), expected);
  });
}

test('all existing ASCII special characters remain accepted', () => {
  for (const symbol of `!@#$%^&*()_+-=[]{};':"\\|,.<>/?`) {
    assert.equal(isStrongWalletPassword(`Abcdefghij1${symbol}`), true, symbol);
  }
});
