import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIndicativeFiat } from '../src/portfolio/fiatDisplay.ts';
import { FIAT_QUOTE_CURRENCIES } from '../../../source/shared/nativeCoinQuotes.ts';
import { createFiatPreferences } from '../src/core/fiatPreference.ts';

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

test('every offered display unit renders after saving and reloading its preference', async () => {
  for (const currency of FIAT_QUOTE_CURRENCIES) {
    let saved: string | null = null;
    const port = { get: async () => saved, set: async (value: string) => { saved = value; } };
    const preference = createFiatPreferences(port);
    await preference.reload();
    assert.equal(await preference.save(currency), true);
    const reopened = createFiatPreferences(port);
    await reopened.reload();
    assert.deepEqual(reopened.getSnapshot(), { status: 'ready', currency });
    for (const value of [0, 1e-10, 123456789.12345678]) {
      for (const locale of ['en', 'de', 'ja']) {
        const display = formatIndicativeFiat(value, currency, locale);
        assert(display?.endsWith(` ${currency.toUpperCase()}`), `${currency} ${locale}`);
      }
    }
  }
  assert.equal(formatIndicativeFiat(0.00000001, 'link', 'en'), '≈ 0.00000001 LINK');
  assert.equal(formatIndicativeFiat(1.234, 'bits', 'en'), '≈ 1.23 BITS');
  assert.equal(formatIndicativeFiat(0.5, 'sats', 'en'), '< 1 SATS');
});
