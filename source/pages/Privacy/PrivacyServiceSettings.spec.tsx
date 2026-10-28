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

test('a failed initial load keeps the editor disabled and retries before any save', async () => {
  let reads = 0;
  mockEmitter.mockImplementation(
    async ([, method]: string[], args: string[]) => {
      if (method === 'getServiceOrigin') {
        if (++reads === 1) throw new Error('synthetic read failure');
        return 'https://sysnode.info';
      }
      return args[0];
    }
  );
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'privacy.serviceLoadFailed'
  );
  const input = screen.getByLabelText('privacy.serviceOrigin');
  expect(input).toBeDisabled();
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'privacy.retry' }));
  await waitFor(() => expect(input).toHaveValue('https://sysnode.info'));
  await waitFor(() => expect(input).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(0);
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8800' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['privacySettings', 'setServiceOrigin'],
      ['http://127.0.0.1:8800', 'https://sysnode.info'],
      30000,
      false
    )
  );
});

test('a reopen read failure exposes Retry even with a previously loaded baseline', async () => {
  let reads = 0;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method !== 'getServiceOrigin') throw new Error('unexpected write');
    if (++reads === 1) return 'https://sysnode.info';
    if (reads === 2) throw new Error('synthetic read failure');
    return 'http://127.0.0.1:8802';
  });
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  const summary = screen.getByText('privacy.serviceSettings');
  fireEvent.click(summary);
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('https://sysnode.info'));
  fireEvent.click(summary);
  await waitFor(() =>
    expect(
      screen.queryByLabelText('privacy.serviceOrigin')
    ).not.toBeInTheDocument()
  );
  fireEvent.click(summary);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'privacy.serviceLoadFailed'
  );
  expect(screen.getByLabelText('privacy.serviceOrigin')).toHaveValue(
    'https://sysnode.info'
  );
  expect(screen.getByLabelText('privacy.serviceOrigin')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'privacy.retry' }));
  await waitFor(() =>
    expect(screen.getByLabelText('privacy.serviceOrigin')).toHaveValue(
      'http://127.0.0.1:8802'
    )
  );
  await waitFor(() =>
    expect(screen.getByLabelText('privacy.serviceOrigin')).toBeEnabled()
  );
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(0);
});

test('a reopened read failure clears the prior save success', async () => {
  let reads = 0;
  mockEmitter.mockImplementation(
    async ([, method]: string[], args: string[]) => {
      if (method === 'getServiceOrigin') {
        if (++reads === 1) return 'https://sysnode.info';
        throw new Error('synthetic read failure');
      }
      return args[0];
    }
  );
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  const summary = screen.getByText('privacy.serviceSettings');
  fireEvent.click(summary);
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8800' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'privacy.serviceSaved'
  );
  fireEvent.click(summary);
  await waitFor(() =>
    expect(
      screen.queryByLabelText('privacy.serviceOrigin')
    ).not.toBeInTheDocument()
  );
  fireEvent.click(summary);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'privacy.serviceLoadFailed'
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('privacy.serviceOrigin')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'privacy.retry' })).toBeEnabled();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(1);
});

test('a stale read from a closed panel cannot replace the reopened baseline', async () => {
  let finish!: (value: string) => void;
  let reads = 0;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method !== 'getServiceOrigin') throw new Error('unexpected write');
    if (++reads === 1)
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    return 'http://127.0.0.1:8802';
  });
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  const summary = screen.getByText('privacy.serviceSettings');
  fireEvent.click(summary);
  await waitFor(() => expect(reads).toBe(1));
  fireEvent.click(summary);
  await waitFor(() =>
    expect(
      screen.queryByLabelText('privacy.serviceOrigin')
    ).not.toBeInTheDocument()
  );
  fireEvent.click(summary);
  await waitFor(() =>
    expect(screen.getByLabelText('privacy.serviceOrigin')).toHaveValue(
      'http://127.0.0.1:8802'
    )
  );
  await act(async () => finish('http://127.0.0.1:8801'));
  expect(screen.getByLabelText('privacy.serviceOrigin')).toHaveValue(
    'http://127.0.0.1:8802'
  );
  expect(screen.getByLabelText('privacy.serviceOrigin')).toBeEnabled();
});

test('a pending read disables editing and saving until the current baseline arrives', async () => {
  let finish!: (value: string) => void;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getServiceOrigin')
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    throw new Error('unexpected write');
  });
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(finish).toBeDefined());
  expect(input).toBeDisabled();
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  finish('https://sysnode.info');
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue('https://sysnode.info');
});

test('closing and reopening while a save is pending does not start a competing read', async () => {
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
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8800' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(summary);
  await waitFor(() =>
    expect(
      screen.queryByLabelText('privacy.serviceOrigin')
    ).not.toBeInTheDocument()
  );
  fireEvent.click(summary);
  const reopened = await screen.findByLabelText('privacy.serviceOrigin');
  expect(reopened).toBeDisabled();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'getServiceOrigin'
    )
  ).toHaveLength(1);
  finish('http://127.0.0.1:8800');
  await waitFor(() => expect(reopened).toHaveValue('http://127.0.0.1:8800'));
  await waitFor(() => expect(reopened).toBeEnabled());
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(1);
});

test('a failed pending save after reopening remains explicit and retryable', async () => {
  let fail!: (reason: Error) => void;
  let writes = 0;
  mockEmitter.mockImplementation(
    async ([, method]: string[], args: string[]) => {
      if (method === 'getServiceOrigin') return 'https://sysnode.info';
      if (++writes === 1)
        return new Promise<string>((_resolve, reject) => {
          fail = reject;
        });
      return args[0];
    }
  );
  const onSettled = jest.fn();
  render(<PrivacyServiceSettings onSettled={onSettled} />);
  const summary = screen.getByText('privacy.serviceSettings');
  fireEvent.click(summary);
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8800' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(fail).toBeDefined());
  fireEvent.click(summary);
  await waitFor(() =>
    expect(
      screen.queryByLabelText('privacy.serviceOrigin')
    ).not.toBeInTheDocument()
  );
  fireEvent.click(summary);
  expect(await screen.findByLabelText('privacy.serviceOrigin')).toBeDisabled();
  await act(async () => fail(new Error('synthetic timeout')));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'privacy.serviceSaveFailed'
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('privacy.serviceOrigin')).toHaveValue(
    'http://127.0.0.1:8800'
  );
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(writes).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'privacy.serviceSaved'
  );
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privacySettings', 'setServiceOrigin'],
    ['http://127.0.0.1:8800', 'https://sysnode.info'],
    30000,
    false
  );
  expect(writes).toBe(2);
});
