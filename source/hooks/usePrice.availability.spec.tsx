/** @jest-environment jsdom */
import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import price, { rehydrate, setPrices } from 'state/price';
import type { IAssetPrice } from 'state/price/types';

import { usePrice } from './usePrice';

const setup = (fiat?: IAssetPrice) => {
  const store = configureStore({ reducer: { price } });
  if (fiat) store.dispatch(rehydrate({ fiat }));
  const hook = renderHook(() => usePrice(), {
    wrapper: ({ children }: React.PropsWithChildren) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
  return { store, ...hook };
};

it('keeps the initial unquoted state unavailable without changing numeric formatting', () => {
  const { result } = setup();
  expect(result.current.isFiatAvailable).toBe(false);
  expect(result.current.getFiatAmount(2, 4, 'EUR')).toBe('0 EUR');
});

it.each([
  [
    'positive quote',
    { asset: 'eur', available: true, price: 13 },
    true,
    '26 EUR',
  ],
  [
    'real zero quote',
    { asset: 'eur', available: true, price: 0 },
    true,
    '0 EUR',
  ],
  [
    'finite negative quote',
    { asset: 'eur', available: true, price: -13 },
    true,
    '-26 EUR',
  ],
  [
    'failed quote',
    { asset: 'eur', available: false, price: 0 },
    false,
    '0 EUR',
  ],
  [
    'explicitly unavailable retained numeric data',
    { asset: 'eur', available: false, price: 13 },
    false,
    '26 EUR',
  ],
  [
    'legacy zero without provenance',
    { asset: 'eur', price: 0 },
    false,
    '0 EUR',
  ],
  ['legacy positive quote', { asset: 'eur', price: 13 }, true, '26 EUR'],
  [
    'legacy finite negative quote',
    { asset: 'eur', price: -13 },
    true,
    '-26 EUR',
  ],
  [
    'nonfinite persisted quote',
    { asset: 'eur', available: true, price: Infinity },
    false,
    '0 EUR',
  ],
] as const)(
  'distinguishes %s while preserving the formatter result',
  (_name, fiat, available, expected) => {
    const { result } = setup(fiat);
    expect(result.current.isFiatAvailable).toBe(available);
    expect(result.current.getFiatAmount(2, 4, 'EUR')).toBe(expected);
  }
);

it('changes availability on the same mounted hook through quote, reset, and valid zero receipt', () => {
  const { store, result } = setup({ asset: 'usd', available: true, price: 4 });
  expect(result.current.isFiatAvailable).toBe(true);
  expect(result.current.getFiatAmount(2)).toBe('8 USD');
  act(() =>
    store.dispatch(setPrices({ asset: 'eur', available: false, price: 0 }))
  );
  expect(result.current.isFiatAvailable).toBe(false);
  expect(result.current.getFiatAmount(2)).toBe('0 EUR');
  act(() =>
    store.dispatch(setPrices({ asset: 'eur', available: true, price: 0 }))
  );
  expect(result.current.isFiatAvailable).toBe(true);
  expect(result.current.getFiatAmount(2)).toBe('0 EUR');
  act(() =>
    store.dispatch(setPrices({ asset: 'eur', available: true, price: 13 }))
  );
  expect(result.current.isFiatAvailable).toBe(true);
  expect(result.current.getFiatAmount(2)).toBe('26 EUR');
});
