/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React, { useEffect } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import { ConnectionStatusIndicator } from 'components/Header/ConnectionStatusIndicator';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import vault from 'state/vault';
import vaultGlobal from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';

let mockStore: any;
const mockReadBalance = jest.fn();
const mockPersist = jest.fn();
const mockSubmit = jest.fn();
const routes: string[] = [];
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
  persistCommittedWalletState: (...args: any[]) => mockPersist(...args),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('@sidhujag/sysweb3-network', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-network'),
  retryableFetch: () => {
    throw new Error('Public HTTP forbidden in status keyboard proof');
  },
}));

const type = KeyringAccountType.HDAccount;
const network = {
  chainId: 5700,
  kind: 'ethereum',
  url: 'http://127.0.0.1:18545',
  slip44: 60,
  currency: 'SYS',
  label: 'Public status fixture',
};
let controller: any;
const pending = () => {
  let resolve!: (balance: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const advance = async (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
const begin = () => {
  let result!: Promise<boolean>;
  act(() => {
    // Actual production refresh owns loading/error/quality reducers. Only
    // native public balance transport is deferred, as in feedback.spec.tsx.
    result = controller.getLatestUpdateForCurrentAccount();
  });
  return result;
};
const RouteObservation = () => {
  const location = useLocation();
  useEffect(() => {
    routes.push(location.pathname);
  }, [location.pathname]);
  return <output aria-label="Current public route">{location.pathname}</output>;
};

beforeEach(() => {
  jest.useFakeTimers({ now: 1000000 });
  jest.clearAllMocks();
  routes.length = 0;
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  const initial = vault(undefined, { type: 'test/init' });
  const global = vaultGlobal(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault, vaultGlobal },
    preloadedState: {
      vault: {
        ...initial,
        activeNetwork: network,
        isBitcoinBased: false,
        activeAccount: { id: 0, type },
        accounts: {
          ...initial.accounts,
          [type]: {
            0: {
              id: 0,
              address: '0x' + '11'.repeat(20),
              balances: { ethereum: '2', syscoin: -1 },
            },
          },
        },
        accountAssets: { [type]: { 0: { ethereum: [], syscoin: [] } } },
        accountTransactions: {
          [type]: { 0: { ethereum: { 5700: [] }, syscoin: {} } },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60 },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    nativeBalanceRevision: 0,
    balanceLoadingRequestId: 0,
    networkRequestGeneration: 0,
    walletSessionGeneration: 0,
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    cancellablePromises: new CancellablePromises(),
    balancesManager: {
      utils: { getBalanceUpdatedForAccount: mockReadBalance },
    },
    updateAssetsFromCurrentAccount: jest.fn().mockResolvedValue(undefined),
    updateUserTransactionsState: jest.fn().mockResolvedValue(undefined),
    getActiveKeyring: () => ({
      isUnlocked: () => true,
      ethereumTransaction: { web3Provider: {} },
    }),
  });
});
afterEach(() => {
  cleanup();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const mount = async () => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    initImmediate: false,
    lng: 'de',
    fallbackLng: 'en',
    resources: { de: { translation: de }, en: { translation: en } },
    react: { useSuspense: false },
    interpolation: { escapeValue: true },
  });
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Provider store={mockStore}>
        <MemoryRouter
          future={{
            ['v7_startTransition']: true,
            ['v7_relativeSplatPath']: true,
          }}
          initialEntries={['/home']}
        >
          <RouteObservation />
          <Routes>
            <Route
              path="/home"
              element={
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    mockSubmit();
                  }}
                >
                  <button type="button">Before status</button>
                  <ConnectionStatusIndicator />
                  <button type="button">After status</button>
                </form>
              }
            />
            <Route
              path="/chain-fail-to-connect"
              element={<h1>Public connection recovery route</h1>}
            />
          </Routes>
        </MemoryRouter>
      </Provider>
    </I18nextProvider>
  );
  const dot = () =>
    view.container.querySelector('button.status-target > span') as HTMLElement;
  const checkNoExtraActions = (reads: number) => {
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(mockReadBalance).toHaveBeenCalledTimes(reads);
  };
  const showTooltip = async (message: string) => {
    await user.hover(dot());
    await advance(50);
    expect(screen.getByRole('tooltip')).toHaveTextContent(message);
    expect(screen.getByRole('tooltip')).toBeVisible();
  };
  return { user, dot, showTooltip, checkNoExtraActions, i18n };
};

const actionState = async (state: 'error' | 'idle-critical') => {
  const read = pending();
  mockReadBalance.mockReturnValueOnce(read.promise);
  const work = begin();
  await advance(state === 'error' ? 100 : 10000);
  await act(async () => {
    if (state === 'error') read.reject(new Error('Synthetic offline'));
    else read.resolve('2');
    await work;
  });
  const global = mockStore.getState().vaultGlobal;
  expect(global.networkStatus).toBe(state === 'error' ? 'error' : 'idle');
  expect(global.loadingStates.isLoadingBalances).toBe(false);
  if (state === 'idle-critical')
    expect(global.networkQuality.hasCriticalErrors).toBe(true);
  return state === 'error'
    ? de.networkConnection.networkError
    : de.networkConnection.networkCriticalError.replace(
        '{{latency}}',
        de.networkConnection.timeout
      );
};

it.each(['error', 'idle-critical'] as const)(
  '%s healthy: actual refresh outcome has localized tooltip and pointer recovery navigation',
  async (state) => {
    const { user, dot, showTooltip, checkNoExtraActions } = await mount();
    const message = await actionState(state);
    expect(dot()).toHaveClass('bg-red-600', 'cursor-pointer');
    await showTooltip(message);
    await user.click(dot());
    expect(screen.getByRole('heading')).toHaveTextContent(
      'Public connection recovery route'
    );
    expect(
      routes.filter((route) => route === '/chain-fail-to-connect')
    ).toHaveLength(1);
    checkNoExtraActions(1);
  }
);

it.each([
  ['error', '{Enter}'],
  ['error', ' '],
  ['idle-critical', '{Enter}'],
  ['idle-critical', ' '],
] as const)(
  '%s exposes a localized native keyboard action for %j',
  async (state, key) => {
    const { user, dot, showTooltip, checkNoExtraActions } = await mount();
    const message = await actionState(state);
    expect(dot()).toHaveClass('bg-red-600', 'cursor-pointer');
    await showTooltip(message);
    await user.click(screen.getByRole('button', { name: 'Before status' }));
    await user.tab();
    const keyboardTarget = document.activeElement as HTMLElement;
    // Both genuine native key events occur before the BEFORE expectation. The
    // surrounding controls are type=button, so missing focus cannot submit.
    await user.keyboard(key);
    checkNoExtraActions(1);
    expect(keyboardTarget).toHaveAccessibleName(message);
    expect(keyboardTarget).toHaveAttribute('type', 'button');
    expect(screen.getByLabelText('Current public route')).toHaveTextContent(
      '/chain-fail-to-connect'
    );
    expect(
      routes.filter((route) => route === '/chain-fail-to-connect')
    ).toHaveLength(1);
  }
);

it.each([
  'idle',
  'loading',
  'success',
  'pending-slow',
  'pending-critical',
  'idle-slow',
] as const)(
  '%s healthy: nonactionable feedback does not join the keyboard tab order',
  async (state) => {
    const { user, dot, showTooltip, checkNoExtraActions, i18n } = await mount();
    let release: (() => Promise<void>) | undefined;
    let message: string | undefined;
    if (state !== 'idle') {
      const read = pending();
      mockReadBalance.mockReturnValueOnce(read.promise);
      const work = begin();
      const elapsed =
        state === 'pending-slow'
          ? 5000
          : state === 'pending-critical'
          ? 9000
          : state === 'idle-slow'
          ? 1500
          : 100;
      await advance(elapsed);
      release = () =>
        act(async () => {
          read.resolve('2');
          await work;
        });
      if (state === 'success' || state === 'idle-slow') {
        await release();
        release = undefined;
      }
      message =
        state === 'loading'
          ? i18n.t('networkConnection.updatingBalances')
          : state === 'success'
          ? i18n.t('networkConnection.operationCompleted')
          : state === 'pending-slow'
          ? i18n.t('networkConnection.operationSlow', {
              operation: i18n
                .t('networkConnection.operationInProgress')
                .replace('...', ''),
            })
          : state === 'pending-critical'
          ? i18n.t('networkConnection.operationFailing')
          : i18n.t('networkConnection.networkQualitySlow', {
              latency: '1500ms',
            });
    }
    try {
      if (message) await showTooltip(message);
      else expect(dot()).toHaveClass('opacity-0');
      expect(dot()).not.toHaveClass('cursor-pointer');
      await user.click(screen.getByRole('button', { name: 'Before status' }));
      await user.tab();
      expect(
        screen.getByRole('button', { name: 'After status' })
      ).toHaveFocus();
      await user.keyboard('{Enter} ');
      expect(screen.getByLabelText('Current public route')).toHaveTextContent(
        '/home'
      );
      expect(routes).toEqual(['/home']);
      checkNoExtraActions(state === 'idle' ? 0 : 1);
    } finally {
      if (release) await release();
    }
  }
);
