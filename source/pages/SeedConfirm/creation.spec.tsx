/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { SeedConfirm } from '.';

const mockEmitter = jest.fn();
const mockRefresh = jest.fn();
const mockClear = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = jest.fn();
let mockConfirm: () => Promise<void>;
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  refreshControllerStatus: () => mockRefresh(),
}));
jest.mock('hooks/useOnboardingSecrets', () => ({
  useOnboardingSecrets: () => ({
    secrets: {
      kind: 'create',
      password: 'synthetic-password',
      phrase: 'synthetic-seed',
    },
    clear: mockClear,
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: { error: mockAlert } }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ state: { next: true } }),
  Navigate: () => null,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('./CreatePhrase', () => ({ CreatePhrase: () => null }));
jest.mock('components/Loader/AppLoadingSkeleton', () => ({
  AppLoadingSkeleton: () => <div>Recovering</div>,
}));
jest.mock('./ConfirmPhrase', () => ({
  ConfirmPhrase: ({ setPassed, confirmPassed }: any) => {
    mockConfirm = confirmPassed;
    return <button onClick={() => setPassed(true)}>Validate</button>;
  },
}));

describe('creation acknowledgement recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue(false);
  });

  it.each([
    'Network request timed out',
    'Storage unavailable',
    'Receiving end does not exist',
  ])('does not replay wallet creation after %s', async (message) => {
    mockEmitter.mockRejectedValueOnce(new Error(message));
    render(<SeedConfirm />);
    fireEvent.click(screen.getByText('Validate'));
    const confirm = mockConfirm;
    await confirm();
    await confirm();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'createWallet'],
      ['synthetic-password', 'synthetic-seed'],
      10000,
      false
    );
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mockAlert).toHaveBeenCalledWith('settings.walletSetupFailed');
    await waitFor(() => expect(screen.queryByText('Validate')).toBeNull());
  });

  it('preserves the successful creation route after authoritative authentication', async () => {
    mockEmitter.mockResolvedValueOnce(undefined);
    mockRefresh.mockResolvedValueOnce(true);
    render(<SeedConfirm />);
    fireEvent.click(screen.getByText('Validate'));
    await mockConfirm();
    expect(mockNavigate).toHaveBeenCalledWith('/home');
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
