/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { Provider, useSelector } from 'react-redux';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { KeyringAccountType } from 'types/network';

import ManageAccounts from './ManageAccounts';

let mockState: any;
let mockStore: ReturnType<typeof configureStore>;
let leavePage: () => void;
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ connectionUnavailable: false }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: false }),
}));
jest.mock('components/Icon/Icon', () => ({
  RiUserReceivedLine: () => null,
  LockIconSvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  MdBugReport: () => null,
  LoadingSvg: () => <span aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  Button: (props: any) => (
    <button type={props.type} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  IconButton: (props: any) => (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props['aria-label']}
    >
      {props.children}
    </button>
  ),
  Icon: () => null,
  PageActionFooter: ({ children }: any) => <footer>{children}</footer>,
  ConfirmationModal: jest.requireActual('components/Modal/Modal')
    .ConfirmationModal,
}));

const ADDRESS = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const holdRemoval = () => {
  const operation = deferred();
  mockEmitter.mockImplementation(() => {
    const current = mockStore.getState() as any;
    // Simulate the original target disappearing while a response is pending.
    mockStore.dispatch({
      type: 'fixture/replace',
      payload: {
        ...current,
        vault: {
          ...current.vault,
          accounts: { HDAccount: { 0: current.vault.accounts.HDAccount[0] } },
        },
      },
    });
    return operation.promise;
  });
  return operation;
};
const RouteOwner = () => {
  const navigate = useNavigate();
  const label = useSelector(
    (state: any) => state.vault.accounts.HDAccount[0].label
  );
  // Browser Back leaves the route even while its modal disallows dismissal.
  leavePage = () => navigate(-1);
  return (
    <Routes>
      <Route path="/home" element={<h1>{label} home</h1>} />
      <Route path="/settings/manage-accounts" element={<ManageAccounts />} />
    </Routes>
  );
};
const openRemoval = (beforeConfirm?: (dialog: HTMLElement) => void) => {
  render(
    <Provider store={mockStore}>
      <MemoryRouter initialEntries={['/home', '/settings/manage-accounts']}>
        <RouteOwner />
      </MemoryRouter>
    </Provider>
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: `buttons.remove: Old wallet account (${TARGET})`,
    })
  );
  const dialog = screen.getByRole('dialog', { name: 'settings.removeAccount' });
  beforeConfirm?.(dialog);
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'removeAccount'],
    [
      1,
      KeyringAccountType.HDAccount,
      expect.objectContaining({ address: TARGET }),
    ]
  );
};
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
  mockEmitter.mockReset();
  mockAlert.error.mockReset();
  mockAlert.success.mockReset();
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: { id: 0, address: ADDRESS, label: 'Old wallet anchor' },
          1: { id: 1, address: TARGET, label: 'Old wallet account' },
        },
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 5700,
        url: 'https://old-wallet-rpc.invalid',
        slip44: 60,
      },
    },
    vaultGlobal: {
      activeSlip44: 60,
      networkStatus: 'idle',
      isSwitchingAccount: false,
    },
  };
  mockStore = configureStore({
    reducer: (state = mockState, action: any) =>
      action.type === 'fixture/replace' ? action.payload : state,
  });
});

it.each(['success', 'error'])(
  'retains %s feedback when the original target disappears while removal is pending',
  async (outcome) => {
    const operation = holdRemoval();
    openRemoval();
    await act(async () => {
      if (outcome === 'success') operation.resolve();
      else operation.reject(new Error('Old wallet removal persistence failed'));
    });
    if (outcome === 'success') {
      expect(mockAlert.success).toHaveBeenCalledWith(
        'settings.accountRemovedSuccessfully'
      );
      expect(mockAlert.error).not.toHaveBeenCalled();
    } else {
      expect(mockAlert.error).toHaveBeenCalledWith(
        'Old wallet removal persistence failed'
      );
      expect(mockAlert.success).not.toHaveBeenCalled();
    }
  }
);

it('shows a retained-account refusal in the same dialog, clears it on retry, and closes only after success', async () => {
  const first = deferred();
  const retry = deferred();
  mockEmitter
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() =>
      retry.promise.then(() => {
        const current = mockStore.getState() as any;
        mockStore.dispatch({
          type: 'fixture/replace',
          payload: {
            ...current,
            vault: {
              ...current.vault,
              accounts: {
                ...current.vault.accounts,
                HDAccount: { 0: current.vault.accounts.HDAccount[0] },
              },
            },
          },
        });
      })
    );

  openRemoval();
  const dialog = screen.getByRole('dialog', { name: 'settings.removeAccount' });
  expect(
    within(dialog).getByRole('button', { name: 'buttons.cancel' })
  ).toBeDisabled();
  await act(async () => {
    first.reject(new Error('Removal persistence failed'));
  });

  expect(
    (mockStore.getState() as any).vault.accounts.HDAccount[1].address
  ).toBe(TARGET);
  expect(within(dialog).getByRole('alert')).toBeVisible();
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Removal persistence failed'
  );
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(mockAlert.success).not.toHaveBeenCalled();

  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  );
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(mockEmitter.mock.calls[1]).toEqual(mockEmitter.mock.calls[0]);
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(
    within(dialog).getByRole('button', { name: 'buttons.cancel' })
  ).toBeDisabled();
  expect(
    screen.getByRole('dialog', { name: 'settings.removeAccount' })
  ).toBeVisible();
  expect(
    (mockStore.getState() as any).vault.accounts.HDAccount[1].address
  ).toBe(TARGET);

  await act(async () => retry.resolve());
  expect(
    screen.queryByRole('dialog', { name: 'settings.removeAccount' })
  ).toBeNull();
  expect(
    (mockStore.getState() as any).vault.accounts.HDAccount[1]
  ).toBeUndefined();
  expect(mockAlert.success).toHaveBeenCalledWith(
    'settings.accountRemovedSuccessfully'
  );
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('requests that the inline refusal be scrolled into view without changing focus', async () => {
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollIntoView'
  );
  const reveal = jest.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: reveal,
  });
  try {
    const operation = deferred();
    mockEmitter.mockReturnValueOnce(operation.promise);
    openRemoval();
    const dialog = screen.getByRole('dialog', {
      name: 'settings.removeAccount',
    });
    const panel = dialog.querySelector<HTMLElement>('[tabindex="-1"]');
    expect(panel).not.toBeNull();
    panel!.focus();
    expect(panel).toHaveFocus();

    await act(async () =>
      operation.reject(new Error('Removal persistence failed'))
    );
    const error = within(dialog).getByRole('alert');
    expect(reveal).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
    expect(reveal.mock.contexts).toContain(error);
    expect(panel).toHaveFocus();
  } finally {
    if (original)
      Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});

it('keeps existing dialog focus while removal is pending and after refusal', async () => {
  const operation = deferred();
  mockEmitter.mockReturnValueOnce(operation.promise);
  let panel: HTMLElement | null = null;
  openRemoval((dialog) => {
    panel = dialog.querySelector<HTMLElement>('[aria-busy]');
    expect(panel).not.toBeNull();
    panel!.focus();
    expect(panel).toHaveFocus();
  });

  const dialog = screen.getByRole('dialog', { name: 'settings.removeAccount' });
  expect(panel).toHaveFocus();
  expect(panel).toHaveAttribute('aria-busy', 'true');
  expect(
    within(dialog).getByRole('button', { name: 'buttons.cancel' })
  ).toBeDisabled();
  expect(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  ).toBeDisabled();
  expect(
    (mockStore.getState() as any).vault.accounts.HDAccount[1].address
  ).toBe(TARGET);

  await act(async () =>
    operation.reject(new Error('Removal persistence failed'))
  );
  expect(
    screen.getByRole('dialog', { name: 'settings.removeAccount' })
  ).toBeVisible();
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Removal persistence failed'
  );
  expect(panel).toHaveFocus();
  expect(panel).toHaveAttribute('aria-busy', 'false');
  expect(
    within(dialog).getByRole('button', { name: 'buttons.cancel' })
  ).toBeEnabled();
  expect(
    within(dialog).getByRole('button', { name: 'buttons.remove' })
  ).toBeEnabled();
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('clears a refusal when the confirmation is cancelled and reopened', async () => {
  const operation = deferred();
  mockEmitter.mockReturnValueOnce(operation.promise);
  openRemoval();
  await act(async () =>
    operation.reject(new Error('Removal persistence failed'))
  );
  const dialog = screen.getByRole('dialog', { name: 'settings.removeAccount' });
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Removal persistence failed'
  );
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.cancel' })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: `buttons.remove: Old wallet account (${TARGET})`,
    })
  );
  const reopened = screen.getByRole('dialog', {
    name: 'settings.removeAccount',
  });
  expect(within(reopened).queryByRole('alert')).toBeNull();
  expect(
    (mockStore.getState() as any).vault.accounts.HDAccount[1].address
  ).toBe(TARGET);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('does not carry a refusal into a newly scoped confirmation', async () => {
  const operation = deferred();
  mockEmitter.mockReturnValueOnce(operation.promise);
  openRemoval();
  await act(async () =>
    operation.reject(new Error('Removal persistence failed'))
  );
  expect(
    within(screen.getByRole('dialog')).getByRole('alert')
  ).toHaveTextContent('Removal persistence failed');

  await act(async () => {
    const current = mockStore.getState() as any;
    mockStore.dispatch({
      type: 'fixture/replace',
      payload: {
        ...current,
        vault: {
          ...current.vault,
          activeNetwork: {
            ...current.vault.activeNetwork,
            chainId: 5701,
            url: 'https://new-wallet-rpc.invalid',
          },
        },
      },
    });
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: `buttons.remove: Old wallet account (${TARGET})`,
    })
  );
  const reopened = screen.getByRole('dialog', {
    name: 'settings.removeAccount',
  });
  expect(within(reopened).queryByRole('alert')).toBeNull();
  expect(
    (mockStore.getState() as any).vault.accounts.HDAccount[1].address
  ).toBe(TARGET);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it.each(['success', 'error'])(
  'does not show old-wallet %s feedback after Browser Back and wallet replacement',
  async (outcome) => {
    const operation = holdRemoval();
    openRemoval();
    await act(async () => {
      const current = mockStore.getState() as any;
      mockStore.dispatch({
        type: 'fixture/replace',
        payload: {
          ...current,
          vault: {
            ...current.vault,
            accounts: {
              HDAccount: {
                0: {
                  id: 0,
                  address: `0x${'33'.repeat(20)}`,
                  label: 'Replacement wallet',
                },
                1: {
                  id: 1,
                  address: `0x${'44'.repeat(20)}`,
                  label: 'Replacement account',
                },
              },
            },
          },
        },
      });
      leavePage();
    });
    expect(
      screen.getByRole('heading', { name: 'Replacement wallet home' })
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      if (outcome === 'success') operation.resolve();
      else operation.reject(new Error('Old wallet removal persistence failed'));
    });
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockAlert.success).not.toHaveBeenCalled();
  }
);
