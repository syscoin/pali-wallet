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

it('defers a count refresh during save and preserves an unsaved choice on a later refresh', async () => {
  let finishSave!: (value: unknown) => void;
  const saved = new Promise((resolve) => {
    finishSave = resolve;
  });
  const state = (capacity: 128 | 256 | 512, noteCount: number) => ({
    capacity,
    noteCount,
    storedBytes: noteCount * 100,
    bundleLimitBytes: (capacity / 128) * 4 * 1024 * 1024,
  });
  const emitter = jest
    .fn()
    .mockResolvedValueOnce(state(128, 2))
    .mockReturnValueOnce(saved)
    .mockResolvedValueOnce(state(256, 1))
    .mockResolvedValueOnce(state(256, 0));
  const { rerender } = render(
    <PrivateVaultCapacitySettings controllerEmitter={emitter} noteCount={2} />
  );
  expect(await screen.findByText('Saved notes: 2 / 128')).toBeVisible();
  const setting = screen.getByLabelText(en.privacy.capacity.label);
  fireEvent.change(setting, { target: { value: '256' } });
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.save })
  );
  expect(setting).toBeDisabled();
  rerender(
    <PrivateVaultCapacitySettings controllerEmitter={emitter} noteCount={1} />
  );
  expect(emitter).toHaveBeenCalledTimes(2);
  finishSave(state(256, 2));
  expect(await screen.findByText('Saved notes: 1 / 256')).toBeVisible();
  expect(emitter).toHaveBeenNthCalledWith(
    3,
    ['privateVault', 'getCapacity'],
    [],
    30000,
    false
  );
  expect(setting).toHaveValue('256');
  await waitFor(() => expect(setting).toBeEnabled());
  fireEvent.change(setting, { target: { value: '512' } });
  rerender(
    <PrivateVaultCapacitySettings controllerEmitter={emitter} noteCount={0} />
  );
  expect(await screen.findByText('Saved notes: 0 / 256')).toBeVisible();
  expect(setting).toHaveValue('512');
});

it('keeps a rejected save visible after passive refresh and retries a failed refresh', async () => {
  const state = (noteCount: number) => ({
    capacity: 256,
    noteCount,
    storedBytes: 100,
    bundleLimitBytes: 8 * 1024 * 1024,
  });
  const emitter = jest
    .fn()
    .mockResolvedValueOnce(state(2))
    .mockRejectedValueOnce(new Error('save refused'))
    .mockRejectedValueOnce(new Error('load unavailable'))
    .mockResolvedValueOnce(state(1));
  const { rerender } = render(
    <PrivateVaultCapacitySettings controllerEmitter={emitter} noteCount={2} />
  );
  expect(await screen.findByText('Saved notes: 2 / 256')).toBeVisible();
  const setting = screen.getByLabelText(en.privacy.capacity.label);
  fireEvent.change(setting, { target: { value: '128' } });
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.save })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.capacity.error
  );
  rerender(
    <PrivateVaultCapacitySettings controllerEmitter={emitter} noteCount={1} />
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      en.privacy.capacity.loadError
    )
  );
  fireEvent.click(screen.getByRole('button', { name: en.privacy.retry }));
  expect(await screen.findByText('Saved notes: 1 / 256')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(
    en.privacy.capacity.error
  );
  expect(setting).toHaveValue('128');
});
