/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

import { UtxoReplacementActions } from './UtxoReplacementActions';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));

const original = 'ab'.repeat(32);
const replacement = 'cd'.repeat(32);
const mockEmitter = jest.mocked(controllerEmitter);

beforeEach(() => mockEmitter.mockReset());

it('reviews exact cancellation outputs and checks the replacement after an uncertain submission', async () => {
  const user = userEvent.setup();
  mockEmitter
    .mockResolvedValueOnce({ cancel: true, speedUp: true })
    .mockResolvedValueOnce({
      kind: 'cancel',
      id: 'review-id',
      validForMs: 90_000,
      previousFeeSatoshis: '1000',
      feeSatoshis: '1500',
      outputs: [{ address: 'wallet-output', amountSatoshis: '75000' }],
    })
    .mockRejectedValueOnce({
      transactionNotBroadcast: false,
      txid: replacement,
    })
    .mockResolvedValueOnce('confirmed');

  render(<UtxoReplacementActions txid={original} currency="SYS" />);
  await user.click(
    await screen.findByRole('button', { name: 'header.cancelTx' })
  );

  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText('0.00001 SYS')).toBeVisible();
  expect(dialog.getByText('0.000015 SYS')).toBeVisible();
  expect(dialog.getByText('0.00075 SYS')).toBeVisible();
  expect(dialog.getByText('wallet-output')).toBeVisible();
  expect(mockEmitter.mock.calls.map(([method]) => method[1])).toEqual([
    'getUtxoReplacementActions',
    'prepareUtxoReplacement',
  ]);
  await user.click(dialog.getByRole('button', { name: 'buttons.confirm' }));
  expect(mockEmitter).toHaveBeenNthCalledWith(
    3,
    ['wallet', 'confirmUtxoReplacement'],
    ['review-id'],
    65_000,
    false
  );
  expect(
    await screen.findByText('transactions.utxoReplacement.unknown')
  ).toBeVisible();
  expect(screen.getByText(replacement)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'header.speedUp' })).toBeNull();
  await user.click(
    screen.getByRole('button', {
      name: 'transactions.utxoReplacement.checkStatus',
    })
  );
  expect(mockEmitter).toHaveBeenNthCalledWith(
    4,
    ['wallet', 'checkRetainedUtxoTransfer'],
    [replacement],
    15_000,
    false
  );
  expect(await screen.findByText('send.confirmed')).toBeVisible();
});
