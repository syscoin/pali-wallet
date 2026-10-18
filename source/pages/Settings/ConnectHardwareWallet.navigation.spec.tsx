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

  it('clears a failed Ledger import and permits one fresh WebHID-backed retry', async () => {
    const originalHid = Object.getOwnPropertyDescriptor(navigator, 'hid');
    const requestDevice = jest.fn().mockResolvedValue([{ vendorId: 0x2c97 }]);
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: { requestDevice },
    });
    let rejectImport!: (error: Error) => void;
    mockEmitter
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectImport = reject;
          })
      )
      .mockResolvedValueOnce(undefined);
    const addListener = jest.spyOn(window, 'addEventListener');
    const removeListener = jest.spyOn(window, 'removeEventListener');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest
      .spyOn(jest.requireMock('utils/errorHandling'), 'handleTransactionError')
      .mockReturnValueOnce(false);

    try {
      render(<ConnectHardwareWallet />);
      fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'buttons.connect' })
        );
      });
      expect(requestDevice).toHaveBeenCalledTimes(1);
      expect(requestDevice).toHaveBeenCalledWith({
        filters: [{ vendorId: 0x2c97 }],
      });
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(mockEmitter).toHaveBeenNthCalledWith(
        1,
        ['wallet', 'importLedgerAccountFromController'],
        [],
        300000
      );
      expect(
        screen
          .getByRole('button', { name: 'buttons.cancel' })
          .hasAttribute('disabled')
      ).toBe(true);
      const beforeUnload = addListener.mock.calls.find(
        ([event]) => event === 'beforeunload'
      )?.[1];
      expect(beforeUnload).toBeDefined();

      await act(async () => {
        rejectImport(new Error('Ledger import failed'));
      });
      expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull();
      expect(removeListener).toHaveBeenCalledWith('beforeunload', beforeUnload);
      expect(
        screen
          .getByRole('button', { name: 'buttons.cancel' })
          .hasAttribute('disabled')
      ).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));
      const connect = screen.getByRole('button', {
        name: 'buttons.connect',
      });
      expect(connect.hasAttribute('disabled')).toBe(false);
      expect(connect.hasAttribute('aria-busy')).toBe(false);

      await act(async () => {
        fireEvent.click(connect);
      });
      expect(requestDevice).toHaveBeenCalledTimes(2);
      expect(mockEmitter).toHaveBeenCalledTimes(2);
      expect(mockEmitter).toHaveBeenNthCalledWith(
        2,
        ['wallet', 'importLedgerAccountFromController'],
        [],
        300000
      );
      expect(
        screen.getByRole('button', { name: 'Finish setup' })
      ).toBeDefined();
    } finally {
      if (originalHid) Object.defineProperty(navigator, 'hid', originalHid);
      else delete (navigator as any).hid;
    }
  });

  it('leaves a cancelled Ledger chooser idle without starting an account import', async () => {
    const originalHid = Object.getOwnPropertyDescriptor(navigator, 'hid');
    let cancelChooser!: () => void;
    const requestDevice = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<unknown[]>((resolve) => {
            cancelChooser = () => resolve([]);
          })
      )
      .mockResolvedValueOnce([{ vendorId: 0x2c97 }]);
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: { requestDevice },
    });

    try {
      render(<ConnectHardwareWallet />);
      fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));
      let pending!: Promise<void>;
      act(() => {
        pending = mockConnect();
      });
      await act(async () => {
        await mockConnect();
      });
      expect(requestDevice).toHaveBeenCalledTimes(1);
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole('button', { name: 'buttons.cancel' })
          .hasAttribute('disabled')
      ).toBe(true);

      await act(async () => {
        cancelChooser();
        await pending;
      });
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull();
      expect(
        screen
          .getByRole('button', { name: 'buttons.connect' })
          .hasAttribute('disabled')
      ).toBe(false);
      expect(
        screen
          .getByRole('button', { name: 'buttons.cancel' })
          .hasAttribute('disabled')
      ).toBe(false);

      await act(async () => {
        await mockConnect();
      });
      expect(requestDevice).toHaveBeenCalledTimes(2);
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'importLedgerAccountFromController'],
        [],
        300000
      );
      expect(
        screen.getByRole('button', { name: 'Finish setup' })
      ).toBeDefined();
    } finally {
      if (originalHid) Object.defineProperty(navigator, 'hid', originalHid);
      else delete (navigator as any).hid;
    }
  });

  it.each([
    ['Trezor', 'importTrezorAccountFromController'],
    ['Ledger', 'importLedgerAccountFromController'],
  ])('preserves a healthy %s import without WebHID', async (name, method) => {
    const originalHid = Object.getOwnPropertyDescriptor(navigator, 'hid');
    Object.defineProperty(navigator, 'hid', {
      configurable: true,
      value: undefined,
    });
    try {
      render(<ConnectHardwareWallet />);
      fireEvent.click(screen.getByRole('button', { name }));
      await act(async () => {
        await mockConnect();
      });

      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(mockEmitter).toHaveBeenCalledWith(['wallet', method], [], 300000);
      expect(
        screen.getByRole('button', { name: 'Finish setup' })
      ).toBeDefined();
      expect(
        screen
          .getByRole('button', { name: 'buttons.cancel' })
          .hasAttribute('disabled')
      ).toBe(false);
    } finally {
      if (originalHid) Object.defineProperty(navigator, 'hid', originalHid);
      else delete (navigator as any).hid;
    }
  });
});
