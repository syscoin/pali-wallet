/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import en from 'assets/locales/en.json';

import PrivateWithdrawalRecovery from './PrivateWithdrawalRecovery';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key.split('.').reduce((v: any, k) => v[k], en),
  }),
}));
const copy = en.privacy.recovery;
it('requires explicit disclosure and fresh password, never automatically retries an uncertain result', async () => {
  const controller = jest.fn(async () => {
      throw new Error('unknown');
    }),
    refresh = jest.fn();
  render(
    <PrivateWithdrawalRecovery
      id="note"
      controllerEmitter={controller}
      onRecovered={refresh}
    />
  );
  expect(controller).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: copy.action }));
  expect(screen.getByText(copy.disclosure)).toBeVisible();
  fireEvent.change(screen.getByLabelText(copy.password), {
    target: { value: 'password' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirm }));
  await screen.findByRole('alert');
  expect(controller).toHaveBeenCalledWith(
    ['privateVault', 'recoverFailedWithdrawal'],
    ['note', 'password'],
    120000,
    false
  );
  expect(controller).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(copy.password)).toHaveValue('');
});
it('discards late results after leaving the note view', async () => {
  let finish!: () => void;
  const controller = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    ),
    refresh = jest.fn();
  const view = render(
    <PrivateWithdrawalRecovery
      id="note"
      controllerEmitter={controller}
      onRecovered={refresh}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: copy.action }));
  fireEvent.change(screen.getByLabelText(copy.password), {
    target: { value: 'password' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirm }));
  await waitFor(() => expect(controller).toHaveBeenCalledTimes(1));
  view.unmount();
  finish();
  await Promise.resolve();
  expect(refresh).not.toHaveBeenCalled();
});
