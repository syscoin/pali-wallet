/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { INetworkType } from 'types/network';

import CreateAccount from './CreateAccount';

let mockState: any;
let mockLocation: any;
let mockChanging = false;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockHandleLocked = jest.fn();
const newAddress = '0x0000000000000000000000000000000000000042';

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({ useUtils: () => ({}) }));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: mockHandleLocked,
  }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: mockChanging }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('antd', () => {
  const Form = ({ children, onFinish, ...props }: any) => (
    <form
      data-testid="create-account-form"
      className={props.className}
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem(
          'label'
        ) as HTMLInputElement | null;
        onFinish({ label: field?.value });
      }}
    >
      {children}
    </form>
  );
  Form.Item = function MockFormItem({ children }: any) {
    return <div>{children}</div>;
  };
  return {
    Form,
    Input: (props: any) => <input name="label" {...props} />,
  };
});
jest.mock('components/index', () => ({
  Icon: () => null,
  Card: ({ children }: any) => <div role="alert">{children}</div>,
  Button: ({ children, variant, loading, fullWidth, ...props }: any) => (
    <button
      data-variant={variant}
      data-full-width={fullWidth ? 'true' : undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  ),
}));
jest.mock('components/Dialog/Dialog', () => ({
  DialogPrimitive: ({ children, show = true }: any) =>
    show ? <div role="dialog">{children}</div> : null,
  SheetPanel: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ title }: any) => <h2>{title}</h2>,
}));

const submit = () =>
  fireEvent.submit(screen.getByTestId('create-account-form'));

describe('smart-account creation from the hub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChanging = false;
    mockHandleLocked.mockReturnValue(false);
    mockEmitter.mockResolvedValue({ address: newAddress });
    mockLocation = {
      pathname: '/settings/account/new',
      state: {
        smartAccountOnly: true,
        returnContext: { returnRoute: '/home/smart-account' },
      },
    };
    mockState = {
      vault: {
        activeNetwork: {
          kind: INetworkType.Ethereum,
          chainId: 42161,
          label: 'Arbitrum One',
        },
      },
    };
  });

  it('submits the smart-only form to smart-account creation with the entered label', async () => {
    render(<CreateAccount />);
    expect(
      screen.getAllByRole('button', {
        name: 'settings.createSmartAccount',
      })
    ).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Arbitrum savings' },
    });
    submit();
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'createSmartAccount'],
      [{ label: 'Arbitrum savings' }],
      300000
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(screen.getByText(newAddress)).toBeDefined();
  });

  it('returns to the smart-account hub when the actual success widget OK is clicked', async () => {
    render(<CreateAccount />);
    submit();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'buttons.ok' }));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/home/smart-account',
      expect.objectContaining({
        replace: true,
        state: expect.objectContaining({ returnContext: undefined }),
      })
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it.each(['UTXO network', 'network transition'])(
    'blocks both the button and form submission on a %s',
    (reason) => {
      const view = render(<CreateAccount />);
      if (reason === 'UTXO network')
        mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      else mockChanging = true;
      view.rerender(<CreateAccount />);
      const button = screen.getByRole('button', {
        name: 'settings.createSmartAccount',
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      submit();
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    }
  );

  it('prevents a second smart creation while the first request is pending', async () => {
    let finish!: (result: { address: string }) => void;
    mockEmitter.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(<CreateAccount />);
    submit();
    submit();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole('button', {
          name: 'settings.createSmartAccount',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await act(async () => finish({ address: newAddress }));
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('surfaces a creation error and allows a smart-only retry without HD creation', async () => {
    const error = new Error('RPC unavailable');
    mockEmitter.mockRejectedValueOnce(error);
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      render(<CreateAccount />);
      submit();
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('RPC unavailable')
      );
      expect(mockHandleLocked).toHaveBeenCalledWith(error);
      expect(mockNavigate).not.toHaveBeenCalled();
      submit();
      await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
      expect(mockEmitter.mock.calls.map(([path]) => path)).toEqual([
        ['wallet', 'createSmartAccount'],
        ['wallet', 'createSmartAccount'],
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it('keeps ordinary account creation on its existing HD submission path', async () => {
    mockLocation.state = { returnContext: { returnRoute: '/home' } };
    render(<CreateAccount />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Ordinary savings' },
    });
    submit();
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'createAccount'],
      ['Ordinary savings']
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'buttons.ok' }));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/home',
      expect.objectContaining({
        replace: true,
        state: expect.objectContaining({ returnContext: undefined }),
      })
    );
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  });
});
