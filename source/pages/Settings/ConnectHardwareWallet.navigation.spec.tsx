/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import ConnectHardwareWallet from './ConnectHardwareWallet';

let mockUnlocked = true;
let mockConnect: () => Promise<void>;
let mockCancel: () => void;
const mockEmitter = jest.fn();
const mockAlert = {
  error: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  success: jest.fn(),
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vault: { accounts: { Trezor: {}, Ledger: {} } } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: mockUnlocked,
  }),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => true,
}));
jest.mock('components/index', () => ({
  DefaultModal: ({ show, onClose }: any) =>
    show ? <button onClick={onClose}>Finish setup</button> : null,
  Button: ({ children, variant, loading, ...props }: any) => {
    if (props.id === 'connect-btn') mockConnect = props.onClick;
    if (children === 'buttons.cancel') mockCancel = props.onClick;
    return (
      <button
        data-variant={variant}
        aria-busy={loading || undefined}
        {...props}
      >
        {children}
      </button>
    );
  },
}));

describe('hardware setup navigation', () => {
  beforeEach(() => {
    mockUnlocked = true;
    mockEmitter.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('lets idle setup close without adding fake browser history or blocking navigation', () => {
    const close = jest
      .spyOn(window, 'close')
      .mockImplementation(() => undefined);
    const pushState = jest.spyOn(window.history, 'pushState');
    const addListener = jest.spyOn(window, 'addEventListener');
    render(<ConnectHardwareWallet />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
    for (const event of ['beforeunload', 'popstate', 'hashchange']) {
      expect(
        addListener.mock.calls.map(([registered]) => registered)
      ).not.toContain(event);
    }
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it.each(['no selection', 'wallet locked'])(
    'does not start an import for %s, including an invoked disabled-button handler',
    async (reason) => {
      const view = render(<ConnectHardwareWallet />);
      if (reason === 'wallet locked') {
        fireEvent.click(screen.getByRole('button', { name: 'Trezor' }));
        mockUnlocked = false;
        view.rerender(<ConnectHardwareWallet />);
      }
      await act(async () => {
        await mockConnect();
      });
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole('button', { name: 'buttons.cancel' })
          .hasAttribute('disabled')
      ).toBe(false);
    }
  );

  it('blocks duplicate imports and a stale cancel click only while import is pending', async () => {
    let complete!: () => void;
    mockEmitter.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const close = jest
      .spyOn(window, 'close')
      .mockImplementation(() => undefined);
    const addListener = jest.spyOn(window, 'addEventListener');
    const removeListener = jest.spyOn(window, 'removeEventListener');
    render(<ConnectHardwareWallet />);
    const idleCancel = mockCancel;
    fireEvent.click(screen.getByRole('button', { name: 'Trezor' }));
    const connect = mockConnect;
    let pending!: Promise<void>;
    act(() => {
      pending = connect();
    });
    await act(async () => {
      await connect();
      idleCancel();
    });
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', { name: 'buttons.cancel' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(addListener).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function)
    );
    await act(async () => {
      complete();
      await pending;
    });
    expect(removeListener).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function)
    );
    expect(
      screen
        .getByRole('button', { name: 'buttons.cancel' })
        .hasAttribute('disabled')
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
