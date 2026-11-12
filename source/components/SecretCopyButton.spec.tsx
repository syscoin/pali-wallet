/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { SecretCopyButton } from './SecretCopyButton';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('./Icon/Icon', () => ({ FiCopy: () => <svg aria-hidden="true" /> }));
const write = jest.fn();
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);
beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: write },
  });
});
afterAll(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});

test('copy requires the current disclosure, warns inline and reports actual success', async () => {
  let current = false;
  render(
    <SecretCopyButton
      secret="synthetic-key"
      isCurrent={() => current}
      label="Copy private key"
    />
  );
  expect(screen.getByText('secretClipboard.warning')).toBeVisible();
  fireEvent.click(screen.getByRole('button'));
  expect(write).not.toHaveBeenCalled();
  current = true;
  await act(async () => fireEvent.click(screen.getByRole('button')));
  expect(write).toHaveBeenCalledWith('synthetic-key');
  expect(screen.getByRole('status')).toHaveTextContent('components.copied');
});

test('failed writes are generic and pending writes cannot repeat or publish into a replacement', async () => {
  write.mockRejectedValueOnce(Error('synthetic-key internal detail'));
  const view = render(
    <SecretCopyButton
      secret="synthetic-key"
      isCurrent={() => true}
      label="Copy"
    />
  );
  await act(async () => fireEvent.click(screen.getByRole('button')));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'transactions.copyFailed'
  );
  expect(view.container).not.toHaveTextContent('internal detail');
  let release!: () => void;
  write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('button'));
  expect(write).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button')).toBeDisabled();
  view.rerender(
    <SecretCopyButton
      secret="replacement"
      isCurrent={() => true}
      label="Copy"
    />
  );
  await act(async () => release());
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button')).toBeEnabled();
});

test('a throwing authorization guard refuses dispatch and late feedback without unhandled rejection', async () => {
  let throws = true,
    release!: () => void;
  write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  render(
    <SecretCopyButton
      secret="synthetic-key"
      isCurrent={() => {
        if (throws) throw Error('retired');
        return true;
      }}
      label="Copy"
    />
  );
  fireEvent.click(screen.getByRole('button'));
  expect(write).not.toHaveBeenCalled();
  throws = false;
  fireEvent.click(screen.getByRole('button'));
  throws = true;
  await act(async () => release());
  expect(write).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('status')).toBeNull();
});
