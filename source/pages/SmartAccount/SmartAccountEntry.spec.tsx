/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { INetworkType, KeyringAccountType } from 'types/network';
import { navigateWithContext } from 'utils/navigationState';

import SmartAccountHub from './Hub';
import SmartAccountEntry from './SmartAccountEntry';

let mockLocation: any;
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
const mockStoreListeners = new Set<() => void>();
let mockState: any;
let mockChanging = false;
let mockUnavailable = false;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn() };
const mockHandleLocked = jest.fn();
const mockReturnContext = { returnRoute: '/home/smart-account' };

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: mockHandleLocked,
    connectionUnavailable: mockUnavailable,
  }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: mockChanging }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    subscribe: (listener: () => void) => {
      mockStoreListeners.add(listener);
      return () => {
        mockStoreListeners.delete(listener);
      };
    },
  },
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) =>
    state.vault.accounts[state.vault.activeAccount.type][
      state.vault.activeAccount.id
    ],
}));
jest.mock('utils/smartAccount', () => ({
  getAvailablePaliModules: () => [],
}));
jest.mock('antd', () => ({ Form: 'form', Input: 'input' }));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: String(mockState.vault.activeAccount.id),
    network: JSON.stringify(mockState.vault.activeNetwork),
  }),
  captureNavigationScroll: () => ({}),
  createBrowsingNavigationContext: (_location: any, state: any) =>
    state ? { ...mockReturnContext, state } : mockReturnContext,
  createNavigationContext: () => mockReturnContext,
  navigateWithContext: jest.fn(),
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  AddressText: ({ value }: any) => <span>{value}</span>,
  Button: ({ children, variant, loading, fullWidth, ...props }: any) => (
    <button
      data-variant={variant}
      data-full-width={fullWidth}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  ),
  CenterPanel: ({ children }: any) => <div>{children}</div>,
  CenterTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogPrimitive: ({ children, show = true, onClose }: any) =>
    show ? (
      <div role="dialog">
        <button
          data-testid="dismiss-smart-account-picker"
          onClick={() => onClose?.()}
        >
          Dismiss picker
        </button>
        {children}
      </div>
    ) : null,
}));

const account = (id: number, label: string, chainId = 42161) => ({
  id,
  label,
  address: `0x${String(id).padStart(40, '0')}`,
  isSmartAccount: true,
  smartAccount: { chainId, isDeployed: false },
});

const openPicker = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'smartAccountHub.chooseAccount' })
  );
const choose = (id = 7) =>
  fireEvent.click(screen.getByTestId(`smart-account-option-${id}`));

describe('smart-account hub account selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreListeners.clear();
    mockChanging = false;
    mockUnavailable = false;
    mockHandleLocked.mockReturnValue(false);
    mockLocation = {
      pathname: '/home/smart-account',
      search: '',
      hash: '',
      state: {},
    };
    mockEmitter.mockImplementation(async (command, args) => {
      if (command[1] === 'setAccount')
        mockState.vault.activeAccount = { id: args[0], type: args[1] };
    });
    mockState = {
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: {
            0: { id: 0, label: 'Ordinary account', address: '0x1234' },
          },
          [KeyringAccountType.SmartAccount]: {
            7: account(7, 'Arbitrum smart account'),
            8: account(8, 'Ethereum smart account', 1),
            9: account(9, 'Second Arbitrum smart account'),
          },
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        activeNetwork: {
          chainId: 42161,
          kind: INetworkType.Ethereum,
          slip44: 60,
          url: 'https://arbitrum.test',
        },
      },
    };
  });

  it('opens a selectable list containing only smart accounts on the current EVM chain', () => {
    render(<SmartAccountEntry />);
    expect(screen.queryByRole('dialog')).toBeNull();
    openPicker();
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByTestId('smart-account-option-7')).toBeDefined();
    expect(screen.getByTestId('smart-account-option-9')).toBeDefined();
    expect(screen.queryByTestId('smart-account-option-8')).toBeNull();
    expect(screen.queryByText('Ordinary account')).toBeNull();
    expect(
      mockNavigate.mock.calls.every(([, options]) => options?.replace)
    ).toBe(true);
    expect(navigateWithContext).not.toHaveBeenCalled();
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it('wires the hub action to account selection instead of account management', async () => {
    render(<SmartAccountHub />);
    openPicker();
    choose();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'setAccount'],
      [7, KeyringAccountType.SmartAccount]
    );
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/home/smart-account',
      expect.objectContaining({
        state: expect.objectContaining({
          returnContext: expect.objectContaining({
            state: expect.objectContaining({
              smartAccountPicker: expect.objectContaining({ open: true }),
            }),
          }),
        }),
      })
    );
    expect(navigateWithContext).not.toHaveBeenCalled();
  });

  it('selects the chosen smart account and closes the picker after the switch succeeds', async () => {
    render(<SmartAccountEntry />);
    openPicker();
    choose(9);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'setAccount'],
      [9, KeyringAccountType.SmartAccount]
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/home/smart-account',
      expect.objectContaining({
        state: expect.objectContaining({
          returnContext: expect.objectContaining({
            state: expect.objectContaining({
              smartAccountPicker: expect.objectContaining({ open: true }),
            }),
          }),
        }),
      })
    );
    expect(navigateWithContext).not.toHaveBeenCalled();
  });

  it('keeps an in-flight account switch single-flight and does not dismiss it early', async () => {
    let finish!: () => void;
    mockEmitter.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    render(<SmartAccountEntry />);
    openPicker();
    choose();
    choose();
    choose(9);
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByTestId('smart-account-option-9') as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.click(screen.getByTestId('dismiss-smart-account-picker'));
    expect(screen.getByRole('dialog')).toBeDefined();
    mockState.vault.activeAccount = {
      id: 7,
      type: KeyringAccountType.SmartAccount,
    };
    await act(async () => finish());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the picker usable and shows feedback when switching fails', async () => {
    mockEmitter.mockRejectedValueOnce(new Error('Switch failed'));
    render(<SmartAccountEntry />);
    openPicker();
    choose();
    await waitFor(() =>
      expect(mockAlert.error).toHaveBeenCalledWith(
        'accountMenu.switchAccountError'
      )
    );
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(
      (screen.getByTestId('smart-account-option-7') as HTMLButtonElement)
        .disabled
    ).toBe(false);
    choose();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockEmitter).toHaveBeenCalledTimes(2);
  });

  it('lets wallet-lock handling own an authentication failure', async () => {
    const error = new Error('Wallet is locked');
    mockHandleLocked.mockReturnValue(true);
    mockEmitter.mockRejectedValueOnce(error);
    render(<SmartAccountEntry />);
    openPicker();
    choose();
    await waitFor(() => expect(mockHandleLocked).toHaveBeenCalledWith(error));
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(
      mockNavigate.mock.calls.every(([, options]) => options?.replace)
    ).toBe(true);
  });

  it('can dismiss the picker without changing the account', () => {
    render(<SmartAccountEntry />);
    openPicker();
    fireEvent.click(screen.getByTestId('dismiss-smart-account-picker'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(
      mockNavigate.mock.calls.every(([, options]) => options?.replace)
    ).toBe(true);
  });

  it('offers smart-account creation when no smart account belongs to the active chain', () => {
    delete mockState.vault.accounts[KeyringAccountType.SmartAccount][7];
    delete mockState.vault.accounts[KeyringAccountType.SmartAccount][9];
    render(<SmartAccountEntry />);
    expect(
      screen.queryByRole('button', { name: 'smartAccountHub.chooseAccount' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'settings.createSmartAccount' })
    );
    expect(navigateWithContext).toHaveBeenCalledWith(
      mockNavigate,
      '/settings/account/new',
      { smartAccountOnly: true },
      mockReturnContext
    );
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it('can create another smart account while keeping the hub as the return destination', () => {
    render(<SmartAccountEntry />);
    fireEvent.click(
      screen.getByRole('button', { name: 'settings.createSmartAccount' })
    );
    expect(navigateWithContext).toHaveBeenCalledWith(
      mockNavigate,
      '/settings/account/new',
      { smartAccountOnly: true },
      mockReturnContext
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it.each(['network transition', 'controller disconnect'])(
    'prevents selection during a %s',
    (reason) => {
      const view = render(<SmartAccountEntry />);
      openPicker();
      mockChanging = reason === 'network transition';
      mockUnavailable = reason === 'controller disconnect';
      view.rerender(<SmartAccountEntry />);
      const option = screen.queryByTestId('smart-account-option-7');
      if (option) fireEvent.click(option);
      expect(mockEmitter).not.toHaveBeenCalled();
    }
  );

  it.each(['chain', 'RPC'])(
    'rejects a stale account row after the current %s changes before the next render',
    (changed) => {
      render(<SmartAccountEntry />);
      openPicker();
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        ...(changed === 'chain'
          ? { chainId: 1 }
          : { url: 'https://arbitrum-other.test' }),
      };
      choose();
      expect(mockEmitter).not.toHaveBeenCalled();
    }
  );

  it.each(['removed', 'replaced'])(
    'rejects a stale row whose account was %s before the next render',
    (changed) => {
      render(<SmartAccountEntry />);
      openPicker();
      const accounts =
        mockState.vault.accounts[KeyringAccountType.SmartAccount];
      if (changed === 'removed') delete accounts[7];
      else accounts[7] = { ...accounts[7], address: account(77, '').address };
      choose();
      expect(mockEmitter).not.toHaveBeenCalled();
    }
  );

  it('rejects selection when the background started an account switch before the next render', () => {
    render(<SmartAccountEntry />);
    openPicker();
    mockState.vaultGlobal = { isSwitchingAccount: true };
    choose();
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it('keeps smart accounts out of selection and creation on a UTXO network', () => {
    mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
    render(<SmartAccountEntry />);
    expect(
      screen.queryByRole('button', { name: 'smartAccountHub.chooseAccount' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'settings.createSmartAccount' })
    ).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it('reopens a saved chooser over the active hub without switching accounts', () => {
    mockLocation.state = {
      smartAccountPicker: {
        open: true,
        search: 'Second',
        network: JSON.stringify(mockState.vault.activeNetwork),
        visibleCount: 100,
        scrollTop: 80,
      },
    };
    render(<SmartAccountEntry pickerOnly />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      'Second'
    );
    expect(screen.getByTestId('smart-account-option-9')).toBeDefined();
    expect(screen.queryByTestId('smart-account-option-7')).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
  });
  it('waits for account publication when the RPC replies before Redux, then keeps the chooser as origin', async () => {
    mockEmitter.mockResolvedValueOnce(undefined);
    render(<SmartAccountEntry />);
    openPicker();
    choose();
    await act(async () => undefined);
    expect(screen.getByRole('dialog')).toBeDefined();
    mockState.vault.activeAccount = {
      id: 7,
      type: KeyringAccountType.SmartAccount,
    };
    await act(async () => {
      mockStoreListeners.forEach((listener) => listener());
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/home/smart-account',
      expect.objectContaining({
        state: expect.objectContaining({
          returnContext: expect.objectContaining({
            state: expect.objectContaining({
              smartAccountPicker: expect.objectContaining({ open: true }),
            }),
          }),
        }),
      })
    );
    expect(mockStoreListeners.size).toBe(0);
  });
  it('closes an open chooser on network change without republishing its old filter in the new context', () => {
    mockLocation.state.smartAccountPicker = {
      open: true,
      search: 'Second',
      visibleCount: 50,
      network: JSON.stringify(mockState.vault.activeNetwork),
    };
    const view = render(<SmartAccountEntry />);
    expect(screen.getByRole('dialog')).toBeDefined();
    mockNavigate.mockClear();
    mockState.vault.activeNetwork = {
      ...mockState.vault.activeNetwork,
      chainId: 1,
    };
    view.rerender(<SmartAccountEntry />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
