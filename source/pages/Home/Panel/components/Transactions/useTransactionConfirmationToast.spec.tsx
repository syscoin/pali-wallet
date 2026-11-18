/** @jest-environment jsdom */
/* eslint-disable camelcase -- Explorer protocol fields. */
import { renderHook } from '@testing-library/react';

import { hasEvmExecutionSucceeded } from 'utils/evmReplacement';

import { useTransactionConfirmationToast } from './useTransactionConfirmationToast';

const mockSuccess = jest.fn();
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: { success: mockSuccess } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const mined = (fields = {}) => ({
  hash: 'synthetic-public-hash',
  chainId: 1,
  confirmations: 1,
  blockNumber: 100,
  ...fields,
});
const pending = mined({ confirmations: 0, blockNumber: null });
const isSuccessful = (tx: unknown) => hasEvmExecutionSucceeded(tx, 1);
beforeEach(() => mockSuccess.mockReset());

it.each([{}, { txreceipt_status: 'invalid', isError: null }])(
  'waits for execution evidence after mining %j, then notifies once',
  (unknown) => {
    const view = renderHook(
      ({ rows }) =>
        useTransactionConfirmationToast(
          'account-network',
          rows,
          'hash',
          isSuccessful
        ),
      { initialProps: { rows: [pending] } }
    );
    view.rerender({ rows: [mined(unknown)] });
    expect(mockSuccess).not.toHaveBeenCalled();
    view.rerender({ rows: [mined({ txreceipt_status: '1' })] });
    expect(mockSuccess).toHaveBeenCalledTimes(1);
    view.rerender({
      rows: [mined({ txreceipt_status: '1', confirmations: 2 })],
    });
    expect(mockSuccess).toHaveBeenCalledTimes(1);
  }
);

it('never announces success for a pending → unknown → failed observation', () => {
  const view = renderHook(
    ({ rows }) =>
      useTransactionConfirmationToast(
        'account-network',
        rows,
        'hash',
        isSuccessful
      ),
    { initialProps: { rows: [pending] } }
  );
  view.rerender({ rows: [mined()] });
  view.rerender({ rows: [mined({ txreceipt_status: '0', isError: '0' })] });
  expect(mockSuccess).not.toHaveBeenCalled();
});

it('does not toast first-sync historical outcomes or another scope’s pending rows', () => {
  const view = renderHook(
    ({ scope, rows }) =>
      useTransactionConfirmationToast(scope, rows, 'hash', isSuccessful),
    { initialProps: { scope: 'first', rows: [mined()] } }
  );
  view.rerender({ scope: 'first', rows: [mined({ isError: '0' })] });
  view.rerender({ scope: 'first', rows: [pending] });
  view.rerender({ scope: 'second', rows: [mined({ isError: '0' })] });
  expect(mockSuccess).not.toHaveBeenCalled();
});
