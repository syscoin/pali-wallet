/** @jest-environment jsdom */
import { render, renderHook, screen } from '@testing-library/react';
import React from 'react';

import { UtxoTransactionsListComponent } from '../UTXO/UtxoList';

import { useTransactionsListConfig } from './useTransactionsInfos';

let mockBitcoinBased = true;
let mockLocale = 'en';
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeNetwork: {
          currency: mockBitcoinBased ? 'btc' : 'eth',
          chainId: mockBitcoinBased ? 0 : 1,
          url: 'https://synthetic.example/',
        },
        isBitcoinBased: mockBitcoinBased,
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: mockLocale, language: mockLocale },
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountAssets: () => ({ syscoin: [] }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'public-account',
    network: 'synthetic-network',
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    useCopyClipboard: () => [false, jest.fn()],
    alert: { success: jest.fn() },
  }),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DetailArrowSvg: () => null,
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('utils/index', () => ({
  getTokenLogo: () => undefined,
  ellipsis: (value: string) => value,
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));

const seconds = (value: string) => Date.parse(value) / 1000;
let warn: jest.SpyInstance;
beforeEach(() => {
  mockBitcoinBased = true;
  mockLocale = 'en';
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  jest.useRealTimers();
});

const showUtxoDate = (blockTime: number) =>
  render(
    <UtxoTransactionsListComponent
      tx={
        {
          txid: 'a'.repeat(64),
          blockTime,
          blockHeight: 100,
          confirmations: 3,
          vin: [],
          vout: [],
          addressValueIn: '0',
          addressValueOut: '100000000',
          fees: '1000',
        } as any
      }
    />
  );

it.each([
  [seconds('2014-02-03T12:00:00Z'), '02-03-14'],
  [seconds('2009-01-03T12:00:00Z'), '01-03-09'],
  [seconds('2024-02-03T12:00:00Z'), '02-03-24'],
])('shows the actual UTXO row date for timestamp %s', (timestamp, expected) => {
  showUtxoDate(Number(timestamp));
  expect(screen.getByText(String(expected))).toBeTruthy();
  expect(warn).not.toHaveBeenCalled();
});

it('accepts historical millisecond input in the UTXO date formatter', () => {
  const { result } = renderHook(() => useTransactionsListConfig());
  render(
    result.current.formatTimeStampUtxo(Date.parse('2014-02-03T12:00:00Z'))
  );
  expect(screen.getByText('02-03-14')).toBeTruthy();
  expect(warn).not.toHaveBeenCalled();
});

it.each([
  [seconds('2015-08-03T12:00:00Z'), 'Aug 03, 2015'],
  [seconds('2024-02-03T12:00:00Z'), 'Feb 03, 2024'],
  [seconds('2026-10-18T12:00:00Z'), 'transactions.today'],
  [seconds('2026-10-17T12:00:00Z'), 'transactions.yesterday'],
])(
  'keeps the EVM history group date for timestamp %s',
  (timestamp, expected) => {
    mockBitcoinBased = false;
    const { result } = renderHook(() => useTransactionsListConfig());
    expect(result.current.formatTimeStamp(Number(timestamp))).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  }
);

it.each([0, -1, NaN, Infinity, seconds('2029-01-01T12:00:00Z')])(
  'retains the current-date fallback for invalid EVM timestamp %s',
  (timestamp) => {
    mockBitcoinBased = false;
    const { result } = renderHook(() => useTransactionsListConfig());
    expect(result.current.formatTimeStamp(timestamp)).toBe(
      'transactions.today'
    );
    expect(warn).toHaveBeenCalled();
  }
);

it.each([
  0,
  -1,
  NaN,
  Infinity,
  seconds('2029-01-01T12:00:00Z'),
  Date.parse('2029-01-01T12:00:00Z'),
])(
  'retains the current-date fallback for invalid UTXO timestamp %s',
  (timestamp) => {
    showUtxoDate(timestamp);
    expect(screen.getByText('10-18-26')).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  }
);

it.each(['de', 'fr'])(
  'updates historical EVM and UTXO dates after language changes to %s without changing the instant',
  (locale) => {
    const timestamp = seconds('2014-02-03T12:00:00Z');
    const date = new Date(timestamp * 1000);
    const { result, rerender } = renderHook(() => useTransactionsListConfig());
    const englishGroup = result.current.formatTimeStamp(timestamp);
    const row = render(result.current.formatTimeStampUtxo(timestamp));
    expect(screen.getByText('02-03-14')).toBeTruthy();

    mockLocale = locale;
    rerender();
    row.rerender(result.current.formatTimeStampUtxo(timestamp));
    expect(result.current.formatTimeStamp(timestamp)).toBe(
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }).format(date)
    );
    expect(
      screen.getByText(
        new Intl.DateTimeFormat(locale, {
          month: '2-digit',
          day: '2-digit',
          year: '2-digit',
        }).format(date)
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        new Intl.DateTimeFormat(locale, {
          hour: 'numeric',
          minute: 'numeric',
        }).format(date)
      )
    ).toBeTruthy();
    // Milliseconds and seconds identify the same historical instant.
    row.rerender(result.current.formatTimeStampUtxo(timestamp * 1000));
    expect(
      screen.getByText(
        new Intl.DateTimeFormat(locale, {
          month: '2-digit',
          day: '2-digit',
          year: '2-digit',
        }).format(date)
      )
    ).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();

    mockLocale = 'en';
    rerender();
    row.rerender(result.current.formatTimeStampUtxo(timestamp));
    expect(result.current.formatTimeStamp(timestamp)).toBe(englishGroup);
    expect(screen.getByText('02-03-14')).toBeTruthy();
    expect(date.getTime()).toBe(timestamp * 1000);
  }
);

it.each(['de', 'fr'])(
  'retains recent labels and invalid/future fallback in %s',
  (locale) => {
    mockLocale = locale;
    const { result } = renderHook(() => useTransactionsListConfig());
    expect(
      result.current.formatTimeStamp(seconds('2026-10-18T12:00:00Z'))
    ).toBe('transactions.today');
    expect(
      result.current.formatTimeStamp(seconds('2026-10-17T12:00:00Z'))
    ).toBe('transactions.yesterday');
    const row = render(result.current.formatTimeStampUtxo(NaN));
    const today = new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    }).format(new Date());
    expect(screen.getByText(today)).toBeTruthy();
    for (const invalid of [
      0,
      -1,
      NaN,
      Infinity,
      seconds('2029-01-01T12:00:00Z'),
    ]) {
      expect(result.current.formatTimeStamp(invalid)).toBe(
        'transactions.today'
      );
      row.rerender(result.current.formatTimeStampUtxo(invalid));
      expect(screen.getByText(today)).toBeTruthy();
    }
    expect(warn).toHaveBeenCalled();
  }
);
