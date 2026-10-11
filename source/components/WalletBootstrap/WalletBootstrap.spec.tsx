/** @jest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';

import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import {
  requestWalletState,
  WALLET_BOOTSTRAP_TIMEOUT_MS,
  WALLET_RECOVERY_REQUIRED,
} from 'utils/requestWalletState';

import { WalletBootstrap } from './WalletBootstrap';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('state/rehydrate', () => ({ rehydrateStore: jest.fn() }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { name: 'wallet-test-store' },
}));
jest.mock('utils/requestWalletState', () => ({
  ...jest.requireActual('utils/requestWalletState'),
  requestWalletState: jest.fn(),
  startupFeedbackDelay: () => 1800,
}));

describe('authoritative wallet bootstrap recovery boundary', () => {
  const originalChrome = global.chrome;
  const state = { vault: { isUnlocked: true }, vaultGlobal: {} };
  const childMounted = jest.fn();
  let sendMessage: jest.Mock;
  const ProtectedChild = () => {
    childMounted();
    return <button type="button">Sign transaction</button>;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(requestWalletState).mockReset();
    jest.mocked(rehydrateStore).mockReset().mockResolvedValue(undefined);
    childMounted.mockClear();
    sendMessage = jest.fn((_message, callback) => callback?.());
    global.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    global.chrome = originalChrome;
  });

  it('keeps protected children unavailable with localized restart guidance when recovery is required', async () => {
    jest
      .mocked(requestWalletState)
      .mockRejectedValueOnce(new Error(WALLET_RECOVERY_REQUIRED));
    await act(async () => {
      render(
        <WalletBootstrap>
          <ProtectedChild />
        </WalletBootstrap>
      );
    });

    expect(screen.getByRole('status').textContent).toBe(
      'settings.walletRecoveryRestartRequired'
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(childMounted).not.toHaveBeenCalled();
    expect(rehydrateStore).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(WALLET_BOOTSTRAP_TIMEOUT_MS * 2);
    });
    expect(screen.getByRole('status').textContent).toBe(
      'settings.walletRecoveryRestartRequired'
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(childMounted).not.toHaveBeenCalled();
    expect(requestWalletState).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows protected children only after a healthy authoritative state has hydrated', async () => {
    let finishState!: (value: typeof state) => void;
    jest.mocked(requestWalletState).mockReturnValueOnce(
      new Promise((resolve) => {
        finishState = resolve;
      })
    );
    render(
      <WalletBootstrap>
        <ProtectedChild />
      </WalletBootstrap>
    );

    expect(screen.getByRole('status').textContent).toBe(
      'Connecting to your wallet…'
    );
    expect(childMounted).not.toHaveBeenCalled();
    await act(async () => {
      finishState(state);
    });

    expect(rehydrateStore).toHaveBeenCalledTimes(1);
    expect(rehydrateStore).toHaveBeenCalledWith(store, state);
    expect(
      screen.getByRole('button', { name: 'Sign transaction' })
    ).toBeTruthy();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      { type: 'startPolling' },
      expect.any(Function)
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retains user-controlled connection retry for an ordinary startup failure', async () => {
    jest
      .mocked(requestWalletState)
      .mockRejectedValueOnce(new Error('Worker unavailable'))
      .mockResolvedValueOnce(state);
    await act(async () => {
      render(
        <WalletBootstrap>
          <ProtectedChild />
        </WalletBootstrap>
      );
    });

    expect(childMounted).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
    });
    expect(requestWalletState).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: 'Sign transaction' })
    ).toBeTruthy();
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      {
        type: 'CONTROLLER_ACTION',
        data: { methods: ['retryInitialization'], params: [] },
      },
      expect.any(Function)
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      { type: 'startPolling' },
      expect.any(Function)
    );
  });
});
