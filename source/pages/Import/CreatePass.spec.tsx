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
jest.mock('components/index', () => ({
  PasswordForm: ({ onSubmit }: any) => {
    mockSubmit = onSubmit;
    return null;
  },
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    state: { phrase: 'test seed', isWalletImported: true },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
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
    expect(mockNavigate).toHaveBeenCalledWith('/', {
      state: { isWalletImported: true },
    });
    expect(controllerEmitter).toHaveBeenCalledTimes(2);
  });

  it('does not navigate or claim authentication if creation fails', async () => {
    jest
      .mocked(controllerEmitter)
      .mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(mockSubmit({ password: 'test password' })).rejects.toThrow(
      'Storage unavailable'
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(controllerEmitter).toHaveBeenCalledTimes(1);
  });
});
