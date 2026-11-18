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
const mockClearError = jest.fn();
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: { error: mockClearError } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

const NOTE_ID = '00000000-0000-4000-8000-000000000001';

function ArchiveRow({
  controllerEmitter,
  onComplete = jest.fn(),
  onRemoved = jest.fn(),
}: Pick<
  React.ComponentProps<typeof PrivateVaultClearCompleted>,
  'controllerEmitter'
> &
  Partial<
    Pick<
      React.ComponentProps<typeof PrivateVaultClearCompleted>,
      'onComplete' | 'onRemoved'
    >
  >) {
  const [confirming, setConfirming] = React.useState(false);
  return (
    <PrivateVaultClearCompleted
      confirming={confirming}
      controllerEmitter={controllerEmitter}
      noteId={NOTE_ID}
      onCancel={() => setConfirming(false)}
      onSelect={() => setConfirming(true)}
      onComplete={onComplete}
      onRemoved={onRemoved}
    />
  );
}

it('asks before checking the selected note and reports an unresolved withdrawal', async () => {
  const emit = jest.fn(async () => ({ removed: [], unresolved: [NOTE_ID] }));
  const done = jest.fn();
  render(<ArchiveRow controllerEmitter={emit} onComplete={done} />);
  expect(emit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.clear })
  );
  expect(screen.getByText(en.privacy.capacity.clearHelp)).toBeVisible();
  expect(emit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.confirmClear })
  );
  expect(
    await screen.findByText('Archived: 0. Still active: 1.')
  ).toBeVisible();
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith(
    ['privateVault', 'clearCompletedNotes'],
    [[NOTE_ID]],
    120000,
    false
  );
  expect(done).toHaveBeenCalledTimes(1);
});

it('rejects a response for a different note and refreshes after the error', async () => {
  const emit = jest.fn(async () => ({ removed: ['unknown'], unresolved: [] }));
  const done = jest.fn();
  const removed = jest.fn();
  render(
    <ArchiveRow
      controllerEmitter={emit}
      onComplete={done}
      onRemoved={removed}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.clear })
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.confirmClear })
  );
  await waitFor(() =>
    expect(mockClearError).toHaveBeenCalledWith(en.privacy.capacity.clearError)
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(removed).not.toHaveBeenCalled();
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});

it('reports a committed in-flight removal after the selected row unmounts', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const emit = jest.fn(() => pending);
  const removed = jest.fn();
  const view = render(
    <ArchiveRow controllerEmitter={emit} onRemoved={removed} />
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.clear })
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.capacity.confirmClear })
  );
  expect(emit).toHaveBeenCalledTimes(1);
  view.unmount();
  finish({ removed: [NOTE_ID], unresolved: [] });
  await waitFor(() => expect(removed).toHaveBeenCalledWith(NOTE_ID));
  expect(emit).toHaveBeenCalledTimes(1);
});
