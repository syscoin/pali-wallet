/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { LocalPasskeyUnlock } from '../../components/Start/LocalPasskeyUnlock';
import {
  localPasskeySupport,
  runLocalPasskeyCeremony,
} from '../../utils/passkey/localUnlockCeremony';
import {
  PasswordCooldownError,
  type LocalPasskeyController,
  type LocalPasskeyStep,
} from '../../wallet/localPasskeyTypes';

import { LocalPasskeySettings } from './LocalPasskeySettings';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: { retryTime: string }) =>
      options ? `${key}: ${options.retryTime}` : key,
  }),
}));
jest.mock('../../utils/localPasskeyController', () => ({
  createLocalPasskeyController: jest.fn(),
}));
jest.mock('../../utils/passkey/localUnlockCeremony', () => ({
  localPasskeySupport: jest.fn(),
  runLocalPasskeyCeremony: jest.fn(),
}));
jest.mock('../../components', () => ({
  Button: ({ children, disabled, loading, onClick, type }: any) => (
    <button onClick={onClick} type={type} disabled={disabled || loading}>
      {children}
    </button>
  ),
  PageActionFooter: ({ children, error }: any) => (
    <footer>
      {error && <p role="alert">{error}</p>}
      {children}
    </footer>
  ),
}));
jest.mock('../../components/Button', () => ({
  Button: ({ children, disabled, loading, onClick, type }: any) => (
    <button onClick={onClick} type={type} disabled={disabled || loading}>
      {children}
    </button>
  ),
}));
jest.mock('antd', () => ({
  Input: {
    Password: ({ onChange, ...props }: any) => (
      <input type="password" onChange={onChange} {...props} />
    ),
  },
}));
const id = 'a'.repeat(32);
const controller = (enabled = false): jest.Mocked<LocalPasskeyController> => ({
  status: jest.fn().mockResolvedValue({ enabled }),
  beginEnrollment: jest.fn(),
  beginUnlock: jest.fn(),
  complete: jest.fn(),
  disable: jest.fn().mockResolvedValue(undefined),
  cancel: jest.fn().mockResolvedValue(undefined),
  dispose: jest.fn().mockResolvedValue(undefined),
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(localPasskeySupport).mockResolvedValue('supported');
});

it('hides unsupported setup and unlock, retaining the ordinary password alternative', async () => {
  jest.mocked(localPasskeySupport).mockResolvedValue('unsupported');
  const source = controller();
  render(
    <>
      <LocalPasskeySettings createController={() => source} />
      <LocalPasskeyUnlock
        createController={() => controller(true)}
        onUnlocked={jest.fn()}
      />
      <input aria-label="Ordinary password" />
    </>
  );
  await screen.findByText('localPasskey.unsupported');
  expect(
    screen.queryByRole('button', { name: 'localPasskey.setUp' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'localPasskey.unlock' })
  ).toBeNull();
  expect(screen.getByLabelText('Ordinary password')).toBeTruthy();
});

it('clears the password on submission, blocks double submission, and allows disabling on unsupported browsers', async () => {
  jest.mocked(localPasskeySupport).mockResolvedValue('unsupported');
  const source = controller(true);
  let resolve!: () => void;
  source.disable.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render(<LocalPasskeySettings createController={() => source} />);
  const input = await screen.findByLabelText('localPasskey.password');
  fireEvent.change(input, { target: { value: 'current-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'localPasskey.turnOff' }));
  expect((input as HTMLInputElement).value).toBe('');
  fireEvent.submit(input.closest('form')!);
  expect(source.disable).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(await screen.findByText('localPasskey.disabled')).toBeTruthy();
});

it('keeps fallback available after complete=false and never reports successful unlock', async () => {
  const source = controller(true),
    done = jest.fn();
  source.beginUnlock.mockResolvedValue({
    kind: 'complete',
    operationId: id,
    success: false,
  });
  render(
    <LocalPasskeyUnlock createController={() => source} onUnlocked={done} />
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'localPasskey.unlock' })
  );
  expect((await screen.findByRole('alert')).textContent).toBe(
    'localPasskey.unlockFailed'
  );
  expect(done).not.toHaveBeenCalled();
  expect(
    (
      screen.getByRole('button', {
        name: 'localPasskey.unlock',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
});

it('cancels before the first enrollment reply and does not launch a late browser prompt', async () => {
  const source = controller();
  let resolve!: (value: LocalPasskeyStep) => void;
  source.beginEnrollment.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render(<LocalPasskeySettings createController={() => source} />);
  fireEvent.change(await screen.findByLabelText('localPasskey.password'), {
    target: { value: 'password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'localPasskey.setUp' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'buttons.cancel' })
  );
  expect(source.cancel).toHaveBeenCalledWith(undefined);
  await act(async () =>
    resolve({
      kind: 'create',
      operationId: id,
      ceremonyId: id,
      challenge: 'challenge',
      prfSalt: 'salt',
      origin: `chrome-extension://${id}`,
      expiresAt: Date.now() + 60_000,
    })
  );
  await waitFor(() => expect(source.cancel).toHaveBeenCalledWith(id));
  expect(runLocalPasskeyCeremony).not.toHaveBeenCalled();
});

it.each([false, true])(
  'explains a password cooldown for passkey settings (enabled=%p)',
  async (enabled) => {
    const source = controller(enabled);
    const changePasskey = enabled ? source.disable : source.beginEnrollment;
    changePasskey.mockRejectedValueOnce(new PasswordCooldownError(73));
    render(<LocalPasskeySettings createController={() => source} />);

    fireEvent.change(await screen.findByLabelText('localPasskey.password'), {
      target: { value: 'wallet-password' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: enabled ? 'localPasskey.turnOff' : 'localPasskey.setUp',
      })
    );

    expect((await screen.findByRole('alert')).textContent).toBe(
      'start.unlockRateLimited: in 73 seconds'
    );
    expect(
      screen.getByText(
        enabled ? 'localPasskey.enabled' : 'localPasskey.disabled'
      )
    ).toBeTruthy();
    expect(changePasskey).toHaveBeenCalledTimes(1);
    expect(runLocalPasskeyCeremony).not.toHaveBeenCalled();
  }
);

it('clears the settings cooldown guidance when the wait expires', async () => {
  const source = controller(true);
  source.disable.mockRejectedValueOnce(new PasswordCooldownError(3));
  render(<LocalPasskeySettings createController={() => source} />);
  const password = await screen.findByLabelText('localPasskey.password');

  jest.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.change(password, { target: { value: 'wallet-password' } });
      fireEvent.click(
        screen.getByRole('button', { name: 'localPasskey.turnOff' })
      );
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'start.unlockRateLimited: in 3 seconds'
    );
    act(() => jest.advanceTimersByTime(2999));
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(source.disable).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
