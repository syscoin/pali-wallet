/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import en from 'assets/locales/en.json';
import PrivateVaultCapacitySettings from './PrivateVaultCapacitySettings';

const mockTranslate = (key: string, params: any = {}) =>
  String(
    key.split('.').reduce((value: any, part: string) => value?.[part], en) ||
      key
  ).replace(/{{(\w+)}}/g, (_, name) => String(params[name]));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

it('displays the default count, opt-in size tradeoffs, and saves an explicit higher tier', async () => {
  const emitter = jest.fn(async ([, method], values) =>
    method === 'getCapacity'
      ? {
          capacity: 128,
          noteCount: 4,
          storedBytes: 1234,
          bundleLimitBytes: 4 * 1024 * 1024,
        }
      : {
          capacity: values[0],
          noteCount: 4,
          storedBytes: 1234,
          bundleLimitBytes: 8 * 1024 * 1024,
        }
  );
  render(<PrivateVaultCapacitySettings controllerEmitter={emitter} />);
  expect(await screen.findByText('Saved notes: 4 / 128')).toBeVisible();
  expect(screen.getByText(en.privacy.capacity.compatibility)).toBeVisible();
  expect(emitter).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText(en.privacy.capacity.label), {
    target: { value: '256' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.save })
  );
  expect(await screen.findByText('Saved notes: 4 / 256')).toBeVisible();
  expect(emitter).toHaveBeenCalledWith(
    ['privateVault', 'setCapacity'],
    [256],
    30000,
    false
  );
});

it('reports a rejected downgrade without claiming the setting changed', async () => {
  const emitter = jest.fn(async ([, method]) => {
    if (method === 'getCapacity')
      return {
        capacity: 256,
        noteCount: 200,
        storedBytes: 1234,
        bundleLimitBytes: 8 * 1024 * 1024,
      };
    throw new Error('privacy_note_limit');
  });
  render(<PrivateVaultCapacitySettings controllerEmitter={emitter} />);
  expect(await screen.findByText('Saved notes: 200 / 256')).toBeVisible();
  fireEvent.change(screen.getByLabelText(en.privacy.capacity.label), {
    target: { value: '128' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.save })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.capacity.error
  );
  expect(screen.getByText('Saved notes: 200 / 256')).toBeVisible();
});

it('offers retry after an initial capacity read failure', async () => {
  const emitter = jest
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({
      capacity: 128,
      noteCount: 2,
      bundleLimitBytes: 4 * 1024 * 1024,
      storedBytes: 4321,
    });
  render(<PrivateVaultCapacitySettings controllerEmitter={emitter} />);
  expect(screen.getByRole('status')).toHaveTextContent(en.privacy.checking);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.capacity.loadError
  );
  expect(screen.queryByText(en.privacy.capacity.error)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: en.privacy.retry }));
  expect(
    await screen.findByText('Serialized encrypted vault: 4321 bytes.')
  ).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  );
});
