/** @jest-environment jsdom */
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import React from 'react';
import { Provider } from 'react-redux';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { AppLayout } from 'components/Layout/AppLayout';
import { useControllerStateSync } from 'hooks/useControllerStateSync';
import { Faucet } from 'pages/Faucet/Faucet';
import { useFaucetComponentStates } from 'pages/Faucet/hooks/useFaucetComponentStates';
import { useRouterLogic } from 'routers/useRouterLogic';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import priceReducer from 'state/price';
import vaultReducer, { setAccounts, setActiveAccount } from 'state/vault';
import vaultGlobalReducer, {
  setActiveSlip44,
  startSwitchNetwork,
} from 'state/vaultGlobal';
import { INetworkType } from 'types/network';

let mockStore: any;
let sendFastStatePatches: (...args: any[]) => boolean;
let mockBackgroundStore: any;
let mockQueueMessages = false;
const mockEmitter = jest.fn().mockResolvedValue(undefined);
const mockCopy = jest.fn();
const mockAlarms = jest.fn();
const mockTranslate = (key: string, values: Record<string, unknown> = {}) => {
  const messages = jest.requireActual('../../assets/locales/en.json');
  const value = key
    .split('.')
    .reduce((entry: any, part) => entry?.[part], messages);
  return typeof value === 'string'
    ? value.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) =>
        String(values[name])
      )
    : key;
};
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    create: () => ({
      get: () => {
        throw new Error('DENY auxiliary HTTP');
      },
    }),
  },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => (mockBackgroundStore || mockStore)?.getState(),
    dispatch: (action: any) =>
      (mockBackgroundStore || mockStore).dispatch(action),
    subscribe: (listener: () => void) => mockStore.subscribe(listener),
  },
  persistCommittedWalletState: jest.fn().mockResolvedValue(undefined),
}));
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
jest.mock('scripts/Background', () => ({
  getController: () => ({ dapp: { disconnect: jest.fn() } }),
  notificationManager: {
    cleanup: jest.fn(),
    notifyAccountChange: jest.fn(),
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
    notifyNetworkChange: jest.fn(),
  },
}));
jest.mock(
  'utils/syscoinPsbtValues',
  () =>
    new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('DENY signing/PSBT path');
        },
      }
    )
);
jest.mock('state/rehydrate', () => ({
  rehydrateStore: jest
    .fn()
    .mockRejectedValue(new Error('Unexpected full hydration')),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: { language: 'en' } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    connectionUnavailable: false,
    isUnlocked: true,
    isLoading: false,
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    useCopyClipboard: () => [false, mockCopy],
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
  }),
}));
jest.mock('utils/alarmUtils', () => ({
  createTemporaryAlarm: (value: any) => mockAlarms(value),
}));
jest.mock('components/Header/Header', () => ({
  Header: () => (
    <nav>Persistent header (non-Home menus disabled in production)</nav>
  ),
}));
jest.mock('components/Loading/PageLoadingOverlay', () => ({
  PageLoadingOverlay: () => null,
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('components/ChainIcon', () => ({
  ChainIcon: ({ chainId, networkKind }: any) => (
    <span data-testid="chain-icon">
      {networkKind}:{chainId}
    </span>
  ),
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => null }));
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('hooks/useAppReady', () => ({ useAppReady: () => undefined }));

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const UTXO_ADDRESS = 'tsys1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpmtdx9f';
const HASH = `0x${'ab'.repeat(32)}`;
const NETWORK = {
  chainId: 5700,
  kind: INetworkType.Ethereum,
  slip44: 60,
  currency: 'tsys',
  label: 'Syscoin NEVM Testnet',
  url: 'https://synthetic-nevm.invalid',
};
const ROLLUX = {
  ...NETWORK,
  chainId: 570,
  currency: 'sys',
  label: 'Rollux',
  url: 'https://synthetic-rollux.invalid',
};
const UNSUPPORTED = {
  ...NETWORK,
  chainId: 1,
  currency: 'eth',
  label: 'Synthetic unsupported',
  url: 'https://synthetic-other.invalid',
};
const UTXO = {
  ...NETWORK,
  kind: INetworkType.Syscoin,
  slip44: 1,
  label: 'Syscoin UTXO Testnet',
  url: 'https://synthetic-blockbook.invalid',
};
const initialState = () => {
  const vault = vaultReducer(undefined, { type: 'init' });
  const vaultGlobal = vaultGlobalReducer(undefined, { type: 'init' });
  return {
    vault: {
      ...vault,
      activeNetwork: NETWORK,
      activeChain: INetworkType.Ethereum,
      isBitcoinBased: false,
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        ...vault.accounts,
        HDAccount: {
          0: {
            ...vault.accounts.HDAccount[0],
            id: 0,
            label: 'Public A',
            address: A,
            xpub: 'public-fixture-A',
            balances: { ethereum: 0, syscoin: -1 },
          },
          1: {
            ...vault.accounts.HDAccount[0],
            id: 1,
            label: 'Public B',
            address: B,
            xpub: 'public-fixture-B',
            balances: { ethereum: 0, syscoin: -1 },
          },
        },
      },
    },
    vaultGlobal: {
      ...vaultGlobal,
      activeSlip44: 60,
      networkStatus: 'idle',
      isSwitchingAccount: false,
      isPollingUpdate: false,
      loadingStates: { ...vaultGlobal.loadingStates, isLoadingBalances: false },
    },
    price: { fiat: { asset: 'usd', price: 0 } },
    dapp: { dapps: {} },
  };
};
const fixtureReducer = combineReducers({
  vault: vaultReducer,
  vaultGlobal: vaultGlobalReducer,
  price: priceReducer,
  dapp: (state: { dapps: Record<string, unknown> } = { dapps: {} }) => state,
});
const makeStore = (preloadedState = initialState()) =>
  configureStore({
    reducer: fixtureReducer,
    preloadedState: preloadedState as ReturnType<typeof fixtureReducer>,
  });
const listeners = new Set<(message: any) => void>();
let sentMessages: any[];
let routeNavigate: ReturnType<typeof useNavigate>;
const originalChrome = global.chrome;
const SyncAndRoute = () => {
  useControllerStateSync(true);
  useRouterLogic();
  routeNavigate = useNavigate();
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
};
const mount = async () =>
  act(async () => {
    render(
      <Provider store={mockStore}>
        <MemoryRouter initialEntries={['/faucet']}>
          <SyncAndRoute />
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/faucet" element={<Faucet />} />
              <Route path="/home" element={<p>Home after normal Close</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  });
// Model another ordinary wallet view completing a switch/selection: build the
// public snapshot using the actual reducers, then use the actual background
// patch producer and live frontend listener. No private controller result or
// arbitrary child props are replaced. This never performs a switch/RPC itself.
const publish = async (
  change: (background: ReturnType<typeof makeStore>) => void
) => {
  const previous = mockStore.getState();
  const background = makeStore(previous);
  change(background);
  await act(async () => {
    sendFastStatePatches(previous, background.getState());
  });
};
// Same public MainController method called by NetworkMenu, with only the
// keyring/provider configuration, persistence, notifications and refresh I/O
// fenced. Real admission/cancellation/success/compatibility/reducer and
// background patch code execute. A separate frontend store receives only the
// resulting normal public messages, just as another already-open document.
const publishNetwork = async (network: any, utxoAddress?: string) => {
  const background = makeStore(mockStore.getState());
  let previous = background.getState();
  const offset = sentMessages.length;
  const unsubscribe = background.subscribe(() => {
    const next = background.getState();
    sendFastStatePatches(previous, next);
    previous = next;
  });
  const controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    networkRequestGeneration: 0,
    walletSessionGeneration: 0,
    fiatQuoteGeneration: 0,
    walletStateGeneration: 0,
    assetUpdateRequestId: 0,
    nativeBalanceRevision: 0,
    balanceLoadingRequestId: 0,
    activeRapidPolls: new Map(),
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    receiptBalanceRefresh: { cancel: jest.fn() },
    cancellablePromises: new CancellablePromises(),
    getActiveKeyring: () => ({ isUnlocked: () => true }),
    setFiat: jest.fn().mockResolvedValue(undefined),
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(undefined),
    saveWalletState: jest.fn().mockResolvedValue(undefined),
    isStartingUp: false,
    handleStateChange: jest.fn(),
    setActiveNetworkLogic: (target: any, resolve: () => void) => {
      background.dispatch(startSwitchNetwork(target));
      if (utxoAddress) {
        const accounts = background.getState().vault.accounts;
        background.dispatch(
          setAccounts({
            ...accounts,
            HDAccount: {
              ...accounts.HDAccount,
              0: { ...accounts.HDAccount[0], address: utxoAddress },
            },
          } as any)
        );
      }
      background.dispatch(setActiveSlip44(target.slip44));
      resolve();
    },
  });
  mockBackgroundStore = background;
  mockQueueMessages = true;
  try {
    const result = await controller.setActiveNetwork(network);
    expect(result).toEqual(
      expect.objectContaining({
        chainId: `0x${network.chainId.toString(16)}`,
        networkVersion: network.chainId,
      })
    );
    expect(background.getState().vaultGlobal.networkStatus).toBe('idle');
    await Promise.resolve();
  } finally {
    unsubscribe();
    mockBackgroundStore = undefined;
    mockQueueMessages = false;
  }
  await act(async () => {
    for (const message of sentMessages.slice(offset))
      for (const listener of listeners) listener(message);
  });
};
const request = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Request Now' }));
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  (axios.get as jest.Mock).mockReturnValueOnce(promise);
  return async (
    value: any = { data: { data: { status: true, hash: HASH } } }
  ) => {
    await act(async () => {
      resolve(value);
      await promise;
    });
  };
};
const selectAccountB = () =>
  publish((background) => {
    background.dispatch(setActiveAccount({ id: 1, type: 'HDAccount' as any }));
  });
const changeAccountAddress = () =>
  publish((background) => {
    const accounts = background.getState().vault.accounts;
    background.dispatch(
      setAccounts({
        ...accounts,
        HDAccount: {
          ...accounts.HDAccount,
          0: { ...accounts.HDAccount[0], address: B },
        },
      } as any)
    );
  });
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation((method: string[]) =>
    Promise.resolve(
      method.join('.') === 'wallet.getProviderStatus'
        ? { serverHasAnError: false }
        : undefined
    )
  );
  mockStore = makeStore();
  sendFastStatePatches = jest.requireActual(
    'scripts/Background/handlers/handleStateChanges'
  ).sendFastStatePatches;
  sentMessages = [];
  mockBackgroundStore = undefined;
  mockQueueMessages = false;
  listeners.clear();
  global.chrome = {
    runtime: {
      sendMessage: (message: any, callback?: () => void) => {
        sentMessages.push(message);
        if (!mockQueueMessages)
          for (const listener of listeners) listener(message);
        callback?.();
      },
      onMessage: {
        addListener: (listener: any) => listeners.add(listener),
        removeListener: (listener: any) => listeners.delete(listener),
      },
    },
  } as any;
  (axios.get as jest.Mock).mockReset().mockImplementation(() => {
    throw new Error('DENY unplanned faucet HTTP');
  });
});
afterEach(() => {
  cleanup();
  global.chrome = originalChrome;
  expect(listeners.size).toBe(0);
});

it('healthy: matching network/address success keeps the exact hash, wording and copy target', async () => {
  await mount();
  expect(screen.getByText('Public A')).toBeTruthy();
  const finish = deferred();
  request();
  expect(axios.get).toHaveBeenCalledWith(
    `https://chains.tools/api/faucet/claim?networkKey=nevm-testnet&walletAddress=${A}`
  );
  await finish();
  expect(
    screen.getByText(
      'Some $TSYS has just been sent to your Syscoin NEVM Testnet wallet.'
    )
  ).toBeTruthy();
  fireEvent.click(screen.getByText(HASH));
  expect(mockCopy).toHaveBeenCalledWith(HASH);
  expect(mockEmitter).toHaveBeenCalledWith(['callGetLatestUpdateForAccount']);
  expect(mockAlarms).toHaveBeenCalledWith(
    expect.objectContaining({ delayInSeconds: 10 })
  );
});

// The existing clipboard-hook boundary records action reachability and exact
// payload, not OS clipboard acceptance or success-modal timing.
it.each([
  ['Enter', '{Enter}'],
  ['Space', ' '],
])(
  'faucet hash copy is reachable by Tab and activated with %s',
  async (_, key) => {
    const user = userEvent.setup();
    await mount();
    const finish = deferred();
    request();
    await finish();
    const copy = screen.getByRole('button', {
      name: mockTranslate('buttons.copy'),
    });
    expect(copy.textContent).toBe(HASH);
    expect(copy.getAttribute('type')).toBe('button');
    expect(copy.parentElement?.classList.contains('max-w-full')).toBe(true);
    for (let i = 0; i < 20 && document.activeElement !== copy; i++)
      await user.tab();
    expect(document.activeElement).toBe(copy);
    expect(mockCopy).not.toHaveBeenCalled();
    await user.keyboard(key);
    expect(mockCopy).toHaveBeenCalledTimes(1);
    expect(mockCopy).toHaveBeenCalledWith(HASH);
    expect(axios.get).toHaveBeenCalledTimes(1);
  }
);

it('faucet hash copy leaves the request contract noninteractive', async () => {
  const user = userEvent.setup();
  await mount();
  const contract = screen.getByText(
    mockTranslate('send.smartContract')
  ).nextElementSibling;
  expect(contract?.tagName).toBe('P');
  expect(contract?.parentElement?.classList.contains('max-w-full')).toBe(true);
  expect(contract?.parentElement?.classList.contains('min-h-[76px]')).toBe(
    true
  );
  expect(contract?.parentElement?.classList.contains('h-[76px]')).toBe(false);
  expect(contract?.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
  expect(contract?.classList.contains('overflow-hidden')).toBe(false);
  expect(contract?.getAttribute('href')).toBeNull();
  expect(contract?.getAttribute('role')).toBeNull();
  expect((contract as HTMLElement).tabIndex).toBe(-1);
  expect(
    screen.queryByRole('button', { name: mockTranslate('buttons.copy') })
  ).toBeNull();
  await user.click(contract as HTMLElement);
  for (let i = 0; i < 8; i++) {
    await user.tab();
    expect(document.activeElement).not.toBe(contract);
  }
  expect(mockCopy).not.toHaveBeenCalled();
  expect(axios.get).not.toHaveBeenCalled();
});

it('faucet success retains native keyboard Close navigation without copying', async () => {
  const user = userEvent.setup();
  await mount();
  const finish = deferred();
  request();
  await finish();
  const close = screen.getAllByRole('button', { name: /^Close$/ }).at(-1)!;
  for (let i = 0; i < 20 && document.activeElement !== close; i++)
    await user.tab();
  expect(document.activeElement).toBe(close);
  await user.keyboard('{Enter}');
  expect(screen.getByText('Home after normal Close')).toBeTruthy();
  expect(mockCopy).not.toHaveBeenCalled();
  expect(axios.get).toHaveBeenCalledTimes(1);
});

it('healthy: a completed supported-network change before request uses the latest target', async () => {
  await mount();
  await publishNetwork(ROLLUX);
  expect(screen.getByTestId('pathname').textContent).toBe('/faucet');
  expect(
    sentMessages.some((message) => message.type === 'CONTROLLER_NETWORK_CHANGE')
  ).toBe(true);
  const finish = deferred();
  request();
  expect(axios.get).toHaveBeenCalledWith(
    `https://chains.tools/api/faucet/claim?networkKey=rollux-mainnet&walletAddress=${A}`
  );
  await finish();
  expect(
    screen.getByText('Some $SYS has just been sent to your Rollux wallet.')
  ).toBeTruthy();
});

it('healthy: a completed account change before request targets the newly displayed account', async () => {
  await mount();
  await publish((background) => {
    background.dispatch(setActiveAccount({ id: 1, type: 'HDAccount' as any }));
  });
  expect(screen.getByText('Public B')).toBeTruthy();
  expect(
    sentMessages.some(
      (message) => message.type === 'CONTROLLER_ACTIVE_ACCOUNT_CHANGE'
    )
  ).toBe(true);
  const finish = deferred();
  request();
  expect(axios.get).toHaveBeenCalledWith(
    `https://chains.tools/api/faucet/claim?networkKey=nevm-testnet&walletAddress=${B}`
  );
  await finish();
  expect(screen.getByText(HASH)).toBeTruthy();
});

it('healthy: leaving and reopening uses a fresh request view and ignores old success in the new view', async () => {
  await mount();
  const finish = deferred();
  request();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByText('Home after normal Close')).toBeTruthy();
  await act(async () => {
    routeNavigate('/faucet');
  });
  await finish();
  expect(screen.getByRole('button', { name: 'Request Now' })).toBeTruthy();
  expect(screen.queryByText(HASH)).toBeNull();
});

it('desired: a pending prior-network success is not attributed to the newly selected network', async () => {
  await mount();
  const finish = deferred();
  request();
  await publishNetwork(ROLLUX);
  await finish();
  expect(screen.getByTestId('pathname').textContent).toBe('/faucet');
  expect(axios.get).toHaveBeenCalledWith(
    `https://chains.tools/api/faucet/claim?networkKey=nevm-testnet&walletAddress=${A}`
  );
  expect(
    screen.queryByText('Some $SYS has just been sent to your Rollux wallet.')
  ).toBeNull();
});

it('desired: settling onto an unsupported EVM chain cannot retain an enabled faucet request', async () => {
  await mount();
  await publishNetwork(UNSUPPORTED);
  expect(screen.getByTestId('pathname').textContent).toBe('/home');
  const button = screen.queryByRole('button', { name: 'Request Now' });
  if (button && !(button as HTMLButtonElement).disabled) {
    const finish = deferred();
    fireEvent.click(button);
    await finish();
  }
  expect(axios.get).not.toHaveBeenCalled();
});

it('desired: settling onto UTXO with the same numeric chain ID cannot request the NEVM faucet', async () => {
  await mount();
  await publishNetwork(UTXO, UTXO_ADDRESS);
  expect(mockStore.getState().vault.isBitcoinBased).toBe(true);
  expect(mockStore.getState().vault.accounts.HDAccount[0].address).toBe(
    UTXO_ADDRESS
  );
  const button = screen.queryByRole('button', { name: 'Request Now' });
  if (button && !(button as HTMLButtonElement).disabled) {
    const finish = deferred();
    fireEvent.click(button);
    await finish();
  }
  expect(axios.get).not.toHaveBeenCalled();
});

it('healthy: actual switching status patch keeps same-view faucet actions inert without claiming', async () => {
  await mount();
  await publish((background) => {
    background.dispatch(startSwitchNetwork(ROLLUX));
  });
  const requestButton = screen.getByRole('button', { name: 'Request Now' });
  expect(requestButton.closest('[inert]')).not.toBeNull();
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('switching');
  expect(axios.get).not.toHaveBeenCalled();
});

it.each(['selection', 'address', 'type'])(
  'retires pending success after account %s changes',
  async (change) => {
    await mount();
    const finish = deferred();
    request();
    if (change === 'selection') await selectAccountB();
    else if (change === 'address') await changeAccountAddress();
    else
      await publish((background) => {
        const accounts = background.getState().vault.accounts;
        background.dispatch(
          setAccounts({
            ...accounts,
            Imported: { 0: { ...accounts.HDAccount[0] } },
          } as any)
        );
        background.dispatch(
          setActiveAccount({ id: 0, type: 'Imported' as any })
        );
      });
    await finish();
    expect(screen.queryByText(HASH)).toBeNull();
    expect(screen.getByRole('button', { name: 'Request Now' })).toBeTruthy();
    expect(mockAlarms).not.toHaveBeenCalled();
  }
);

it('retires pending error after account selection changes', async () => {
  await mount();
  const finish = deferred();
  request();
  await selectAccountB();
  await finish({
    data: { data: { status: false, message: 'Old account refusal' } },
  });
  expect(screen.queryByText('Old account refusal')).toBeNull();
  expect(screen.getByText('Public B')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Request Now' })).toBeTruthy();
});

it('retires pending success after only the RPC URL changes', async () => {
  await mount();
  const finish = deferred();
  request();
  await publishNetwork({ ...NETWORK, url: 'https://other-nevm.invalid' });
  await finish();
  expect(screen.queryByText(HASH)).toBeNull();
  expect(screen.getByRole('button', { name: 'Request Now' })).toBeTruthy();
  expect(mockAlarms).not.toHaveBeenCalled();
});

it('does not revive a pending request after network A to B to A', async () => {
  await mount();
  const finish = deferred();
  request();
  await publishNetwork(ROLLUX);
  await publishNetwork(NETWORK);
  await finish();
  expect(screen.queryByText(HASH)).toBeNull();
  expect(screen.getByRole('button', { name: 'Request Now' })).toBeTruthy();
  expect(mockAlarms).not.toHaveBeenCalled();
});

it('keeps a new account request pending when an older account response arrives', async () => {
  await mount();
  const oldFinish = deferred();
  request();
  await selectAccountB();
  const currentFinish = deferred();
  request();
  await oldFinish();
  expect(screen.queryByText(HASH)).toBeNull();
  expect(screen.getByText(mockTranslate('faucet.pleaseWait'))).toBeTruthy();
  const currentHash = `0x${'cd'.repeat(32)}`;
  await currentFinish({ data: { data: { status: true, hash: currentHash } } });
  expect(screen.getByText(currentHash)).toBeTruthy();
  expect(axios.get).toHaveBeenLastCalledWith(
    `https://chains.tools/api/faucet/claim?networkKey=nevm-testnet&walletAddress=${B}`
  );
});

it('refreshes the same account once immediately and once when its delayed alarm fires', async () => {
  await mount();
  const finish = deferred();
  request();
  await finish();
  const refreshes = () =>
    mockEmitter.mock.calls.filter(
      ([method]) => method[0] === 'callGetLatestUpdateForAccount'
    ).length;
  expect(refreshes()).toBe(1);
  await act(async () => {
    await mockAlarms.mock.calls[0][0].callback();
  });
  expect(refreshes()).toBe(2);
});

it.each(['account', 'network', 'unmount'])(
  'does not refresh a retired %s from the old delayed alarm',
  async (departure) => {
    await mount();
    const finish = deferred();
    request();
    await finish();
    const callback = mockAlarms.mock.calls[0][0].callback;
    if (departure === 'account') await selectAccountB();
    if (departure === 'network') await publishNetwork(ROLLUX);
    if (departure === 'unmount')
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    mockEmitter.mockClear();
    await act(async () => {
      await callback();
    });
    expect(mockEmitter).not.toHaveBeenCalledWith([
      'callGetLatestUpdateForAccount',
    ]);
  }
);

it('preserves the current failure and opens only the official external fallback', async () => {
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  try {
    await mount();
    const finish = deferred();
    request();
    await finish({
      data: { data: { status: false, message: 'Current refusal' } },
    });
    expect(screen.getByText('Current refusal')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: mockTranslate('faucet.grabTokens') })
    );
    expect(open).toHaveBeenCalledWith(
      'https://faucet.syscoin.org',
      '_blank',
      'noopener,noreferrer'
    );
    expect(mockAlarms).not.toHaveBeenCalled();
  } finally {
    open.mockRestore();
  }
});

it('admits only one request from a retained same-render callback', async () => {
  let actions: ReturnType<typeof useFaucetComponentStates>;
  const Actions = () => {
    actions = useFaucetComponentStates();
    return null;
  };
  render(
    <Provider store={mockStore}>
      <MemoryRouter>
        <Actions />
      </MemoryRouter>
    </Provider>
  );
  const finish = deferred();
  act(() => {
    actions.handleRequestFaucet();
    actions.handleRequestFaucet();
  });
  expect(axios.get).toHaveBeenCalledTimes(1);
  await finish();
});

it('does not revive success when two account patches arrive in one React batch', async () => {
  await mount();
  const finish = deferred();
  request();
  const previous = mockStore.getState();
  const background = makeStore(previous);
  background.dispatch(setActiveAccount({ id: 1, type: 'HDAccount' as any }));
  const middle = background.getState();
  background.dispatch(setActiveAccount({ id: 0, type: 'HDAccount' as any }));
  await act(async () => {
    sendFastStatePatches(previous, middle);
    sendFastStatePatches(middle, background.getState());
  });
  await finish();
  expect(screen.queryByText(HASH)).toBeNull();
  expect(screen.getByRole('button', { name: 'Request Now' })).toBeTruthy();
  expect(mockAlarms).not.toHaveBeenCalled();
});

it.each([
  ['generated', 'Account 1'],
  ['renamed', 'Family savings — travel and rainy-day fund 2026'],
])(
  'keeps %s account identity in an intrinsic-height request card without requesting funds',
  async (_state, label) => {
    const user = userEvent.setup();
    const preloaded = initialState();
    preloaded.vault.accounts.HDAccount[0].label = label;
    mockStore = makeStore(preloaded);
    const accountsBefore = mockStore.getState().vault.accounts;
    const networkBefore = mockStore.getState().vault.activeNetwork;
    await mount();

    // JSDOM checks the intrinsic layout contract, not painted pixel geometry.
    // The paired normal-UI screenshots qualify actual wrapping and clearance.
    const heading = screen.getByRole('heading', { name: label, level: 1 });
    const column = heading.parentElement!;
    const card = column.parentElement!;
    for (const className of [
      'w-[352px]',
      'max-w-full',
      'min-h-[70px]',
      'px-4',
      'py-2',
      'items-center',
    ])
      expect(card.classList.contains(className)).toBe(true);
    expect(card.classList.contains('h-[70px]')).toBe(false);
    expect(card.classList.contains('p-4')).toBe(false);
    for (const className of ['flex', 'min-w-0', 'flex-1', 'flex-col'])
      expect(column.classList.contains(className)).toBe(true);
    for (const className of [
      'text-white',
      'text-base',
      'font-medium',
      '[overflow-wrap:anywhere]',
    ])
      expect(heading.classList.contains(className)).toBe(true);
    expect(heading.textContent).toBe(label);
    const address = screen.getByText(`${A.slice(0, 8)}...${A.slice(-8)}`);
    expect(address.parentElement).toBe(column);
    expect(address.classList.contains('text-xs')).toBe(true);
    const identicon = card.querySelector('.add-identicon')!;
    for (const className of ['ml-1', 'mr-2', 'shrink-0'])
      expect(identicon.classList.contains(className)).toBe(true);
    expect(identicon.classList.contains('my-2')).toBe(false);
    const svg = identicon.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('50');
    expect(svg.getAttribute('height')).toBe('50');
    const requestButton = screen.getByRole('button', { name: 'Request Now' });
    expect((requestButton as HTMLButtonElement).disabled).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();

    const close = screen.getByRole('button', { name: 'Close' });
    for (let i = 0; i < 20 && document.activeElement !== close; i++)
      await user.tab();
    expect(document.activeElement).toBe(close);
    await user.keyboard('{Enter}');
    expect(screen.getByText('Home after normal Close')).toBeTruthy();
    expect(mockStore.getState().vault.accounts).toEqual(accountsBefore);
    expect(mockStore.getState().vault.activeNetwork).toEqual(networkBefore);
    expect(axios.get).not.toHaveBeenCalled();
    expect(mockCopy).not.toHaveBeenCalled();
    expect(mockAlarms).not.toHaveBeenCalled();
  }
);
