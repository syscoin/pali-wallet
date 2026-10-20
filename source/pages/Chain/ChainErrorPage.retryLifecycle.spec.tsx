/** @jest-environment jsdom */
import '@testing-library/jest-dom';
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
import { Provider, useSelector } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AppLayout } from 'components/Layout/AppLayout';
import { ChainErrorPage } from 'pages/Chain/ChainErrorPage';
import { getController } from 'scripts/Background';
import MainController from 'scripts/Background/controllers/MainController';
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import {
  setActiveSlip44,
  setNetwork,
  startSwitchNetwork,
  switchNetworkSuccess,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
);
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: {
    notifyNetworkChange: jest.fn(),
    notifyAccountChange: jest.fn(),
    cleanup: jest.fn(),
  },
}));
jest.mock('state/store', () => ({
  ...jest.requireActual('state/store'),
  __esModule: true,
  persistCommittedWalletState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: { error: mockError, success: mockSuccess },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: { error: mockError, success: mockSuccess },
  }),
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useBrowsingNavigationScroll', () => ({
  useBrowsingNavigationScroll: jest.fn(),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isLoading: false, isContextChanging: false }),
  isContextSensitiveWalletRoute: () => false,
  normalizeWalletPathname: (path: string) => path,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'networkMenu.evmNetworks': 'EVM networks',
        'networkMenu.utxoNetworks': 'UTXO networks',
      }[key] || key),
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/Header/Menus', () => ({
  NetworkMenu: (props: any) =>
    React.createElement(
      jest.requireActual('components/Header/Menus/NetworkMenu').NetworkMenu,
      props
    ),
  GeneralMenu: () => null,
}));
jest.mock('components/Header', () => ({ AccountHeader: () => null }));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DropdownArrowSvg: () => null,
  BtcIconSvg: () => null,
  EthIconSvg: () => null,
  WhiteSuccessIconSvg: () => null,
  NetworkIconSvg: () => null,
  EditIconSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ErrorModal: () => null,
}));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children, content }: any) => (
    <span data-testid="connection-tooltip" data-content={content}>
      {children}
    </span>
  ),
}));

const A = {
  chainId: 31337,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Synthetic A',
  url: 'https://a.synthetic.invalid',
  currency: 'eth',
};
const B = {
  chainId: 31338,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Synthetic B',
  url: 'https://b.synthetic.invalid',
  currency: 'eth',
};
const mockError = jest.fn(),
  mockSuccess = jest.fn();
let wallet: any,
  resolveA: (value?: any) => void,
  releaseOldError: () => void,
  holdTransport: boolean;
let events: any[];
const mockEmitter = jest.fn();
const originalFetch = globalThis.fetch;
const Location = () => {
  const loc = useLocation(),
    global = useSelector((s: any) => s.vaultGlobal),
    vault = useSelector((s: any) => s.vault);
  return (
    <output data-testid="state">
      {JSON.stringify({
        route: loc.pathname,
        state: loc.state,
        status: global.networkStatus,
        chainId: vault.activeNetwork.chainId,
      })}
    </output>
  );
};
const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/chain-fail-to-connect']}>
        <Location />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/chain-fail-to-connect" element={<ChainErrorPage />} />
            <Route
              path="/settings/networks/custom-rpc"
              element={<p>Current RPC editor route</p>}
            />
            <Route
              path="/switch-network"
              element={<p>Network picker route</p>}
            />
            <Route path="/home" element={<p>Wallet home route</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>
  );
const state = () => JSON.parse(screen.getByTestId('state').textContent!);
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  globalThis.fetch = jest.fn(() => {
    throw new Error('Public HTTP denied');
  }) as any;
  const initial = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...initial,
      activeNetwork: A,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: false,
      accounts: {
        ...initial.accounts,
        HDAccount: {
          0: {
            id: 0,
            address: '0x' + '11'.repeat(20),
            xpub: 'synthetic-public-xpub',
          },
          1: {
            id: 1,
            address: '0x' + '22'.repeat(20),
            xpub: 'synthetic-other-xpub',
          },
        },
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setNetwork({ network: A }));
  store.dispatch(setNetwork({ network: B }));
  store.dispatch(switchNetworkSuccess());
  holdTransport = true;
  events = [];
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    networkRequestGeneration: 0,
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    assetUpdateRequestId: 0,
    isStartingUp: true,
    cancellablePromises: {},
    assertWalletReadyForSigning: jest.fn(),
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    setFiat: jest.fn().mockResolvedValue(undefined),
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(undefined),
    saveWalletState: jest.fn().mockResolvedValue(undefined),
    ensureActiveAccountCompatibleWithNetwork: jest
      .fn()
      .mockResolvedValue(false),
    handleStateChange: jest.fn(),
    handleNetworkChangeError: jest.fn(),
    resetAutoLockTimer: jest.fn(),
    performPostAccountSwitchOperations: jest.fn().mockResolvedValue(undefined),
    setActiveNetworkLogic: (target: any, resolve: any) => {
      // Only the SDK/configuration boundary is synthetic. Public cancellation,
      // currentness checks, success handler and Redux publication remain real.
      store.dispatch(startSwitchNetwork(target));
      if (target.chainId === A.chainId) resolveA = resolve;
      else resolve({ network: target });
    },
  });
  jest.mocked(getController).mockReturnValue({
    wallet,
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  } as any);
  mockEmitter.mockImplementation((methods: string[], params: any[] = []) => {
    if (methods[1] !== 'setActiveNetwork') return Promise.resolve(undefined);
    events.push({ type: 'request', chainId: params[0].chainId });
    const pending = wallet.setActiveNetwork(...params);
    return pending.catch(async (error: any) => {
      events.push({
        type: 'controller-rejected',
        chainId: params[0].chainId,
        reason: String(error?.message || error),
      });
      if (holdTransport && params[0].chainId === A.chainId)
        await new Promise<void>((done) => {
          releaseOldError = done;
        });
      throw error;
    });
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});
const chooseB = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /^Synthetic A/ }));
  await user.click(screen.getByRole('menuitem', { name: 'EVM networks' }));
  await user.click(
    within(screen.getByRole('group', { name: 'EVM networks' })).getByRole(
      'menuitem',
      { name: B.label }
    )
  );
  await waitFor(() =>
    expect(store.getState().vault.activeNetwork.chainId).toBe(B.chainId)
  );
  await waitFor(() =>
    expect(store.getState().vaultGlobal.networkStatus).toBe('idle')
  );
};

it('healthy current retry navigates home after the requested connection succeeds', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await act(async () => {
    resolveA({ network: A });
  });
  await screen.findByText('Wallet home route');
  expect(store.getState().vaultGlobal.networkStatus).toBe('idle');
  expect(mockSuccess).toHaveBeenCalledTimes(1);
  expect(mockError).not.toHaveBeenCalled();
});

it('retains current failure feedback and permits a healthy retry', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Network request timed out'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await waitFor(() =>
    expect(mockError).toHaveBeenCalledWith('chainError.networkTimeout')
  );
  expect(store.getState().vaultGlobal.networkStatus).toBe('error');
  expect(
    screen.getByRole('button', { name: 'buttons.retryConnect' })
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'chainError.goToAnotherNetwork' })
  ).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await act(async () => {
    resolveA({ network: A });
  });
  await screen.findByText('Wallet home route');
  expect(mockSuccess).toHaveBeenCalledTimes(1);
});

it('accepts its own requested-target transition when the initial active network differs', async () => {
  store.dispatch(startSwitchNetwork(B));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await screen.findByText('Wallet home route');
  expect(store.getState().vault.activeNetwork.chainId).toBe(B.chainId);
  expect(mockSuccess).toHaveBeenCalledTimes(1);
  expect(mockError).not.toHaveBeenCalled();
});

it('uses the edited registered RPC and accepts that legitimate activation', async () => {
  const edited = { ...A, url: 'https://edited-a.synthetic.invalid' };
  store.dispatch(setNetwork({ network: edited, isEdit: true }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setActiveNetwork'],
    [edited, true]
  );
  await act(async () => {
    resolveA({ network: edited });
  });
  await screen.findByText('Wallet home route');
  expect(store.getState().vault.activeNetwork.url).toBe(edited.url);
  expect(mockSuccess).toHaveBeenCalledTimes(1);
});

it('accepts its own successful switch when account compatibility selects the fallback', async () => {
  const vault = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...vault,
      activeAccount: { id: 0, type: KeyringAccountType.SmartAccount },
      accounts: {
        ...vault.accounts,
        SmartAccount: {
          0: {
            id: 0,
            address: '0x' + '33'.repeat(20),
            smartAccount: { chainId: A.chainId },
          },
        },
      },
    } as any)
  );
  delete wallet.ensureActiveAccountCompatibleWithNetwork;
  store.dispatch(startSwitchNetwork(B));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await waitFor(() =>
    expect(store.getState().vault.activeAccount).toEqual({
      id: 0,
      type: KeyringAccountType.HDAccount,
    })
  );
  expect(store.getState().vaultGlobal.networkStatus).toBe('idle');
  await screen.findByText('Wallet home route');
  expect(mockSuccess).toHaveBeenCalledTimes(1);
  expect(mockError).not.toHaveBeenCalled();
});

it('does not navigate or alert from a delayed successful reply after Edit leaves the view', async () => {
  let deliver!: () => void;
  const delivery = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  mockEmitter.mockImplementationOnce(
    async (methods: string[], params: any[]) => {
      const result = await wallet.setActiveNetwork(...params);
      await delivery;
      return result;
    }
  );
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await act(async () => {
    resolveA({ network: A });
  });
  await waitFor(() =>
    expect(store.getState().vaultGlobal.networkStatus).toBe('idle')
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'chainError.editCurrentRpc' })
  );
  await screen.findByText('Current RPC editor route');
  await act(async () => {
    deliver();
  });
  expect(state().route).toBe('/settings/networks/custom-rpc');
  expect(mockSuccess).not.toHaveBeenCalled();
  expect(mockError).not.toHaveBeenCalled();
});

it('keeps a new same-view target retry pending when the retired request finally rejects', async () => {
  let resolveB!: (result: any) => void;
  wallet.setActiveNetworkLogic = (target: any, resolve: any) => {
    store.dispatch(startSwitchNetwork(target));
    if (target.chainId === A.chainId) resolveA = resolve;
    else resolveB = resolve;
  };
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  let superseded: Promise<unknown>;
  await act(async () => {
    superseded = wallet.setActiveNetwork(B).catch(() => undefined);
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'buttons.retryConnect' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await act(async () => {
    releaseOldError();
  });
  expect(
    screen.getByRole('button', { name: 'buttons.retryConnect' })
  ).toBeDisabled();
  expect(store.getState().vaultGlobal.networkStatus).toBe('switching');
  expect(mockError).not.toHaveBeenCalled();
  await act(async () => {
    resolveB({ network: B });
    await superseded;
  });
  await screen.findByText('Wallet home route');
  expect(mockSuccess).toHaveBeenCalledTimes(1);
});

it('allows a global reconnection after an ordinary compatible account switch without changing that account', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await act(async () => {
    await wallet.setAccount(1, KeyringAccountType.HDAccount);
  });
  await act(async () => {
    resolveA({ network: A });
  });
  await screen.findByText('Wallet home route');
  expect(store.getState().vault.activeAccount).toEqual({
    id: 1,
    type: KeyringAccountType.HDAccount,
  });
  expect(mockSuccess).toHaveBeenCalledTimes(1);
  expect(mockError).not.toHaveBeenCalled();
});

it('does not publish an old cancellation after public switches return to the same target', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  await act(async () => {
    const superseded = wallet.setActiveNetwork(B).catch(() => undefined);
    const latest = wallet.setActiveNetwork(A);
    resolveA({ network: A });
    await latest;
    await superseded;
  });
  expect(store.getState().vault.activeNetwork.chainId).toBe(A.chainId);
  expect(store.getState().vaultGlobal.networkStatus).toBe('idle');
  await act(async () => {
    releaseOldError();
  });
  expect(store.getState().vaultGlobal.networkStatus).toBe('idle');
  expect(mockError).not.toHaveBeenCalled();
});

it.each(['Network change cancelled', new Error('Network change cancelled')])(
  'does not turn a raw or Error cancellation into a network failure: %p',
  async (cancelled) => {
    mockEmitter.mockImplementationOnce(async () => {
      store.dispatch(switchNetworkSuccess());
      throw cancelled;
    });
    mount();
    fireEvent.click(
      screen.getByRole('button', { name: 'buttons.retryConnect' })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'buttons.retryConnect' })
      ).toBeEnabled()
    );
    expect(store.getState().vaultGlobal.networkStatus).toBe('idle');
    expect(mockError).not.toHaveBeenCalled();
    expect(mockSuccess).not.toHaveBeenCalled();
  }
);
it('ordinary connect-another action preserves its real recovery route state', async () => {
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'chainError.goToAnotherNetwork' })
  );
  await screen.findByText('Network picker route');
  expect(state().state.switchingFromTimeError).toBe(true);
  expect(mockEmitter).not.toHaveBeenCalled();
});
it('public controller cancellation alone preserves the newer healthy network status', async () => {
  holdTransport = false;
  const first = mockEmitter(['wallet', 'setActiveNetwork'], [A, true]).catch(
    () => undefined
  );
  await mockEmitter(['wallet', 'setActiveNetwork'], [B, false]);
  await first;
  expect(store.getState().vault.activeNetwork.chainId).toBe(B.chainId);
  expect(store.getState().vaultGlobal.networkStatus).toBe('idle');
  expect(wallet.handleNetworkChangeError).not.toHaveBeenCalled();
});
it('retired retry must not mark the newer successful network as failed after normal Edit and Close navigation', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.retryConnect' }));
  expect(store.getState().vaultGlobal.networkStatus).toBe('switching');
  const edit = screen.getByRole('button', {
    name: 'chainError.editCurrentRpc',
  });
  expect(edit).toBeEnabled();
  fireEvent.click(edit);
  await screen.findByText('Current RPC editor route');
  expect(state().state.selected.chainId).toBe(A.chainId);
  expect(store.getState().vaultGlobal.networkStatus).toBe('idle');
  fireEvent.click(screen.getByRole('button', { name: 'buttons.close' }));
  await screen.findByText('Wallet home route');
  await chooseB();
  expect(
    events.some(
      (e) => e.type === 'controller-rejected' && e.chainId === A.chainId
    )
  ).toBe(true);
  await act(async () => {
    releaseOldError();
  });
  expect(wallet.handleNetworkChangeError).not.toHaveBeenCalled();
  expect(store.getState().vault.activeNetwork.chainId).toBe(B.chainId);
  expect({
    route: state().route,
    activeChainId: store.getState().vault.activeNetwork.chainId,
    networkStatus: store.getState().vaultGlobal.networkStatus,
    visibleStatus: screen
      .getByTestId('connection-tooltip')
      .getAttribute('data-content'),
  }).toEqual({
    route: '/home',
    activeChainId: B.chainId,
    networkStatus: 'idle',
    visibleStatus: 'networkConnection.operationCompleted',
  });
  expect(mockError).not.toHaveBeenCalled();
});
