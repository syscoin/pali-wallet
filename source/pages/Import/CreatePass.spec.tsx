/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  getControllerStatus,
  subscribeControllerStatus,
} from 'hooks/controllerStatus';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

import { CreatePasswordImport } from './CreatePass';

let mockSubmit: (values: { password: string }) => Promise<void>;
const mockNavigate = jest.fn();
const mockAlert = jest.fn();
const mockClear = jest.fn();
const mockReload = jest.fn();
let mockSecrets: { kind: string; phrase?: string; recoveryTicket?: string };
jest.mock('utils/reloadWalletForRecovery', () => ({
  reloadWalletForRecovery: () => mockReload(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, id, type }: any) => (
    <button id={id} type={type} onClick={onClick}>
      {children}
    </button>
  ),
  PasswordForm: ({ onSubmit }: any) => {
    mockSubmit = onSubmit;
    return (
      <button
        type="button"
        onClick={() => void onSubmit({ password: 'new recovery password' })}
      >
        Submit password
      </button>
    );
  },
}));
jest.mock('components/Layout/OnboardingLayout', () => ({
  OnboardingLayout: ({ title, children }: any) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}));
jest.mock('react-router-dom', () => ({
  Navigate: () => null,
}));
jest.mock('hooks/useOnboardingSecrets', () => ({
  useOnboardingSecrets: () => ({
    secrets: mockSecrets,
    clear: mockClear,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: { error: mockAlert } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));

describe('new wallet authentication navigation', () => {
  let unsubscribe: () => void;
  beforeEach(() => {
    jest.useFakeTimers();
    chrome.runtime.connect = jest.fn(() => ({
      onDisconnect: { addListener: jest.fn(), removeListener: jest.fn() },
      disconnect: jest.fn(),
    })) as any;
    jest.mocked(controllerEmitter).mockReset();
    mockNavigate.mockClear();
    mockAlert.mockClear();
    mockClear.mockClear();
    mockReload.mockClear();
    mockSecrets = { kind: 'import', phrase: 'test seed' };
    renderToStaticMarkup(<CreatePasswordImport />);
  });
  afterEach(() => {
    unsubscribe?.();
    jest.useRealTimers();
  });

  it('refreshes authentication after creation and ignores an older locked reply', async () => {
    let oldReply: (value: boolean) => void;
    const oldStatus = new Promise<boolean>((resolve) => {
      oldReply = resolve;
    });
    jest
      .mocked(controllerEmitter)
      .mockReturnValueOnce(oldStatus)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true);
    unsubscribe = subscribeControllerStatus(jest.fn());
    await mockSubmit({ password: 'test password' });
    expect(controllerEmitter).toHaveBeenLastCalledWith(
      ['wallet', 'isUnlocked'],
      [],
      1800,
      false
    );
    expect(mockNavigate).toHaveBeenCalledWith('/home', {
      state: { isWalletImported: true },
    });
    oldReply(false);
    await Promise.resolve();
    expect(getControllerStatus().isUnlocked).toBe(true);
  });

  it('uses existing-wallet recovery after creation if authentication cannot be confirmed', async () => {
    jest
      .mocked(controllerEmitter)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Worker unavailable'));
    await mockSubmit({ password: 'test password' });
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(controllerEmitter).toHaveBeenCalledTimes(2);
  });

  it('keeps first-time import on createWallet without issuing a recovery request', async () => {
    jest
      .mocked(controllerEmitter)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true);
    await mockSubmit({ password: 'test password' });
    expect(controllerEmitter).toHaveBeenNthCalledWith(
      1,
      ['wallet', 'createWallet'],
      ['test password', 'test seed'],
      10000,
      false
    );
    expect(
      jest
        .mocked(controllerEmitter)
        .mock.calls.some(([path]) => path[1] === 'recoverWalletFromSeed')
    ).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith('/home', {
      state: { isWalletImported: true },
    });
  });

  it('consumes recovery secrets before awaiting the worker and never asks for the old password', async () => {
    const ticket = 'synthetic-live-recovery-ticket';
    mockSecrets = {
      kind: 'import',
      phrase: 'test seed',
      recoveryTicket: ticket,
    };
    renderToStaticMarkup(<CreatePasswordImport />);
    let finishRecovery!: () => void;
    jest
      .mocked(controllerEmitter)
      .mockImplementationOnce(() => {
        expect(mockClear).toHaveBeenCalledTimes(1);
        return new Promise<void>((resolve) => {
          finishRecovery = resolve;
        });
      })
      .mockResolvedValueOnce(true);
    const submitted = mockSubmit({ password: 'new recovery password' });
    expect(controllerEmitter).toHaveBeenCalledWith(
      ['wallet', 'recoverWalletFromSeed'],
      ['new recovery password', 'test seed', ticket],
      expect.any(Number),
      false
    );
    await mockSubmit({ password: 'new recovery password' });
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    finishRecovery();
    await submitted;
    expect(
      jest
        .mocked(controllerEmitter)
        .mock.calls.some(([path]) => path[1] === 'createWallet')
    ).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith('/home', {
      state: { isWalletImported: true },
    });
  });

  it.each([
    'Recovery rejected',
    'Network request timed out',
    'Receiving end does not exist',
  ])(
    'keeps a failed recovery without automatic reload or replay after %s',
    async (message) => {
      const ticket = 'synthetic-live-recovery-ticket';
      mockSecrets = {
        kind: 'import',
        phrase: 'test seed',
        recoveryTicket: ticket,
      };
      renderToStaticMarkup(<CreatePasswordImport />);
      jest.mocked(controllerEmitter).mockRejectedValueOnce(new Error(message));
      await mockSubmit({ password: 'new recovery password' });
      await mockSubmit({ password: 'new recovery password' });
      expect(controllerEmitter).toHaveBeenCalledTimes(1);
      expect(controllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'recoverWalletFromSeed'],
        ['new recovery password', 'test seed', ticket],
        expect.any(Number),
        false
      );
      expect(mockClear).toHaveBeenCalledTimes(1);
      expect(mockReload).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockAlert).not.toHaveBeenCalled();
    }
  );

  it('keeps recovery failure visible until Check wallet is chosen without replaying the request', async () => {
    mockSecrets = {
      kind: 'import',
      phrase: 'test seed',
      recoveryTicket: 'synthetic-live-recovery-ticket',
    };
    mockClear.mockImplementationOnce(() => {
      mockSecrets = { kind: 'idle' };
    });
    jest
      .mocked(controllerEmitter)
      .mockRejectedValueOnce(new Error('Network request timed out'));
    render(<CreatePasswordImport />);
    const submitBeforeFailure = mockSubmit;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit password' }));
    });

    expect(screen.getByRole('alert').textContent).toBe(
      'settings.walletRecoveryFailed'
    );
    expect(screen.getByRole('heading').textContent).toBe(
      'settings.recoveryTitle'
    );
    expect(
      screen.queryByRole('button', { name: 'Submit password' })
    ).toBeNull();
    expect(mockSecrets).toEqual({ kind: 'idle' });
    expect(mockReload).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(10000);
      await submitBeforeFailure({ password: 'new recovery password' });
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'settings.walletRecoveryFailed'
    );
    expect(mockReload).not.toHaveBeenCalled();
    expect(controllerEmitter).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole('button', { name: 'buttons.checkWallet' })
    );
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
    expect(controllerEmitter).toHaveBeenCalledWith(
      ['wallet', 'recoverWalletFromSeed'],
      ['new recovery password', 'test seed', 'synthetic-live-recovery-ticket'],
      10000,
      false
    );
  });

  it.each([
    'Storage unavailable',
    'Network request timed out',
    'Receiving end does not exist',
  ])('recovers without replaying creation after %s', async (message) => {
    jest
      .mocked(controllerEmitter)
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce(false);
    await mockSubmit({ password: 'test password' });
    await mockSubmit({ password: 'test password' });
    expect(controllerEmitter).toHaveBeenNthCalledWith(
      1,
      ['wallet', 'createWallet'],
      ['test password', 'test seed'],
      10000,
      false
    );
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('settings.walletSetupFailed');
  });
});
