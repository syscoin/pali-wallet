/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { webcrypto } from 'crypto';
import React from 'react';
import { Provider } from 'react-redux';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { OnboardingSecretsProvider } from 'hooks/useOnboardingSecrets';
import { Import } from 'pages/Import';
import { Start } from 'pages/Start/Start';
import { ProtectedRoute } from 'routers/ProtectedRoute';
import AuthRoutes from 'routers/routes/AuthRoutes';
import MainController from 'scripts/Background/controllers/MainController';
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import { setActiveSlip44, setHasEncryptedVault } from 'state/vaultGlobal';
import { AsyncMutex } from 'utils/asyncMutex';

let wallet: any;
let keyring: any;
let unlocked = false;
let release!: (canLogin: boolean) => void;
let unlockEntered!: () => void;
let entered: Promise<void>;
const mockAlert = { error: jest.fn() };
const mockEmitter = jest.fn();
const originalChrome = global.chrome;
const originalFetch = global.fetch;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalMessageChannel = globalThis.MessageChannel;
const originalResizeObserver = globalThis.ResizeObserver;
let records: Record<string, any>;
const PASSWORD = 'Synthetic-only-Password123!';
const ADDRESS = '0x1111111111111111111111111111111111111111';
const NETWORK = {
  chainId: 1,
  kind: 'ethereum',
  slip44: 60,
  label: 'Synthetic EVM',
  currency: 'eth',
  url: 'https://synthetic.invalid/',
};
jest.mock('scripts/Background', () => ({
  getController: () => ({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  }),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
);
jest.mock('scripts/Background/controllers/storageManager', () => ({
  StorageManager: {
    getInstance: () => ({ ensureInitialized: async () => undefined }),
  },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn(async () => undefined),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => ({}),
  useUtils: () => ({
    navigate: useNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: useNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => null,
  QuestionCircleOutlined: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  LogoHeader: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));

const Location = () => (
  <output data-testid="route">{useLocation().pathname}</output>
);
const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}>
        <OnboardingSecretsProvider>
          <Location />
          <Routes>
            <Route element={<AuthRoutes />}>
              <Route path="/" element={<Start />} />
              <Route path="/import" element={<Import />} />
            </Route>
            <Route
              path="/home"
              element={<ProtectedRoute element={<h1>Wallet home</h1>} />}
            />
          </Routes>
        </OnboardingSecretsProvider>
      </MemoryRouter>
    </Provider>
  );
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  global.fetch = jest
    .fn()
    .mockRejectedValue(new Error('External HTTP forbidden'));
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
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
  records = {
    'sysweb3-vault': 'synthetic-encrypted-vault',
    'sysweb3-vault-keys': { salt: 'synthetic-salt' },
  };
  const listeners = new Set<(...args: any[]) => void>();
  global.chrome = {
    runtime: {
      id: 'synthetic-unlock-recovery',
      connect: () => ({
        onDisconnect: { addListener: jest.fn(), removeListener: jest.fn() },
        disconnect: jest.fn(),
      }),
      onMessage: {
        addListener: (fn: any) => listeners.add(fn),
        removeListener: (fn: any) => listeners.delete(fn),
      },
    },
    storage: {
      local: {
        get: (keys: any, callback: any) => {
          const wanted =
            keys === null || keys === undefined
              ? Object.keys(records)
              : Array.isArray(keys)
              ? keys
              : [keys];
          callback(
            Object.fromEntries(
              wanted
                .filter((key: string) => key in records)
                .map((key: string) => [key, records[key]])
            )
          );
        },
        set: (items: any, callback: () => void) => {
          Object.assign(records, items);
          callback();
        },
        remove: (keys: string[], callback: () => void) => {
          keys.forEach((key) => delete records[key]);
          callback();
        },
      },
    },
  } as any;
  const vault = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...vault,
      activeNetwork: NETWORK,
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        ...vault.accounts,
        HDAccount: {
          0: {
            id: 0,
            address: ADDRESS,
            xpub: 'synthetic-public-key',
            balances: { ethereum: 0, syscoin: -1 },
          },
        },
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setHasEncryptedVault(true));
  unlocked = false;
  release = undefined as any;
  entered = new Promise<void>((done) => {
    unlockEntered = done;
  });
  keyring = {
    isUnlocked: () => unlocked,
    lockWallet: jest.fn(async () => {
      unlocked = false;
    }),
    unlock: jest.fn((password: string) => {
      expect(password).toBe(PASSWORD);
      unlockEntered();
      return new Promise((done) => {
        release = (canLogin) => {
          unlocked = canLogin;
          done({ canLogin });
        };
      });
    }),
  };
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    networkRequestGeneration: 0,
    isCreatingWallet: false,
    isResettingWallet: false,
    recoveryJournalPending: false,
    authenticationMutex: new AsyncMutex(),
    keyrings: new Map([[60, keyring]]),
    getActiveKeyring: () => keyring,
    MAX_FAILED_ATTEMPTS: 10,
    LOCKOUT_DURATION: 300000,
    RATE_LIMIT_STORAGE_KEY: 'synthetic-rate-limit',
    failedUnlockAttempts: 0,
    lastFailedUnlockTime: 0,
    rateLimitInitialized: false,
    resetAutoLockTimer: jest.fn(),
    startAutoLockTimer: jest.fn().mockResolvedValue(undefined),
    setFiat: jest.fn().mockResolvedValue(undefined),
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(undefined),
  });
  mockEmitter.mockImplementation(
    ([group, method]: string[], params: any[] = []) => {
      expect(group).toBe('wallet');
      if (
        ![
          'isUnlocked',
          'resetAutoLockTimer',
          'unlockFromController',
          'beginWalletRecovery',
        ].includes(method)
      )
        throw new Error('Unexpected controller call: ' + method);
      return Promise.resolve(wallet[method](...params));
    }
  );
});
afterEach(async () => {
  await act(async () => release?.(false));
  cleanup();
  global.chrome = originalChrome;
  global.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  jest.restoreAllMocks();
  jest.useRealTimers();
});
const beginUnlock = async () => {
  const user = userEvent.setup();
  await user.type(document.getElementById('password')!, PASSWORD);
  await user.click(screen.getByRole('button', { name: 'buttons.unlock' }));
  await entered;
  expect(document.getElementById('unlock-btn')).toBeDisabled();
};
const beginRecovery = async () => {
  const user = userEvent.setup();
  await user.click(document.getElementById('import-wallet-link')!);
  await user.click(
    await screen.findByRole('button', { name: 'buttons.recoverWallet' })
  );
  await waitFor(() =>
    expect(screen.getByTestId('route')).toHaveTextContent('/import')
  );
  expect(document.getElementById('import-wallet-input')).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'beginWalletRecovery'
    )
  ).toHaveLength(1);
};

it('ordinary successful unlock reaches the protected home', async () => {
  mount();
  await beginUnlock();
  await act(async () => release(true));
  await waitFor(() =>
    expect(screen.getByTestId('route')).toHaveTextContent('/home')
  );
  expect(screen.getByText('Wallet home')).toBeVisible();
});
it('ordinary rejected password remains on the locked screen and permits retry', async () => {
  mount();
  await beginUnlock();
  await act(async () => release(false));
  await waitFor(() =>
    expect(document.getElementById('unlock-btn')).not.toBeDisabled()
  );
  expect(screen.getByTestId('route').textContent).toBe('/');
  expect(screen.getByText('Invalid password')).toBeVisible();
});
it('ordinary recovery without an outstanding unlock reaches the real import form', async () => {
  mount();
  await beginRecovery();
  expect(keyring.unlock).not.toHaveBeenCalled();
  expect(screen.getByTestId('route').textContent).toBe('/import');
});
it('keeps recovery unavailable while a normal unlock is pending', async () => {
  mount();
  await beginUnlock();
  const recovery = screen.getByRole('button', { name: 'start.importUsing' });
  expect(recovery).toBeDisabled();
  await userEvent.setup().click(recovery);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'beginWalletRecovery'
    )
  ).toHaveLength(0);
  expect(screen.getByTestId('route').textContent).toBe('/');
  await act(async () => release(true));
  await waitFor(() =>
    expect(screen.getByTestId('route')).toHaveTextContent('/home')
  );
  expect(screen.getByText('Wallet home')).toBeVisible();
});

it('allows recovery after a failed pending unlock without a stale success redirect', async () => {
  mount();
  await beginUnlock();
  expect(
    screen.getByRole('button', { name: 'start.importUsing' })
  ).toBeDisabled();
  await act(async () => release(false));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'start.importUsing' })
    ).toBeEnabled()
  );
  expect(screen.getByText('Invalid password')).toBeVisible();
  await beginRecovery();
  expect(screen.getByTestId('route').textContent).toBe('/import');
  expect(document.getElementById('import-wallet-input')).toBeVisible();
});

it('does not enqueue a second password request from duplicate submit events', async () => {
  mount();
  await beginUnlock();
  fireEvent.submit(document.getElementById('login')!);
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'unlockFromController'
    )
  ).toHaveLength(1);
  await act(async () => release(false));
  await waitFor(() =>
    expect(document.getElementById('unlock-btn')).not.toBeDisabled()
  );
  expect(keyring.unlock).toHaveBeenCalledTimes(1);
});

it.each(['{Enter}', ' '])(
  'opens recovery through the native button with %s',
  async (key) => {
    mount();
    const recovery = screen.getByRole('button', { name: 'start.importUsing' });
    expect(recovery).toBeEnabled();
    recovery.focus();
    await userEvent.setup().keyboard(key);
    await userEvent
      .setup()
      .click(
        await screen.findByRole('button', { name: 'buttons.recoverWallet' })
      );
    await waitFor(() =>
      expect(document.getElementById('import-wallet-input')).toBeVisible()
    );
    expect(keyring.unlock).not.toHaveBeenCalled();
    expect(screen.getByTestId('route').textContent).toBe('/import');
  }
);

const realTimedTransport = () => {
  const replies: Array<{ method: string; promise: Promise<unknown> }> = [];
  const actualEmitter = jest.requireActual(
    'scripts/Background/controllers/controllerEmitter'
  ).controllerEmitter;
  mockEmitter.mockImplementation(actualEmitter);
  (chrome.runtime as any).sendMessage = (
    message: any,
    callback: (response: unknown) => void
  ) => {
    expect(message.type).toBe('CONTROLLER_ACTION');
    const [group, method] = message.data.methods;
    expect(group).toBe('wallet');
    expect([
      'isUnlocked',
      'resetAutoLockTimer',
      'unlockFromController',
      'beginWalletRecovery',
    ]).toContain(method);
    const promise = Promise.resolve().then(() =>
      wallet[method](...message.data.params)
    );
    replies.push({ method, promise });
    void promise.then(callback, (error: Error) =>
      callback({ success: false, error: error.message })
    );
  };
  return replies;
};
const startTimedUnlock = async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await user.type(document.getElementById('password')!, PASSWORD);
  await user.click(screen.getByRole('button', { name: 'buttons.unlock' }));
  await entered;
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.getElementById('unlock-btn')).toBeDisabled();
  await act(async () => jest.advanceTimersByTimeAsync(9999));
  expect(document.getElementById('unlock-btn')).toBeDisabled();
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(screen.getByText('Network request timed out')).toBeVisible();
  expect(document.getElementById('unlock-btn')).toBeEnabled();
  expect(document.getElementById('import-wallet-link')).toBeEnabled();
  expect(wallet.isUnlocked()).toBe(false);
  return user;
};

it.each([true, false])(
  'does not begin recovery after a real transport timeout while background authentication is pending (late success=%s)',
  async (lateSuccess) => {
    const replies = realTimedTransport();
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    mount();
    const user = await startTimedUnlock();
    await user.click(document.getElementById('import-wallet-link')!);
    await user.click(
      await screen.findByRole('button', { name: 'buttons.recoverWallet' })
    );
    await act(async () => jest.advanceTimersByTimeAsync(10000));
    expect(screen.getByTestId('route').textContent).toBe('/');
    expect(document.getElementById('import-wallet-input')).toBeNull();
    expect(document.getElementById('confirm-import-btn')).toBeEnabled();
    expect(mockAlert.error).toHaveBeenCalledWith(
      'settings.walletRecoveryFailed'
    );
    const unlock = replies.find(
      (reply) => reply.method === 'unlockFromController'
    )!.promise;
    const recovery = replies.find(
      (reply) => reply.method === 'beginWalletRecovery'
    )!.promise;
    await act(async () => {
      release(lateSuccess);
      await unlock.catch(() => undefined);
      await recovery.catch(() => undefined);
    });
    expect(screen.getByTestId('route').textContent).toBe('/');
    expect(document.getElementById('import-wallet-input')).toBeNull();
    expect(wallet.isUnlocked()).toBe(lateSuccess);
    if (lateSuccess) {
      await expect(recovery).rejects.toThrow(
        'Lock the wallet before starting seed recovery'
      );
      await user.click(document.getElementById('cancel-import-btn')!);
      expect(document.getElementById('import-wallet-link')).toBeEnabled();
    } else {
      await expect(recovery).resolves.toMatch(/^[a-f0-9]{64}$/);
      await user.click(document.getElementById('confirm-import-btn')!);
      const retried = replies
        .filter((reply) => reply.method === 'beginWalletRecovery')
        .at(-1)!.promise;
      await act(async () => {
        await retried;
      });
      await waitFor(() =>
        expect(document.getElementById('import-wallet-input')).toBeVisible()
      );
      expect(screen.getByTestId('route').textContent).toBe('/import');
    }
  }
);

it('keeps the ordinary real-message wrong-password response and subsequent recovery usable', async () => {
  const replies = realTimedTransport();
  mount();
  await beginUnlock();
  const unlock = replies.find(
    (reply) => reply.method === 'unlockFromController'
  )!.promise;
  await act(async () => {
    release(false);
    await unlock.catch(() => undefined);
  });
  expect(screen.getByText('Invalid password')).toBeVisible();
  expect(screen.queryByText('Network request timed out')).toBeNull();
  expect(document.getElementById('import-wallet-link')).toBeEnabled();
  await beginRecovery();
});

it('rejects queued recovery when its admitted wallet session changes', async () => {
  let resume!: () => void;
  const held = new Promise<void>((resolve) => (resume = resolve));
  const occupying = wallet.authenticationMutex.runExclusive(() => held);
  await Promise.resolve();
  const read = jest.spyOn(chrome.storage.local, 'get');
  const recovery = wallet.beginWalletRecovery();
  const rejected = expect(recovery).rejects.toThrow('Wallet session changed');
  // Lock, reset and account/network transitions invalidate this exact epoch.
  wallet.walletSessionGeneration += 1;
  resume();
  await occupying;
  await rejected;
  expect(read).not.toHaveBeenCalled();
});
