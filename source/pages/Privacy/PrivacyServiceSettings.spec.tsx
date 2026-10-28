/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import PrivacyServiceSettings from './PrivacyServiceSettings';

const mockEmitter = jest.fn();
const mockTranslate = (key: string) => key;
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('components/Button', () => ({
  Button: ({ children, fullWidth, loading, variant, ...props }: any) => (
    <button
      {...props}
      data-full-width={fullWidth}
      data-variant={variant}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  ),
}));

beforeEach(() => {
  mockEmitter.mockReset();
  mockEmitter.mockImplementation(async ([, method]: string[], args: string[]) =>
    method === 'getServiceOrigin' ? 'https://sysnode.info' : args[0]
  );
});

test('loads and saves a local service origin through the trusted controller', async () => {
  const onSettled = jest.fn();
  render(<PrivacyServiceSettings onSettled={onSettled} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('https://sysnode.info'));
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8800/' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacySettings', 'setServiceOrigin'],
    ['http://127.0.0.1:8800', 'https://sysnode.info'],
    30000,
    false
  );
  expect(screen.getByRole('status')).toHaveTextContent('privacy.serviceSaved');
});

test('invalid remote HTTP origins receive an explanation and are not saved', async () => {
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('https://sysnode.info'));
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'http://remote.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(screen.getByRole('alert')).toHaveTextContent('privacy.serviceInvalid');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(0);
});

test('an equivalent origin is normalized without clearing pool data', async () => {
  const onSettled = jest.fn();
  render(<PrivacyServiceSettings onSettled={onSettled} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'https://sysnode.info/' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(input).toHaveValue('https://sysnode.info');
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  expect(onSettled).not.toHaveBeenCalled();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(0);
});

test('failed saves remain retryable and do not report success', async () => {
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getServiceOrigin') return 'https://sysnode.info';
    throw new Error('storage');
  });
  const onSettled = jest.fn();
  render(<PrivacyServiceSettings onSettled={onSettled} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('https://sysnode.info'));
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'http://localhost:8800' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'privacy.serviceSaveFailed'
  );
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  expect(onSettled).toHaveBeenCalledTimes(1);
});

test('a failed settings read offers a retry', async () => {
  mockEmitter
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce('http://localhost:8800');
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'privacy.serviceLoadFailed'
  );
  fireEvent.click(screen.getByRole('button', { name: 'privacy.retry' }));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('http://localhost:8800'));
  expect(input).toBeEnabled();
});

test('closing the panel during a save does not discard its confirmed update', async () => {
  let finish!: (value: string) => void;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getServiceOrigin') return 'https://sysnode.info';
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const onSettled = jest.fn();
  render(<PrivacyServiceSettings onSettled={onSettled} />);
  const summary = screen.getByText('privacy.serviceSettings');
  fireEvent.click(summary);
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('https://sysnode.info'));
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'http://localhost:8800' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  fireEvent.click(summary);
  finish('http://localhost:8800');
  await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
});
