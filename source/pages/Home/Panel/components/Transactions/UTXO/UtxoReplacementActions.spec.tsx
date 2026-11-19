/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { getWalletBrowserTabId } from 'pages/Send/hardwareSendDraft';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

import { UtxoReplacementActions } from './UtxoReplacementActions';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('pages/Send/hardwareSendDraft', () => ({
  getWalletBrowserTabId: jest.fn(),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));

const original = 'ab'.repeat(32);
const replacement = 'cd'.repeat(32);
const mockEmitter = jest.mocked(controllerEmitter);
const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});
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

  const dialog = within(
    await screen.findByRole('dialog', { name: 'header.cancelTx' })
  );
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(
    dialog.getByText('transactions.utxoReplacement.cancelDescription')
  ).toBeVisible();
  expect(dialog.getByText('send.networkFee')).toBeVisible();
  expect(dialog.getByText('0.000015 SYS')).toBeVisible();
  expect(dialog.getByText(original)).not.toBeVisible();
  expect(dialog.getByText('wallet-output')).not.toBeVisible();
  await user.click(dialog.getByText('send.details'));
  expect(dialog.getByText(original)).toBeVisible();
  expect(dialog.getByText('0.00001 SYS')).toBeVisible();
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

it('shows the exact Speed Up fee before confirmation and discards an abandoned review', async () => {
  const user = userEvent.setup();
  mockEmitter
    .mockResolvedValueOnce({ speedUp: true })
    .mockResolvedValueOnce({
      kind: 'speed-up',
      id: 'review-id',
      validForMs: 90_000,
      previousFeeSatoshis: '1000',
      feeSatoshis: '2049',
      outputs: [{ address: 'recipient-output', amountSatoshis: '75000' }],
    })
    .mockResolvedValueOnce(undefined);

  render(<UtxoReplacementActions txid={original} currency="SYS" />);
  await user.click(
    await screen.findByRole('button', { name: 'header.speedUp' })
  );
  const dialog = within(
    await screen.findByRole('dialog', { name: 'header.speedUp' })
  );
  expect(
    dialog.getByText('transactions.utxoReplacement.speedUpDescription')
  ).toBeVisible();
  expect(dialog.getByText('0.00002049 SYS')).toBeVisible();
  expect(dialog.getByText('recipient-output')).not.toBeVisible();
  await user.click(dialog.getByRole('button', { name: 'buttons.cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockEmitter.mock.calls.map(([method]) => method[1])).toEqual([
    'getUtxoReplacementActions',
    'prepareUtxoReplacement',
    'discardUtxoReplacement',
  ]);
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'discardUtxoReplacement'],
    ['review-id'],
    10_000,
    false
  );
});

it('opens a hardware transaction in a standalone wallet tab without preparing or signing', async () => {
  const user = userEvent.setup();
  jest.mocked(getWalletBrowserTabId).mockResolvedValueOnce(undefined);
  mockEmitter.mockResolvedValueOnce({
    cancel: true,
    speedUp: true,
    hardware: true,
  });
  const create = jest.fn((_options, callback: (tab: { id: number }) => void) =>
    callback({ id: 7 })
  );
  const previous = globalThis.chrome;
  globalThis.chrome = {
    ...previous,
    runtime: {
      ...previous.runtime,
      getURL: (path) => `chrome-extension://pali-extension/${path}`,
    },
    tabs: { ...previous.tabs, create },
  } as unknown as typeof chrome;
  try {
    render(<UtxoReplacementActions txid={original} currency="SYS" />);
    await user.click(
      await screen.findByRole('button', { name: 'send.openWalletTab' })
    );
    expect(create).toHaveBeenCalledWith(
      {
        url: `chrome-extension://pali-extension/app.html#/home/details?utxoTxid=${original}`,
      },
      expect.any(Function)
    );
    expect(mockEmitter.mock.calls.map(([method]) => method[1])).toEqual([
      'getUtxoReplacementActions',
    ]);
  } finally {
    globalThis.chrome = previous;
  }
});
