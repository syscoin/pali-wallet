import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIndicativeFiat } from '../src/portfolio/fiatDisplay.ts';

test('fiat quotes use currency minor units and retain tiny positive amounts', () => {
  assert.equal(formatIndicativeFiat(1844.6744, 'usd', 'en'), '≈ 1,844.67 USD');
  assert.equal(formatIndicativeFiat(1844.6744, 'jpy', 'en'), '≈ 1,845 JPY');
  assert.equal(formatIndicativeFiat(1.23456, 'kwd', 'en'), '≈ 1.235 KWD');
  assert.equal(formatIndicativeFiat(0.00001, 'usd', 'en'), '< 0.01 USD');
  assert.equal(formatIndicativeFiat(0, 'usd', 'en'), '≈ 0.00 USD');
  assert.equal(formatIndicativeFiat(Number.POSITIVE_INFINITY, 'usd', 'en'), null);
  assert.equal(formatIndicativeFiat(-1, 'usd', 'en'), null);
});

test('fiat values follow the explicit Pali display language rather than the system locale', () => {
  assert.equal(formatIndicativeFiat(1234.56, 'eur', 'en'), '≈ 1,234.56 EUR');
  assert.equal(formatIndicativeFiat(1234.56, 'eur', 'de'), '≈ 1.234,56 EUR');
  assert.equal(formatIndicativeFiat(0.001, 'eur', 'de'), '< 0,01 EUR');
});
