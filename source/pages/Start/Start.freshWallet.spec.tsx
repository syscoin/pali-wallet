/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { OnboardingSecretsProvider } from 'hooks/useOnboardingSecrets';

import { Start } from './Start';

const mockEmitter = jest.fn();
const mockReload = jest.fn();
const mockAlertError = jest.fn();
const TICKET = 'synthetic-only-fresh-wallet-admission';
const PASSWORD = 'SyntheticOnly-Password123!';
const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;

jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: false,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/index', () => ({
  useQueryData: () => ({}),
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: { error: mockAlertError },
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: { error: mockAlertError },
  }),
}));
jest.mock('utils/reloadWalletForRecovery', () => ({
  reloadWalletForRecovery: () => mockReload(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { word?: string }) =>
      key === 'start.eraseTypeConfirmation'
        ? `Type ${values?.word} to confirm.`
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('hooks/useToastFooter', () => ({
  useToastFooter: () => jest.requireActual('react').useRef(null),
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => null }));

type TestState = {
  vault: {
    accounts: {
      HDAccount: Record<number, { address: string; id: number }>;
    };
    activeAccount: { id: number; type: 'HDAccount' };
  };
  vaultGlobal: { hasEncryptedVault: boolean };
};
const stateFor = (hasVault: boolean): TestState => ({
  vault: {
    accounts: {
      HDAccount: hasVault
        ? { 0: { id: 0, address: 'synthetic-public-existing-address' } }
        : {},
    },
    activeAccount: { id: 0, type: 'HDAccount' },
  },
  vaultGlobal: { hasEncryptedVault: hasVault },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const mount = (
  entry = '/',
  props: { externalRoute?: string; isExternal?: boolean } = {},
  hasVault = true
) => {
  // A controlled background snapshot drives real react-redux subscriptions.
  // Neither Start, Unlock, the new dialog nor their DOM is mocked.
  const store = configureStore({
    reducer: (state = stateFor(hasVault), action: { type: string }) =>
      action.type === 'test/background-wallet-cleared'
        ? stateFor(false)
        : state,
  });
  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[entry]}>
        <OnboardingSecretsProvider>
          <Routes>
            <Route path="*" element={<Start {...props} />} />
          </Routes>
        </OnboardingSecretsProvider>
      </MemoryRouter>
    </Provider>
  );
  return { store, ...view };
};

const prepareReset = async () => {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'start.eraseAndStartFresh' })
  );
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
  await user.click(
    screen.getByRole('checkbox', { name: 'start.eraseAcknowledge' })
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Type ERASE to confirm.' }),
    'ERASE'
  );
  await user.click(screen.getByRole('button', { name: 'start.eraseConfirm' }));
};

beforeEach(() => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
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
  } as unknown as typeof ResizeObserver;
  jest.clearAllMocks();
  mockEmitter.mockImplementation((methods) => {
    if (methods[1] === 'beginLockedWalletReset') return Promise.resolve(TICKET);
    if (methods[1] === 'resetLockedWallet') return Promise.resolve(true);
    throw new Error('Unexpected controller request');
  });
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
});
afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MessageChannel = originalMessageChannel;
  jest.restoreAllMocks();
});

it('offers fresh start on an ordinary existing-wallet screen, separate from seed recovery', () => {
  mount();
  expect(
    screen.getByRole('button', { name: 'start.eraseAndStartFresh' })
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'start.importUsing' })
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'buttons.unlock' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'start.getStarted' })).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each([
  { entry: '/?route=login', props: {} },
  { entry: '/?data=%7B%22host%22%3A%22dapp.test%22%7D', props: {} },
  { entry: '/?route=', props: {} },
  { entry: '/?externalRoute=login', props: {} },
  { entry: '/?externalRoute=', props: {} },
  { entry: '/external/login', props: {} },
  { entry: '/', props: { isExternal: true } },
  { entry: '/', props: { externalRoute: '/external/send' } },
])(
  'does not offer destructive setup from external auth context $entry / $props',
  ({ entry, props }) => {
    mount(entry, props);
    expect(
      screen.queryByRole('button', { name: 'start.eraseAndStartFresh' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'buttons.unlock' })
    ).toBeVisible();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('keeps the ordinary empty-wallet Create and Import choices without an erase action', () => {
  mount('/', {}, false);
  expect(
    screen.getByRole('button', { name: 'start.getStarted' })
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'start.importWalletSeedPhrase' })
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'start.eraseAndStartFresh' })
  ).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('keeps the reset dialog mounted when the cleared snapshot arrives before the true reset reply', async () => {
  const response = deferred<boolean>();
  mockEmitter.mockImplementation((methods) =>
    methods[1] === 'beginLockedWalletReset'
      ? Promise.resolve(TICKET)
      : response.promise
  );
  const view = mount();
  await prepareReset();
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'resetLockedWallet'],
    [TICKET, 'ERASE'],
    10000,
    false
  );
  act(() => {
    view.store.dispatch({ type: 'test/background-wallet-cleared' });
  });
  expect(view.store.getState()).toEqual(stateFor(false));
  expect(screen.getByRole('dialog')).toHaveAccessibleName('start.eraseConfirm');
  expect(screen.getByRole('button', { name: 'buttons.cancel' })).toBeDisabled();
  expect(document.getElementById('login')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'start.getStarted' })).toBeNull();
  expect(mockReload).not.toHaveBeenCalled();
  await act(async () => response.resolve(true));
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(
    mockEmitter.mock.calls.filter(
      ([methods]) => methods[1] === 'resetLockedWallet'
    )
  ).toHaveLength(1);
});

it('keeps an uncertain reset visible after the cleared snapshot and requires Check wallet', async () => {
  const response = deferred<boolean>();
  mockEmitter.mockImplementation((methods) =>
    methods[1] === 'beginLockedWalletReset'
      ? Promise.resolve(TICKET)
      : response.promise
  );
  const view = mount();
  await prepareReset();
  act(() => {
    view.store.dispatch({ type: 'test/background-wallet-cleared' });
  });
  await act(async () => response.reject(new Error('Delivery was lost')));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('start.eraseUncertain');
  expect(screen.queryByRole('button', { name: 'start.getStarted' })).toBeNull();
  expect(mockReload).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'buttons.checkWallet' }));
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(
    mockEmitter.mock.calls.filter(
      ([methods]) => methods[1] === 'resetLockedWallet'
    )
  ).toHaveLength(1);
});

it('does not admit a fresh-start dialog while an ordinary unlock is pending', async () => {
  const response = deferred<boolean>();
  mockEmitter.mockImplementation((methods) =>
    methods[1] === 'unlockFromController'
      ? response.promise
      : Promise.resolve(TICKET)
  );
  mount();
  const user = userEvent.setup();
  await user.type(document.getElementById('password')!, PASSWORD);
  await user.click(screen.getByRole('button', { name: 'buttons.unlock' }));
  expect(
    screen.getByRole('button', { name: 'start.eraseAndStartFresh' })
  ).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'start.eraseAndStartFresh' })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    mockEmitter.mock.calls.filter(
      ([methods]) => methods[1] === 'beginLockedWalletReset'
    )
  ).toHaveLength(0);
  await act(async () => response.resolve(false));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'start.eraseAndStartFresh' })
    ).toBeEnabled()
  );
});
