import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIndicativeFiat } from '../src/portfolio/fiatDisplay.ts';

test('fiat quotes use currency minor units and retain tiny positive amounts', () => {
  assert.equal(formatIndicativeFiat(1844.6744, 'usd'), '≈ 1,844.67 USD');
  assert.equal(formatIndicativeFiat(1844.6744, 'jpy'), '≈ 1,845 JPY');
  assert.equal(formatIndicativeFiat(1.23456, 'kwd'), '≈ 1.235 KWD');
  assert.equal(formatIndicativeFiat(0.00001, 'usd'), '< 0.01 USD');
  assert.equal(formatIndicativeFiat(0, 'usd'), '≈ 0.00 USD');
  assert.equal(formatIndicativeFiat(Number.POSITIVE_INFINITY, 'usd'), null);
  assert.equal(formatIndicativeFiat(-1, 'usd'), null);
});
