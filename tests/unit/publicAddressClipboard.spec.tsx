/** @jest-environment jsdom */
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AppLayout } from 'components/Layout/AppLayout';
import { Receive } from 'pages/Receive/Receive';
import EditAccount from 'pages/Settings/EditAccount';
import vaultReducer, { rehydrate, setActiveAccount } from 'state/vault';
import vaultGlobalReducer, {
  setActiveSlip44,
  setIsSwitchingAccount,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockStore: any;
const mockWrite = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    success: (...args: any[]) => mockSuccess(...args),
    error: (...args: any[]) => mockError(...args),
    dismiss: jest.fn(),
  }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: () => 'transactions.copyFailed' },
}));
jest.mock('hooks/index', () => ({
  useUtils: jest.requireActual('hooks/useUtils').useUtils,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    connectionUnavailable: false,
    controllerEmitter: () => {
      throw new Error(
        'Public clipboard test must not submit a controller request'
      );
    },
  }),
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: () => undefined }));
jest.mock('components/Header/Header', () => ({
  Header: () => <header>Wallet header</header>,
}));
jest.mock('components/Loading/PageLoadingOverlay', () => ({
  PageLoadingOverlay: () => null,
}));
jest.mock('components/Icon/Icon', () => ({ LockIconSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Icon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Button: jest.requireActual('components/Button/Button').Button,
  PageActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: any) => <svg aria-label={value} />,
}));

const TYPE = KeyringAccountType.HDAccount;
const A = `0x${'11'.repeat(20)}`;
const B = `0x${'22'.repeat(20)}`;
let clock = 2_300_000_000_000;
const originalMessageChannel = globalThis.MessageChannel;
beforeAll(() => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
});
const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  await act(async () => Promise.resolve());
  await act(async () => jest.advanceTimersByTimeAsync(0));
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime((clock += 10_000));
  jest.clearAllMocks();
  mockWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  });
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...vault,
        activeAccount: { type: TYPE, id: 0 },
        activeNetwork: {
          kind: INetworkType.Ethereum,
          chainId: 1,
          slip44: 60,
          label: 'Ethereum',
          currency: 'eth',
          url: 'https://rpc.synthetic.invalid/',
        },
        accounts: {
          ...vault.accounts,
          [TYPE]: {
            0: { id: 0, address: A, xpub: 'public-xpub-a', label: 'Account A' },
            1: { id: 1, address: B, xpub: 'public-xpub-b', label: 'Account B' },
          },
        },
      } as any,
      vaultGlobal: {
        ...global,
        activeSlip44: 60,
        networkStatus: 'idle',
        isSwitchingAccount: false,
        loadingStates: { ...global.loadingStates, isLoadingBalances: false },
      },
    },
  });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
const mount = (route: 'receive' | 'edit') =>
  render(
    <Provider store={mockStore}>
      <MemoryRouter
        initialEntries={[
          {
            pathname:
              route === 'receive' ? '/receive' : '/settings/edit-account',
            state: { id: 0, accountType: TYPE },
          },
        ]}
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
      >
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/receive" element={<Receive />} />
            <Route path="/settings/edit-account" element={<EditAccount />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>
  );
const clickCopy = () =>
  fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
const selectWithoutAwait = (id = 1) => {
  // MainController.setAccount(sync=false) publishes these synchronously.
  mockStore.dispatch(setIsSwitchingAccount(true));
  mockStore.dispatch(setActiveAccount({ type: TYPE, id }));
  mockStore.dispatch(setIsSwitchingAccount(false));
};
const replaceVaultAddress = () => {
  const previous = mockStore.getState().vault;
  mockStore.dispatch(setIsSwitchingAccount(true));
  mockStore.dispatch(setActiveSlip44(1));
  mockStore.dispatch(
    rehydrate({
      ...previous,
      activeNetwork: {
        ...previous.activeNetwork,
        kind: INetworkType.Syscoin,
        slip44: 1,
        chainId: 5700,
        label: 'Syscoin Testnet',
        currency: 'tsys',
      },
      isBitcoinBased: true,
      accounts: {
        ...previous.accounts,
        [TYPE]: {
          0: {
            ...previous.accounts[TYPE][0],
            address: B,
            xpub: 'public-testnet-xpub',
            label: 'New vault A',
          },
        },
      },
    })
  );
  mockStore.dispatch(setIsSwitchingAccount(false));
};

it('keeps Receive copy feedback out of a new account after a normal batched switch', async () => {
  const held = deferred();
  mockWrite.mockReturnValueOnce(held.promise);
  const view = mount('receive');
  const originalQr = view.container.querySelector('#qr-code');
  clickCopy();
  expect(mockWrite).toHaveBeenCalledWith(A);
  act(() => selectWithoutAwait());
  expect(screen.getByText(B)).toBeTruthy();
  expect(view.container.querySelector('#qr-code')).toBe(originalQr);
  await act(async () => held.resolve());
  await flush();
  expect(mockSuccess).not.toHaveBeenCalled();
});

it('does unmount Receive while switching state is actually exposed to React', async () => {
  const held = deferred();
  mockWrite.mockReturnValueOnce(held.promise);
  const view = mount('receive');
  const originalQr = view.container.querySelector('#qr-code');
  clickCopy();
  act(() => mockStore.dispatch(setIsSwitchingAccount(true)));
  expect(view.container.querySelector('#qr-code')).toBeNull();
  act(() => {
    mockStore.dispatch(setActiveAccount({ type: TYPE, id: 1 }));
    mockStore.dispatch(setIsSwitchingAccount(false));
  });
  expect(screen.getByText(B)).toBeTruthy();
  expect(view.container.querySelector('#qr-code')).not.toBe(originalQr);
  await act(async () => held.resolve());
  await flush();
  expect(mockSuccess).not.toHaveBeenCalled();
});

it('keeps queued Receive copy success out of a newly selected account', async () => {
  const held = deferred();
  mockWrite.mockReturnValueOnce(held.promise);
  mount('receive');
  clickCopy();
  await act(async () => held.resolve());
  expect(mockSuccess).not.toHaveBeenCalled();
  act(() => selectWithoutAwait());
  await flush();
  expect(screen.getByText(B)).toBeTruthy();
  expect(mockSuccess).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'retires a held EditAccount %s when the normal vault load replaces its address',
  async (result) => {
    const held = deferred();
    mockWrite.mockReturnValueOnce(held.promise);
    const view = mount('edit');
    const originalForm = view.container.querySelector('form');
    clickCopy();
    expect(mockWrite).toHaveBeenCalledWith(A);
    act(replaceVaultAddress);
    expect(view.container.querySelector('form')).toBe(originalForm);
    expect(screen.getByTitle(B)).toBeTruthy();
    await act(async () => {
      if (result === 'resolve') held.resolve();
      else held.reject(new Error('Old clipboard refusal'));
    });
    await flush();
    expect(screen.queryByText('components.copied')).toBeNull();
    expect(mockError).not.toHaveBeenCalled();
  }
);

it('retains healthy current Receive copy success', async () => {
  mount('receive');
  clickCopy();
  await flush();
  expect(mockWrite).toHaveBeenCalledWith(A);
  expect(mockSuccess).toHaveBeenCalledWith('home.addressCopied', undefined);
});

it('retains healthy current EditAccount copied indicator and denial', async () => {
  mount('edit');
  clickCopy();
  await flush();
  expect(mockWrite).toHaveBeenCalledWith(A);
  expect(screen.getByText('components.copied')).toBeTruthy();
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  mockWrite.mockRejectedValueOnce(new Error('Current clipboard refusal'));
  clickCopy();
  await flush();
  expect(mockError).toHaveBeenCalledTimes(1);
  expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
});

it.each(['resolve', 'reject'] as const)(
  'retires a Receive %s across a real batched A -> B -> A selection',
  async (result) => {
    const held = deferred();
    mockWrite.mockReturnValueOnce(held.promise);
    const view = mount('receive');
    const originalQr = view.container.querySelector('#qr-code');
    clickCopy();
    act(() => selectWithoutAwait());
    expect(screen.getByText(B)).toBeTruthy();
    act(() => selectWithoutAwait(0));
    expect(screen.getByText(A)).toBeTruthy();
    expect(view.container.querySelector('#qr-code')).toBe(originalQr);
    await act(async () => {
      if (result === 'resolve') held.resolve();
      else held.reject(new Error('Retired copy'));
    });
    await flush();
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
    clickCopy();
    await flush();
    expect(mockSuccess).toHaveBeenCalledTimes(1);
  }
);

it.each(['resolve', 'reject'] as const)(
  'retires an EditAccount %s across an address A -> B -> A vault round trip',
  async (result) => {
    const held = deferred();
    mockWrite.mockReturnValueOnce(held.promise);
    const originalVault = mockStore.getState().vault;
    const view = mount('edit');
    const originalForm = view.container.querySelector('form');
    clickCopy();
    act(replaceVaultAddress);
    expect(screen.getByTitle(B)).toBeTruthy();
    act(() => {
      mockStore.dispatch(setActiveSlip44(60));
      mockStore.dispatch(rehydrate(originalVault));
    });
    expect(screen.getByTitle(A)).toBeTruthy();
    expect(view.container.querySelector('form')).toBe(originalForm);
    await act(async () => {
      if (result === 'resolve') held.resolve();
      else held.reject(new Error('Retired copy'));
    });
    await flush();
    expect(screen.queryByText('components.copied')).toBeNull();
    expect(mockError).not.toHaveBeenCalled();
    clickCopy();
    await flush();
    expect(screen.getByText('components.copied')).toBeTruthy();
  }
);

it('resets an already-copied EditAccount indicator when the displayed address changes', async () => {
  mount('edit');
  clickCopy();
  await flush();
  expect(screen.getByText('components.copied')).toBeTruthy();
  act(replaceVaultAddress);
  expect(screen.getByTitle(B)).toBeTruthy();
  expect(screen.queryByText('components.copied')).toBeNull();
});

it.each(['receive', 'edit'] as const)(
  'retires a late clipboard refusal after leaving the %s route',
  async (route) => {
    const held = deferred();
    mockWrite.mockReturnValueOnce(held.promise);
    const view = mount(route);
    clickCopy();
    view.unmount();
    await act(async () => held.reject(new Error('Unmounted copy')));
    await flush();
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  }
);

it('preserves current Receive refusal exactly once without success', async () => {
  mockWrite.mockRejectedValueOnce(new Error('Current copy refused'));
  mount('receive');
  clickCopy();
  await flush();
  expect(mockError).toHaveBeenCalledTimes(1);
  expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockSuccess).not.toHaveBeenCalled();
});
