/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import en from 'assets/locales/en.json';
import PrivateVaultClearCompleted from './PrivateVaultClearCompleted';

const mockTranslate = (key: string, params: any = {}) =>
  String(
    key.split('.').reduce((value: any, part: string) => value?.[part], en) ||
      key
  ).replace(/{{(\w+)}}/g, (_, name) => String(params[name]));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

it('asks before verification, uses bounded batches, and reports unresolved records', async () => {
  const ids = Array.from(
    { length: 17 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
  );
  const emit = jest.fn(async (_path, [batch]) =>
    batch[0] === ids[0]
      ? { removed: [], unresolved: batch }
      : { removed: batch, unresolved: [] }
  );
  const done = jest.fn();
  render(
    <PrivateVaultClearCompleted
      controllerEmitter={emit}
      noteIds={ids}
      onComplete={done}
      onRemoved={jest.fn()}
    />
  );
  expect(emit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.clear })
  );
  expect(screen.getByText(en.privacy.capacity.clearHelp)).toBeVisible();
  expect(emit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.confirmClear })
  );
  expect(await screen.findByText('Removed: 16. Still saved: 1.')).toBeVisible();
  expect(emit).toHaveBeenCalledTimes(17);
  expect(emit.mock.calls[0][1][0]).toHaveLength(1);
  expect(emit.mock.calls[1][1][0]).toHaveLength(1);
  expect(done).toHaveBeenCalledTimes(1);
});

it('fails closed on malformed results and refreshes after a partial operation', async () => {
  const emit = jest.fn(async () => ({ removed: ['unknown'], unresolved: [] }));
  const done = jest.fn();
  render(
    <PrivateVaultClearCompleted
      controllerEmitter={emit}
      noteIds={['00000000-0000-4000-8000-000000000001']}
      onComplete={done}
      onRemoved={jest.fn()}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.clear })
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.confirmClear })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.capacity.clearError
  );
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});

it('reports a committed in-flight removal after unmount without starting the next record', async () => {
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ];
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const emit = jest.fn(() => pending);
  const removed = jest.fn();
  const view = render(
    <PrivateVaultClearCompleted
      controllerEmitter={emit}
      noteIds={ids}
      onComplete={jest.fn()}
      onRemoved={removed}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.clear })
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.confirmClear })
  );
  expect(emit).toHaveBeenCalledTimes(1);
  view.unmount();
  finish({ removed: [ids[0]], unresolved: [] });
  await waitFor(() => expect(removed).toHaveBeenCalledWith([ids[0]]));
  expect(emit).toHaveBeenCalledTimes(1);
});
