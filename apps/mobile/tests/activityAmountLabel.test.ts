import assert from 'node:assert/strict';
import test from 'node:test';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';

test('groups exact ordinary amounts and removes only insignificant zeroes', () => {
  for (const [input, expected] of [
    ['123456789.123456 SYS', '123,456,789.123456 SYS'],
    ['1000.230000 ETH', '1,000.23 ETH'],
    ['000001234.500000 SYS', '1,234.5 SYS'],
    ['0.000000000000 SYS', '0 SYS'],
    ['+1234.000001 SYS', '+1,234.000001 SYS'],
    ['-1234.000000 SYS', '-1,234 SYS'],
    ['12.34', '12.34'],
  ] as const) assert.equal(compactActivityAmountLabel(input), expected);
});

test('marks discarded nonzero decimals and never marks discarded zeroes as approximate', () => {
  assert.equal(compactActivityAmountLabel('12.123456700 SYS'), '≈12.123456 SYS');
  assert.equal(compactActivityAmountLabel('-0.0000019 ETH'), '≈-0.000001 ETH');
  assert.equal(compactActivityAmountLabel('12.123456000 SYS'), '12.123456 SYS');
});

test('uses exact string-based scientific notation at the billion threshold', () => {
  for (const [input, expected] of [
    ['999999999 SYS', '999,999,999 SYS'],
    ['1000000000 SYS', '1e+9 SYS'],
    ['1234560000 SYS', '1.23456e+9 SYS'],
    ['1234560001 SYS', '≈1.23456e+9 SYS'],
    ['1000000000.000001 SYS', '≈1e+9 SYS'],
    ['9007199254740993 SYS', '≈9.00719e+15 SYS'],
    [`1${'0'.repeat(77)} SYS`, '1e+77 SYS'],
    [`${'9'.repeat(78)} SYS`, '≈9.99999e+77 SYS'],
  ] as const) assert.equal(compactActivityAmountLabel(input), expected);
});

test('preserves tiny nonzero values and their leading fractional zeroes', () => {
  for (const [input, expected] of [
    ['0.000001 SYS', '0.000001 SYS'],
    ['0.0000001 SYS', '1e-7 SYS'],
    ['0.000000000000000001 ETH', '1e-18 ETH'],
    ['0000.000000123456000 SYS', '1.23456e-7 SYS'],
    ['-0.000000123456789 SYS', '≈-1.23456e-7 SYS'],
    [`0.${'0'.repeat(1000)}1 SYS`, '1e-1001 SYS'],
  ] as const) assert.equal(compactActivityAmountLabel(input), expected);
});

test('leaves non-decimal and nonnumeric activity labels unchanged', () => {
  for (const text of [
    'Collectible transfer', 'Amount unavailable', 'Contract interaction',
    '? TOKEN', 'TOKEN transfer', '1e20 SYS', '1,000 SYS', 'NaN SYS', '',
  ]) assert.equal(compactActivityAmountLabel(text), text);
});

test('bounds numeric output including long symbol metadata', () => {
  const result = compactActivityAmountLabel(`${'9'.repeat(1000)}.${'9'.repeat(1000)} ${'T'.repeat(1000)}`);
  assert.equal(result, `≈9.99999e+999 ${'T'.repeat(31)}…`);
  assert(result.length < 64);
  const emoji = compactActivityAmountLabel(`123 ${'🪙'.repeat(20)}`);
  assert(!/[\uD800-\uDBFF]…/.test(emoji));
});
