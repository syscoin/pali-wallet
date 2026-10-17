/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { AccountHeader } from './AccountHeader';

let mockState: any;
let mockLocation: any;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const mockCopy = jest.fn();
const mockNavigate = jest.fn();
let outstandingRequests: Array<() => void> = [];
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) => state.vault.account,
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, mockCopy],
    alert: mockAlert,
    navigate: mockNavigate,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  adjustUrl: (value: string) => value,
}));
jest.mock('utils/navigationState', () => ({
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  ConfirmationModal: jest.requireActual('../Modal/Modal').ConfirmationModal,
  IconButton: jest.requireActual('../IconButton/IconButton').IconButton,
  Icon: () => <svg aria-hidden="true" />,
  Tooltip: ({ children }: any) => children,
}));
jest.mock(
  'components/Loader/SkeletonLoader',
  () =>
    function MockSkeletonLoader() {
      return <span>Loading</span>;
    }
);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const originalObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = originalObserver;
});
beforeEach(() => {
  outstandingRequests = [];
  window.history.replaceState(null, '', '#/home');
  mockLocation = { pathname: '/home', search: '', hash: '', key: 'home' };
  mockState = {
    vault: {
      account: {
        id: 7,
        label: 'Hardware',
        address: 'tsys1qowned',
        xpub: 'public-test-xpub',
      },
      activeAccount: { id: 7, type: 'Ledger' },
      activeNetwork: {
        chainId: 5700,
        kind: 'syscoin',
        currency: 'tsys',
        slip44: 1,
        url: 'https://fixture.example',
        explorer: 'https://fixture.example',
      },
      isBitcoinBased: true,
    },
    vaultGlobal: { networkStatus: 'connected', isSwitchingAccount: false },
  };
  mockEmitter.mockReset();
  Object.values(mockAlert).forEach((fn) => fn.mockReset());
});
afterEach(async () => {
  await act(async () => outstandingRequests.forEach((resolve) => resolve()));
});

const deferred = () => {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  outstandingRequests.push(() => resolve());
  return { promise, resolve, reject };
};
const open = async () => {
  fireEvent.click(screen.getByText(mockState.vault.account.address));
  return screen.findByRole('dialog', { name: 'home.verifySysAddress' });
};
const start = async (user: ReturnType<typeof userEvent.setup>) => {
  const dialog = await open();
  await user.click(
    within(dialog).getByRole('button', { name: 'buttons.verify' })
  );
  return dialog;
};

it.each([false, true])(
  'preserves the full account label while reserving header controls (smart=%s)',
  (isSmartAccount) => {
    const label = 'A'.repeat(80);
    mockState.vault.account.label = label;
    mockState.vault.account.isSmartAccount = isSmartAccount;
    render(<AccountHeader />);

    const name = screen.getByTitle(label);
    expect(name.textContent).toBe(label);
    expect(name.classList.contains('truncate')).toBe(true);
    expect(name.classList.contains('min-w-0')).toBe(true);
    expect(name.parentElement?.classList.contains('min-w-0')).toBe(true);
    const edit = screen.getByRole('button', { name: 'buttons.edit' });
    expect(edit.classList.contains('shrink-0')).toBe(true);
    if (isSmartAccount) {
      expect(
        screen.getByRole('button', { name: 'smartAccountHub.badge' })
      ).toBeTruthy();
    }
  }
);

it.each(['success', 'failure'])(
  'can cancel a pending read-only verification and ignores its late %s',
  async (outcome) => {
    const user = userEvent.setup();
    const request = deferred();
    mockEmitter.mockReturnValue(request.promise);
    render(<AccountHeader />);
    const dialog = await start(user);
    await user.click(
      within(dialog).getByRole('button', { name: 'buttons.cancel' })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      if (outcome === 'success') request.resolve();
      else request.reject(new Error('device error'));
    });
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);

it.each(['success', 'failure'])(
  'does not start a reopened verification until the old %s settles',
  async (outcome) => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    mockEmitter
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<AccountHeader />);
    const firstDialog = await start(user);
    await user.click(
      within(firstDialog).getByRole('button', { name: 'buttons.cancel' })
    );
    const nextDialog = await open();
    const verify = within(nextDialog).getByRole('button', {
      name: 'buttons.verify',
    }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    await user.click(verify);
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === 'success') first.resolve();
      else first.reject(new Error('old device error'));
    });
    expect(screen.getByRole('dialog')).toBe(nextDialog);
    expect(
      (
        within(nextDialog).getByRole('button', {
          name: 'buttons.cancel',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(verify.disabled).toBe(false);
    await user.click(verify);
    expect(mockEmitter).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockAlert.success).toHaveBeenCalledWith('home.addressVerified');
    expect(mockEmitter.mock.calls).toEqual(
      Array(2).fill([
        ['wallet', 'ethereumTransaction', 'verifyUtxoAddress'],
        [7, 'tsys', 1],
        300000,
      ])
    );
  }
);

it.each(['account', 'network', 'route', 'switching'])(
  'discards pending verification after a %s change',
  async (change) => {
    const user = userEvent.setup();
    const request = deferred();
    mockEmitter.mockReturnValue(request.promise);
    const view = render(<AccountHeader />);
    await start(user);
    if (change === 'account') {
      mockState = {
        ...mockState,
        vault: {
          ...mockState.vault,
          activeAccount: { id: 8, type: 'Trezor' },
          account: {
            ...mockState.vault.account,
            id: 8,
            address: 'tsys1qother',
          },
        },
      };
    } else if (change === 'network') {
      mockState = {
        ...mockState,
        vault: {
          ...mockState.vault,
          activeNetwork: {
            ...mockState.vault.activeNetwork,
            chainId: 57,
            url: 'https://other.example',
          },
        },
      };
    } else if (change === 'route') {
      mockLocation = {
        ...mockLocation,
        pathname: '/settings',
        key: 'settings',
      };
    } else {
      mockState = {
        ...mockState,
        vaultGlobal: { ...mockState.vaultGlobal, isSwitchingAccount: true },
      };
    }
    view.rerender(<AccountHeader />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    if (change !== 'switching') {
      const nextDialog = await open();
      const verify = within(nextDialog).getByRole('button', {
        name: 'buttons.verify',
      }) as HTMLButtonElement;
      expect(verify.disabled).toBe(true);
      await user.click(verify);
      expect(mockEmitter).toHaveBeenCalledTimes(1);
    }
    await act(async () => request.resolve());
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it('invalidates verification on native navigation before a React rerender', async () => {
  const user = userEvent.setup();
  const request = deferred();
  mockEmitter.mockReturnValue(request.promise);
  render(<AccountHeader />);
  await start(user);
  act(() => {
    window.history.replaceState(null, '', '#/settings');
    window.dispatchEvent(new Event('hashchange'));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => request.reject(new Error('device error')));
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('ignores a result after unmount without cancelling or retrying the device request', async () => {
  const user = userEvent.setup();
  const request = deferred();
  mockEmitter.mockReturnValue(request.promise);
  const view = render(<AccountHeader />);
  await start(user);
  view.unmount();
  await act(async () => request.resolve());
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('retains the device latch across unmount/remount and permits a fresh retry only after settlement', async () => {
  const user = userEvent.setup();
  const first = deferred();
  const second = deferred();
  mockEmitter
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const oldView = render(<AccountHeader />);
  await start(user);
  oldView.unmount();
  render(<AccountHeader />);
  const dialog = await open();
  const verify = within(dialog).getByRole('button', {
    name: 'buttons.verify',
  }) as HTMLButtonElement;
  expect(verify.disabled).toBe(true);
  await user.click(verify);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve());
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(verify.disabled).toBe(false);
  await user.click(verify);
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  await act(async () => second.resolve());
  expect(mockAlert.success).toHaveBeenCalledWith('home.addressVerified');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([
  ['device error', 'send.verificationFailed'],
  ['User cancelled', 'home.verificationDeniedByUser'],
])(
  'retains current-request %s and the original hardware RPC',
  async (message, expected) => {
    const user = userEvent.setup();
    const request = deferred();
    mockEmitter.mockReturnValue(request.promise);
    render(<AccountHeader />);
    await start(user);
    await act(async () => request.reject(new Error(message)));
    expect(mockAlert.error).toHaveBeenCalledWith(expected);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'ethereumTransaction', 'verifyUtxoAddress'],
      [7, 'tsys', 1],
      300000
    );
  }
);
