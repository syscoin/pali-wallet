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
jest.mock('utils/reloadWalletForRecovery', () => ({
  reloadWalletForRecovery: () => mockReload(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  PasswordForm: ({ onSubmit }: any) => {
    mockSubmit = onSubmit;
    return null;
  },
}));
jest.mock('react-router-dom', () => ({
  Navigate: () => null,
}));
jest.mock('hooks/useOnboardingSecrets', () => ({
  useOnboardingSecrets: () => ({
    secrets: { kind: 'import', phrase: 'test seed' },
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
