import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDecimalInput } from '../../../source/shared/decimalInput.ts';
import { parseUnsignedTokenAmount } from '../../../source/shared/erc20.ts';
import { parseDecimalAmount } from '../src/core/amounts.ts';

test('localized fractional input reaches unchanged exact coin, UTXO and token parsers', () => {
  for (const locale of ['fr', 'de', 'es', 'pt', 'ru']) {
    const amount = normalizeDecimalInput('0,25', locale);
    assert.equal(amount, '0.25');
    assert.equal(parseDecimalAmount(amount, 18), 250000000000000000n);
    assert.equal(parseDecimalAmount(amount, 8), 25000000n);
    assert.equal(parseUnsignedTokenAmount(amount, 6), '250000');
  }
  const smallestToken = normalizeDecimalInput(`0,${'0'.repeat(254)}1`, 'fr');
  assert.equal(parseUnsignedTokenAmount(smallestToken, 255), '1');
});

test('editing stays possible without treating grouping or mixed separators as amounts', () => {
  for (const [input, expected] of [['', ''], ['0,', '0.'], [',', '.'], [',2', '.2']] as const)
    assert.equal(normalizeDecimalInput(input!, 'de'), expected);
  for (const locale of ['en', 'fr', 'de', 'es', 'pt', 'ru', 'zh', 'ja', 'ko'])
    assert.equal(normalizeDecimalInput('1234.5678', locale), '1234.5678');
  for (const value of ['1,234.56', '1.234,56', '1,2,3', '1 234,56', '1\u202f234,56', '1e3', '-1,25']) {
    const amount = normalizeDecimalInput(value, 'de');
    assert.equal(amount, value);
    assert.throws(() => parseDecimalAmount(amount, 18));
    assert.throws(() => parseUnsignedTokenAmount(amount, 6));
  }
  for (const locale of ['en', 'zh', 'ja', 'ko', 'invalid_locale']) {
    assert.equal(normalizeDecimalInput('1,234', locale), '1,234');
    assert.throws(() => parseDecimalAmount(normalizeDecimalInput('1,234', locale), 18));
  }
});
