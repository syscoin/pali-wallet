/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, useNavigate } from 'react-router-dom';

import MainController from 'scripts/Background/controllers/MainController';
import vaultReducer, {
  setAccounts,
  setActiveAccount,
  setActiveNetwork,
} from 'state/vault';
import vaultGlobalReducer, {
  setIsSwitchingAccount,
  switchNetworkError,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import { AccountHeader } from './AccountHeader';

let mockStore: any;
const mockWrite = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockDismiss = jest.fn();
const mockEmitter = jest.fn();
const mockTranslate = (key: string) => key;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
// The status producer does not parse or sign transactions.
jest.mock('syscointx-js', () => ({ bufferUtils: {} }));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringAccountType: {
    HDAccount: 'HDAccount',
    Imported: 'Imported',
    Ledger: 'Ledger',
    Trezor: 'Trezor',
    SmartAccount: 'SmartAccount',
  },
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('hooks/index', () => ({
  useUtils: jest.requireActual('hooks/useUtils').useUtils,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    info: (...args: any[]) => mockInfo(...args),
    error: (...args: any[]) => mockError(...args),
    dismiss: (...args: any[]) => mockDismiss(...args),
  }),
}));
jest.mock('components/index', () => ({
  IconButton: ({ children, onClick, className, ...props }: any) => (
    <button
      onClick={onClick}
      className={className}
      aria-label={props['aria-label']}
    >
      {children}
    </button>
  ),
  Icon: ({ id }: any) => <span id={id} />,
  Tooltip: ({ children }: any) => children,
  ConfirmationModal: () => null,
}));
jest.mock(
  'components/Loader/SkeletonLoader',
  () =>
    function MockSkeletonLoader() {
      return <span>Loading</span>;
    }
);
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  adjustUrl: (value: string) => value,
}));

const TYPE = KeyringAccountType.HDAccount;
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let clock = 2_050_000_000_000;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime((clock += 10_000));
  jest.clearAllMocks();
  mockEmitter.mockImplementation(() => {
    throw new Error('Clipboard controls must not call wallet operations');
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
  const initial = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: false,
        activeAccount: { type: TYPE, id: 0 },
        activeNetwork: {
          kind: INetworkType.Ethereum,
          chainId: 5700,
          slip44: 60,
          currency: 'tsys',
          label: 'Synthetic EVM',
          url: 'https://evm.synthetic.invalid/',
        },
        accounts: {
          ...initial.accounts,
          [TYPE]: {
            0: { id: 0, label: 'Account A', address: A, xpub: 'public-a' },
            1: { id: 1, label: 'Account B', address: B, xpub: 'public-b' },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60 },
    },
  });
});
afterEach(() => {
  expect(mockEmitter).not.toHaveBeenCalled();
  jest.clearAllTimers();
  jest.useRealTimers();
});

const RouteControl = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/settings')}>Navigate</button>;
};
const mount = () =>
  render(
    <Provider store={mockStore}>
      <MemoryRouter
        initialEntries={['/home']}
        future={{
          // eslint-disable-next-line camelcase
          v7_startTransition: true,
          // eslint-disable-next-line camelcase
          v7_relativeSplatPath: true,
        }}
      >
        <AccountHeader />
        <RouteControl />
      </MemoryRouter>
    </Provider>
  );
const copyButton = () =>
  document.querySelector('#copy-address-btn')!.closest('button')!;
const switchAccount = (id: number) => {
  // The normal MainController.setAccount(..., sync=false) dispatches these
  // synchronously; React can batch away the intermediate loading skeleton.
  act(() => {
    mockStore.dispatch(setIsSwitchingAccount(true));
    mockStore.dispatch(setActiveAccount({ type: TYPE, id }));
    mockStore.dispatch(setIsSwitchingAccount(false));
  });
};
const settle = async (
  write: ReturnType<typeof deferred>,
  outcome: 'success' | 'failure'
) => {
  await act(async () => {
    if (outcome === 'success') write.resolve();
    else write.reject(new Error('Synthetic native clipboard refusal'));
  });
  await act(async () => jest.advanceTimersByTimeAsync(0));
};

it('reports a successful current-account copy with the actual hook', async () => {
  const write = deferred();
  mockWrite.mockReturnValue(write.promise);
  mount();
  fireEvent.click(copyButton());
  expect(mockWrite).toHaveBeenCalledWith(A);
  await settle(write, 'success');
  expect(mockInfo).toHaveBeenCalledWith('home.addressCopied', undefined);
  expect(mockError).not.toHaveBeenCalled();
});

it('reports a failed current-account copy with the actual hook', async () => {
  const write = deferred();
  mockWrite.mockReturnValue(write.promise);
  mount();
  fireEvent.click(copyButton());
  await settle(write, 'failure');
  expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockInfo).not.toHaveBeenCalled();
});

describe.each(['success', 'failure'] as const)(
  'pending native %s',
  (outcome) => {
    it.each([
      'account',
      'account ABA',
      'identity',
      'endpoint',
      'route',
      'unmount',
    ])('retires old feedback across %s changes', async (change) => {
      const write = deferred();
      mockWrite.mockReturnValue(write.promise);
      const view = mount();
      const button = copyButton();
      fireEvent.click(button);
      expect(mockWrite).toHaveBeenCalledWith(A);
      if (change === 'account' || change === 'account ABA') {
        switchAccount(1);
        expect(screen.getByText(B)).toBeInTheDocument();
        if (change === 'account ABA') switchAccount(0);
      } else if (change === 'identity') {
        act(() => {
          const accounts = mockStore.getState().vault.accounts;
          mockStore.dispatch(
            setAccounts({
              ...accounts,
              [TYPE]: {
                ...accounts[TYPE],
                0: { ...accounts[TYPE][0], address: B, xpub: 'replacement' },
              },
            })
          );
        });
        expect(screen.getByText(B)).toBeInTheDocument();
      } else if (change === 'endpoint') {
        act(() => {
          mockStore.dispatch(
            setActiveNetwork({
              ...mockStore.getState().vault.activeNetwork,
              url: 'https://replacement.synthetic.invalid/',
            })
          );
        });
      } else if (change === 'route') {
        fireEvent.click(screen.getByText('Navigate'));
      } else view.unmount();
      if (change !== 'unmount') expect(copyButton()).toBe(button);
      await settle(write, outcome);
      expect(mockInfo).not.toHaveBeenCalled();
      expect(mockError).not.toHaveBeenCalled();
      expect(mockDismiss).not.toHaveBeenCalled();
    });
  }
);

it('rechecks a queued success after the active account changes', async () => {
  const write = deferred();
  mockWrite.mockReturnValue(write.promise);
  mount();
  fireEvent.click(copyButton());
  await act(async () => write.resolve());
  expect(mockInfo).not.toHaveBeenCalled();
  switchAccount(1);
  await act(async () => jest.advanceTimersByTimeAsync(0));
  expect(mockInfo).not.toHaveBeenCalled();
  expect(mockDismiss).not.toHaveBeenCalled();
});

it.each(['label', 'balance'])(
  'preserves a pending current-address copy across a healthy %s refresh',
  async (property) => {
    const write = deferred();
    mockWrite.mockReturnValue(write.promise);
    mount();
    fireEvent.click(copyButton());
    act(() => {
      const accounts = mockStore.getState().vault.accounts;
      mockStore.dispatch(
        setAccounts({
          ...accounts,
          [TYPE]: {
            ...accounts[TYPE],
            0: {
              ...accounts[TYPE][0],
              ...(property === 'label'
                ? { label: 'Renamed A' }
                : { balances: { ethereum: 3, syscoin: 0 } }),
            },
          },
        })
      );
    });
    expect(screen.getByText(A)).toBeInTheDocument();
    await settle(write, 'success');
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith('home.addressCopied', undefined);
    expect(mockError).not.toHaveBeenCalled();
  }
);

it('allows a fresh copy of B while the old A promise is still pending', async () => {
  const first = deferred();
  const second = deferred();
  mockWrite
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  mount();
  fireEvent.click(copyButton());
  switchAccount(1);
  fireEvent.click(copyButton());
  expect(mockWrite.mock.calls).toEqual([[A], [B]]);
  await settle(first, 'failure');
  expect(mockError).not.toHaveBeenCalled();
  await settle(second, 'success');
  expect(mockInfo).toHaveBeenCalledTimes(1);
});

it.each(['success', 'failure'] as const)(
  'retains current-address %s feedback when a background balance refresh recovers network status',
  async (outcome) => {
    const write = deferred();
    const balance = deferred();
    mockWrite.mockReturnValue(write.promise);
    mockStore.dispatch(switchNetworkError());
    // Run the actual normal background refresh/status producer. Only its
    // public balance I/O is held; it performs its own error -> idle dispatch.
    const background = Object.create(MainController.prototype);
    Object.assign(background, {
      walletSessionGeneration: 0,
      networkRequestGeneration: 0,
      isUnlocked: () => true,
      getActiveKeyring: () => ({ ethereumTransaction: { web3Provider: {} } }),
      updateUserNativeBalance: () => balance.promise,
    });
    const refresh = background.getLatestUpdateForCurrentAccount(
      true,
      true,
      false,
      true
    );
    mount();
    fireEvent.click(copyButton());
    expect(mockWrite).toHaveBeenCalledWith(A);
    const identity = mockStore.getState().vault;
    await act(async () => {
      balance.resolve();
      await refresh;
    });
    expect(mockStore.getState().vault).toBe(identity);
    expect(mockStore.getState().vaultGlobal.networkStatus).toBe('idle');
    expect(screen.getByText(A)).toBeInTheDocument();
    await settle(write, outcome);
    if (outcome === 'success') {
      expect(mockInfo).toHaveBeenCalledTimes(1);
      expect(mockError).not.toHaveBeenCalled();
    } else {
      expect(mockError).toHaveBeenCalledTimes(1);
      expect(mockInfo).not.toHaveBeenCalled();
    }
  }
);

it('preserves current copy feedback across a same-identity switching indicator', async () => {
  const write = deferred();
  mockWrite.mockReturnValue(write.promise);
  mount();
  fireEvent.click(copyButton());
  act(() => mockStore.dispatch(setIsSwitchingAccount(true)));
  expect(screen.queryByText(A)).toBeNull();
  act(() => mockStore.dispatch(setIsSwitchingAccount(false)));
  expect(screen.getByText(A)).toBeInTheDocument();
  await settle(write, 'success');
  expect(mockInfo).toHaveBeenCalledTimes(1);
  expect(mockError).not.toHaveBeenCalled();
});
