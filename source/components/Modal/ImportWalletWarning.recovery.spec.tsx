/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from 'hooks/useOnboardingSecrets';

import { ImportWalletWarning } from './WarningBaseModal';

const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn() };
const ticket = 'synthetic-only-wallet-recovery-ticket';

jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, isUnlocked: false }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, loading, ...props }: any) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
}));
jest.mock('components/Dialog/Dialog', () => ({
  DialogPrimitive: ({ children, show, onClose }: any) =>
    show ? (
      <section>
        <button onClick={() => onClose()}>dismiss dialog</button>
        {children}
      </section>
    ) : null,
  SheetPanel: ({ children }: any) => <>{children}</>,
  SheetHeader: ({ title }: any) => <h1>{title}</h1>,
}));

const Probe = () => {
  const { secrets } = useOnboardingSecrets();
  const location = useLocation();
  return (
    <>
      <output data-testid="secrets">{JSON.stringify(secrets)}</output>
      <output data-testid="route">{location.pathname}</output>
    </>
  );
};
const Tree = ({
  show = true,
  onClose = jest.fn(),
}: {
  onClose?: () => void;
  show?: boolean;
}) => (
  <BrowserRouter>
    <OnboardingSecretsProvider>
      <ImportWalletWarning
        show={show}
        title="Recover with seed phrase"
        onClose={onClose}
      />
      <Probe />
    </OnboardingSecretsProvider>
  </BrowserRouter>
);

const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
  mockEmitter.mockReset().mockResolvedValue(ticket);
});
afterEach(() => jest.restoreAllMocks());

it('begins locked-wallet recovery without the old password and keeps the ticket out of persisted navigation', async () => {
  render(<Tree />);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'buttons.recoverWallet' })
    );
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'beginWalletRecovery'],
    []
  );
  expect(screen.getByTestId('route').textContent).toBe('/import');
  expect(JSON.parse(screen.getByTestId('secrets').textContent!)).toEqual({
    kind: 'import',
    recoveryTicket: ticket,
  });
  expect(
    JSON.stringify({
      history: window.history.state,
      url: window.location.href,
      local: localStorage,
      session: sessionStorage,
    })
  ).not.toContain(ticket);
});

it.each(['cancel', 'dismiss', 'hide', 'unmount', 'pagehide', 'hidden'])(
  'ignores a recovery ticket acknowledged after %s and cannot restart seed import',
  async (departure) => {
    const response = deferred();
    const onClose = jest.fn();
    mockEmitter.mockReturnValueOnce(response.promise);
    const view = render(<Tree onClose={onClose} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'buttons.recoverWallet' })
    );
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole('button', { name: 'buttons.recoverWallet' })
        .hasAttribute('disabled')
    ).toBe(true);
    if (departure === 'cancel')
      fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    if (departure === 'dismiss')
      fireEvent.click(screen.getByRole('button', { name: 'dismiss dialog' }));
    if (departure === 'hide')
      view.rerender(<Tree show={false} onClose={onClose} />);
    if (departure === 'unmount') view.unmount();
    if (departure === 'pagehide') fireEvent(window, new Event('pagehide'));
    if (departure === 'hidden') {
      jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
    }
    await act(async () => response.resolve(ticket));
    expect(window.location.pathname).toBe('/');
    if (departure !== 'unmount') {
      expect(screen.getByTestId('secrets').textContent).toBe('{}');
      expect(screen.getByTestId('route').textContent).toBe('/');
    }
    if (departure === 'cancel' || departure === 'dismiss')
      expect(onClose).toHaveBeenCalledWith(false);
    expect(JSON.stringify(window.history.state)).not.toContain(ticket);
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it('keeps a failed recovery request on the locked screen without changing secrets or navigating', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Background unavailable'));
  render(<Tree />);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'buttons.recoverWallet' })
    );
  });
  expect(screen.getByTestId('route').textContent).toBe('/');
  expect(screen.getByTestId('secrets').textContent).toBe('{}');
  expect(mockAlert.error).toHaveBeenCalledWith('settings.walletRecoveryFailed');
  expect(
    screen
      .getByRole('button', { name: 'buttons.recoverWallet' })
      .hasAttribute('disabled')
  ).toBe(false);
});
