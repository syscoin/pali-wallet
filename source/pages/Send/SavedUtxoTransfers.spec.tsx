/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { SavedUtxoTransfers } from './SavedUtxoTransfers';

const mockEmitter = jest.fn();
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('separates exact saved asset amounts, native funding and transaction data before consent', async () => {
  const txid = '11'.repeat(32);
  mockEmitter.mockImplementation(async ([, method]) => {
    if (
      method === 'listRetainedUtxoTransfers' ||
      method === 'refreshRetainedUtxoTransfers'
    )
      return [{ accepted: false, txid }];
    if (method === 'checkRetainedUtxoTransfer') return 'unknown';
    if (method === 'prepareRetainedUtxoRetry')
      return {
        feeSatoshis: '1000',
        id: 'review',
        originalOrigin: 'https://original.invalid',
        outputs: [
          {
            address: 'sys1qpublicrecipient',
            amountSatoshis: '546',
            asset: { assetGuid: '123456', rawAmount: '9007199254740993' },
          },
          { script: { kind: 'data', hex: '6a0101' }, amountSatoshis: '0' },
          {
            address: 'sys1qpublicoutput',
            amountSatoshis: '546',
            asset: { assetGuid: '4294967297', rawAmount: '23' },
          },
        ],
      };
    if (method === 'confirmRetainedUtxoRetry') return { txid };
    throw new Error(`Unexpected controller method ${method}`);
  });
  render(<SavedUtxoTransfers symbol="SYS" />);
  fireEvent.click(screen.getByText('send.savedUtxo.title'));
  fireEvent.click(
    await screen.findByRole('button', { name: /send.savedUtxo.check/ })
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'send.savedUtxo.review' })
  );
  expect(
    await screen.findByText('90071992.54740993 SYSX · send.assetGuid 123456')
  ).toBeVisible();
  expect(
    screen.getByText(
      '23 transactions.replay.rawUnits · send.assetGuid 4294967297'
    )
  ).toBeVisible();
  expect(screen.getAllByText('0.00000546 SYS')).toHaveLength(2);
  expect(screen.getByText('https://original.invalid')).toBeVisible();
  expect(screen.getByText(/transactions.origin/)).toBeVisible();
  const data = screen.getByText('transactions.opReturnData');
  expect(data.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(data);
  expect(data.closest('details')).toHaveAttribute('open');
  expect(screen.getByText('6a0101')).toBeVisible();
  expect(mockEmitter).not.toHaveBeenCalledWith(
    ['wallet', 'confirmRetainedUtxoRetry'],
    expect.anything()
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.replay.resend' })
  );
  expect(await screen.findByText('notifications.submitted')).toBeVisible();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'confirmRetainedUtxoRetry'],
    ['review']
  );
});

it('reloads recovery rows after a status check confirms the saved transfer', async () => {
  mockEmitter.mockReset();
  const txid = '22'.repeat(32);
  let checked = false;
  mockEmitter.mockImplementation(async ([, method]) => {
    if (
      method === 'listRetainedUtxoTransfers' ||
      method === 'refreshRetainedUtxoTransfers'
    )
      return checked ? [] : [{ txid, accepted: true }];
    if (method === 'checkRetainedUtxoTransfer') {
      checked = true;
      return 'confirmed';
    }
    throw new Error(`Unexpected controller method ${method}`);
  });
  render(<SavedUtxoTransfers symbol="SYS" />);
  fireEvent.click(screen.getByText('send.savedUtxo.title'));
  fireEvent.click(
    await screen.findByRole('button', { name: /notifications.submitted/ })
  );
  expect(await screen.findByText('notifications.confirmed')).toBeVisible();
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /notifications.submitted/ })
    ).toBeNull()
  );
  expect(screen.getByText('send.savedUtxo.empty')).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(
      ([path]) => path[1] === 'refreshRetainedUtxoTransfers'
    )
  ).toHaveLength(1);
  expect(
    mockEmitter.mock.calls.filter(
      ([path]) => path[1] === 'listRetainedUtxoTransfers'
    )
  ).toHaveLength(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'refreshRetainedUtxoTransfers'],
    [],
    30_000
  );
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'checkRetainedUtxoTransfer'],
    [txid],
    30_000
  );
  expect(mockEmitter).not.toHaveBeenCalledWith(
    ['wallet', 'confirmRetainedUtxoRetry'],
    expect.anything()
  );
});
