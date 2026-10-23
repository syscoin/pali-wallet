/** @jest-environment jsdom */
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
    // The actual controller publishes removal before awaiting persistence.
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
const openRemoval = () => {
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
  'retains %s feedback for a removal that settles in the current view',
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
