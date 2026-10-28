/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import React from 'react';

import PrivacyServiceSettings from './PrivacyServiceSettings';

const mockEmitter = jest.fn();
const mockTranslate = (key: string, values?: { origin?: string }) =>
  values?.origin ? `${key}:${values.origin}` : key;
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

test('stale concurrent save refreshes only the baseline, preserves the draft, and retries with the new baseline', async () => {
  let current = 'http://127.0.0.1:8801';
  mockEmitter.mockImplementation(
    async ([, method]: string[], args: string[]) => {
      if (method === 'getServiceOrigin') return current;
      if (args[1] !== current) throw new Error('privacy_service_changed');
      current = args[0];
      return current;
    }
  );
  const first = render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  const second = render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  const a = within(first.container),
    b = within(second.container);
  fireEvent.click(a.getByText('privacy.serviceSettings'));
  fireEvent.click(b.getByText('privacy.serviceSettings'));
  await waitFor(() =>
    expect(first.container.querySelector('input')).not.toBeNull()
  );
  await waitFor(() =>
    expect(second.container.querySelector('input')).not.toBeNull()
  );
  const aInput = first.container.querySelector('input')!;
  const bInput = second.container.querySelector('input')!;
  await waitFor(() => expect(aInput).toHaveValue(current));
  await waitFor(() => expect(bInput).toHaveValue(current));
  fireEvent.change(bInput, { target: { value: 'http://127.0.0.1:8802' } });
  fireEvent.click(b.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(current).toBe('http://127.0.0.1:8802'));
  fireEvent.change(aInput, { target: { value: 'http://127.0.0.1:8803' } });
  fireEvent.click(a.getByRole('button', { name: 'buttons.save' }));
  expect(await a.findByRole('alert')).toHaveTextContent(
    'privacy.serviceConflict'
  );
  expect(a.getByRole('alert')).toHaveTextContent('http://127.0.0.1:8802');
  expect(aInput).toHaveValue('http://127.0.0.1:8803');
  expect(current).toBe('http://127.0.0.1:8802');
  await waitFor(() =>
    expect(a.getByRole('button', { name: 'buttons.save' })).toBeEnabled()
  );
  // A third editor changes the setting after conflict refresh: the retry must
  // not overwrite it, and must disclose that newer value before another save.
  current = 'http://127.0.0.1:8804';
  fireEvent.click(a.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(a.getByRole('alert')).toHaveTextContent('http://127.0.0.1:8804')
  );
  expect(aInput).toHaveValue('http://127.0.0.1:8803');
  expect(current).toBe('http://127.0.0.1:8804');
  await waitFor(() =>
    expect(a.getByRole('button', { name: 'buttons.save' })).toBeEnabled()
  );
  fireEvent.click(a.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(current).toBe('http://127.0.0.1:8803'));
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privacySettings', 'setServiceOrigin'],
    ['http://127.0.0.1:8803', 'http://127.0.0.1:8804'],
    30000,
    false
  );
});

test('ambiguous timeout does not refresh the comparison baseline or retry a write automatically', async () => {
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getServiceOrigin') return 'http://127.0.0.1:8801';
    throw new Error('Network request timed out');
  });
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('http://127.0.0.1:8801'));
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8803' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'privacy.serviceSaveFailed'
  );
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'getServiceOrigin'
    )
  ).toHaveLength(1);
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(1);
});

test('choosing the acknowledged current origin clears the conflict without a write', async () => {
  let current = 'http://127.0.0.1:8801';
  mockEmitter.mockImplementation(
    async ([, method]: string[], args: string[]) => {
      if (method === 'getServiceOrigin') return current;
      if (args[1] !== current) throw new Error('privacy_service_changed');
      current = args[0];
      return current;
    }
  );
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue(current));
  current = 'http://127.0.0.1:8802';
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8803' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'http://127.0.0.1:8802'
  );
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8802' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(1);
  expect(current).toBe('http://127.0.0.1:8802');
});

test.each(['save failure', 'conflict refresh failure'] as const)(
  'retires an old conflict disclosure on a new %s',
  async (failure) => {
    let current = 'http://127.0.0.1:8801';
    let nextFailure = false;
    mockEmitter.mockImplementation(
      async ([, method]: string[], args: string[]) => {
        if (method === 'getServiceOrigin') {
          if (nextFailure && failure === 'conflict refresh failure')
            throw new Error('read unavailable');
          return current;
        }
        if (nextFailure && failure === 'save failure')
          throw new Error('Network request timed out');
        if (args[1] !== current || nextFailure)
          throw new Error('privacy_service_changed');
        current = args[0];
        return current;
      }
    );
    render(<PrivacyServiceSettings onSettled={jest.fn()} />);
    fireEvent.click(screen.getByText('privacy.serviceSettings'));
    const input = await screen.findByLabelText('privacy.serviceOrigin');
    await waitFor(() => expect(input).toHaveValue(current));
    current = 'http://127.0.0.1:8802';
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:8803' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'http://127.0.0.1:8802'
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled()
    );
    nextFailure = true;
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'privacy.serviceSaveFailed'
      )
    );
    expect(input).toHaveValue('http://127.0.0.1:8803');
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:8804' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(current).toBe('http://127.0.0.1:8802');
  }
);

test('all nine locales provide a conflict message with the current-origin placeholder', () => {
  for (const locale of ['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const content = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../../assets/locales', `${locale}.json`),
        'utf8'
      )
    );
    expect(content.privacy.serviceConflict).toEqual(
      expect.stringContaining('{{origin}}')
    );
  }
});

test('a conflict refresh matching the proposed origin reports the current state without a second write', async () => {
  let reads = 0;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getServiceOrigin')
      return ++reads === 1 ? 'http://127.0.0.1:8801' : 'http://127.0.0.1:8803';
    throw new Error('privacy_service_changed');
  });
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('http://127.0.0.1:8801'));
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8803' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'privacy.serviceSaved'
  );
  expect(input).toHaveValue('http://127.0.0.1:8803');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(1);
  expect(reads).toBe(2);
});

test('unmount during conflict refresh does not write again or notify the removed view', async () => {
  let release!: (value: string) => void;
  let reads = 0;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getServiceOrigin') {
      if (++reads === 1) return 'http://127.0.0.1:8801';
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    }
    throw new Error('privacy_service_changed');
  });
  const onSettled = jest.fn();
  const view = render(<PrivacyServiceSettings onSettled={onSettled} />);
  fireEvent.click(screen.getByText('privacy.serviceSettings'));
  const input = await screen.findByLabelText('privacy.serviceOrigin');
  await waitFor(() => expect(input).toHaveValue('http://127.0.0.1:8801'));
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:8803' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(reads).toBe(2));
  view.unmount();
  await act(async () => {
    release('http://127.0.0.1:8802');
    await Promise.resolve();
  });
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'setServiceOrigin'
    )
  ).toHaveLength(1);
  expect(onSettled).not.toHaveBeenCalled();
});
