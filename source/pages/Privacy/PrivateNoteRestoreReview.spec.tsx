/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import en from 'assets/locales/en.json';

import PrivateNoteRestoreReview from './PrivateNoteRestoreReview';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, any> = {}) => {
      const text = key.split('.').reduce((v: any, k) => v[k], en);
      return typeof text === 'string'
        ? text.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(values[name]))
        : text;
    },
  }),
}));
const copy = en.privacy.restoreReview;
const originalVisibility = Object.getOwnPropertyDescriptor(
  document,
  'visibilityState'
);
afterEach(() => {
  if (originalVisibility)
    Object.defineProperty(document, 'visibilityState', originalVisibility);
  else delete (document as any).visibilityState;
});

it('requires a fresh password and explains the saved-data and bearer limits before requesting review', async () => {
  const controller = jest.fn(async () => {
    throw new Error('unknown acknowledgement');
  });
  const refresh = jest.fn();
  render(
    <PrivateNoteRestoreReview
      id="note"
      blockNumber={123}
      controllerEmitter={controller}
      onReviewed={refresh}
    />
  );
  expect(controller).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: copy.action }));
  expect(screen.getByText(copy.disclosure)).toBeVisible();
  expect(
    screen.getByText(copy.snapshot.replace('{{block}}', '123'))
  ).toBeVisible();
  expect(screen.getByRole('button', { name: copy.confirm })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(copy.password), {
    target: { value: 'fresh-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirm }));
  await screen.findByRole('alert');
  expect(controller).toHaveBeenCalledWith(
    ['privateVault', 'reviewRestoredNote'],
    ['note', 'fresh-password'],
    120000,
    false
  );
  expect(controller).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(copy.password)).toHaveValue('');
  expect(screen.getByRole('button', { name: copy.confirm })).toBeDisabled();
});

it('clears the password on hide and discards a response from a dismissed review', async () => {
  let finish!: () => void;
  const controller = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const refresh = jest.fn();
  render(
    <PrivateNoteRestoreReview
      id="note"
      controllerEmitter={controller}
      onReviewed={refresh}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: copy.action }));
  expect(screen.getByText(copy.noSnapshot)).toBeVisible();
  fireEvent.change(screen.getByLabelText(copy.password), {
    target: { value: 'fresh-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirm }));
  await waitFor(() => expect(controller).toHaveBeenCalledTimes(1));
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.queryByLabelText(copy.password)).not.toBeInTheDocument();
  await act(async () => {
    finish();
  });
  expect(refresh).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  fireEvent(document, new Event('visibilitychange'));
  fireEvent.click(screen.getByRole('button', { name: copy.action }));
  expect(screen.getByLabelText(copy.password)).toHaveValue('');
});

it('does not publish a late response after the note view unmounts', async () => {
  let finish!: () => void;
  const controller = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const refresh = jest.fn();
  const view = render(
    <PrivateNoteRestoreReview
      id="note"
      controllerEmitter={controller}
      onReviewed={refresh}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: copy.action }));
  fireEvent.change(screen.getByLabelText(copy.password), {
    target: { value: 'fresh-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirm }));
  await waitFor(() => expect(controller).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => {
    finish();
  });
  expect(refresh).not.toHaveBeenCalled();
});
