/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react';

import { useTransactionsListConfig } from './useTransactionsInfos';

const mockState = {
  vault: { activeNetwork: { chainId: 5700 }, isBitcoinBased: false },
};
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
}));

describe('transaction history display ordering', () => {
  beforeEach(() => {
    mockState.vault.isBitcoinBased = false;
  });

  it('keeps same-second EVM attempts in the same order when refresh permutes rows', () => {
    const attempts = ['d', 'c', 'b', 'a'].map((digit) => ({
      hash: `0x${digit.repeat(64)}`,
      timestamp: 1000,
      chainId: 5700,
      nonce: 42,
    }));
    const originalOrder = attempts.slice();
    const { result, rerender } = renderHook(
      ({ transactions }) => useTransactionsListConfig(transactions),
      { initialProps: { transactions: attempts } }
    );
    const expected = attempts.map(({ hash }) => hash).sort();
    expect(
      result.current.filteredTransactions.map(({ hash }: any) => hash)
    ).toEqual(expected);
    for (let refresh = 1; refresh <= attempts.length; refresh += 1) {
      rerender({
        transactions: attempts
          .slice(refresh)
          .concat(attempts.slice(0, refresh))
          .map((transaction) => ({ ...transaction })),
      });
      expect(
        result.current.filteredTransactions.map(({ hash }: any) => hash)
      ).toEqual(expected);
    }
    expect(attempts).toEqual(originalOrder);
  });

  it('sorts differing timestamps newest first before considering hash ties', () => {
    const transactions = ['a', 'b', 'c'].map((digit, index) => ({
      hash: `0x${digit.repeat(64)}`,
      timestamp: 1000 + index,
      chainId: 5700,
    }));
    const { result } = renderHook(() =>
      useTransactionsListConfig(transactions)
    );
    expect(
      result.current.filteredTransactions.map(({ hash }: any) => hash)
    ).toEqual(transactions.map(({ hash }) => hash).reverse());
  });

  it('leaves UTXO timestamp ties in their existing order', () => {
    mockState.vault.isBitcoinBased = true;
    const transactions = ['d', 'a'].map((digit) => ({
      txid: digit.repeat(64),
      blockTime: 1000,
    }));
    const { result } = renderHook(() =>
      useTransactionsListConfig(transactions)
    );
    expect(result.current.filteredTransactions).toEqual(transactions);
  });
});
