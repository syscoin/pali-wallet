/** @jest-environment jsdom */
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React, { StrictMode, useEffect } from 'react';
import { Provider, useSelector } from 'react-redux';

import { WalletBootstrap } from 'components/WalletBootstrap/WalletBootstrap';
import { useRouterLogic } from 'routers/useRouterLogic';
import dappReducer from 'state/dapp';
import { requestWalletState } from 'utils/requestWalletState';

let mockStore: any;
const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
const mockConsumerUnmounted = jest.fn();
const mockTranslate = (key: string) => key;
const mockHydrate = jest.fn((target, state) => {
  target.dispatch({ type: 'test/hydrate', payload: state });
  return Promise.resolve();
});
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('state/rehydrate', () => ({
  rehydrateStore: (target: unknown, state: unknown) =>
    mockHydrate(target, state),
}));
jest.mock('state/vault', () => ({
  rehydrate: (payload: unknown) => ({ type: 'vault/rehydrate', payload }),
  setAccounts: (payload: unknown) => ({ type: 'vault/setAccounts', payload }),
  setActiveAccount: (payload: unknown) => ({
    type: 'vault/setActiveAccount',
    payload,
  }),
  setAccountBalanceSnapshot: (payload: unknown) => ({
    type: 'vault/setAccountBalanceSnapshot',
    payload,
  }),
}));
jest.mock('state/vaultGlobal', () => ({
  setActiveSlip44: (payload: unknown) => ({
    type: 'vaultGlobal/setActiveSlip44',
    payload,
  }),
  setNetworkRuntimeState: (payload: unknown) => ({
    type: 'vaultGlobal/setNetworkRuntimeState',
    payload,
  }),
  setNetworkStatus: (payload: unknown) => ({
    type: 'vaultGlobal/setNetworkStatus',
    payload,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
    controllerEmitter: mockEmitter,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/settings/networks/connected-sites' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('utils/constants', () => ({
  SYSCOIN_UTXO_MAINNET_NETWORK: { chainId: 57 },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: 'public', network: 'fixture' }),
  loadNavigationState: jest.fn().mockResolvedValue(null),
}));
jest.mock('utils/requestWalletState', () => ({
  ...jest.requireActual('utils/requestWalletState'),
  requestWalletState: jest.fn(),
}));

const ORIGIN = 'https://synthetic-connection.invalid';
const initialState = () => ({
  dapp: { dapps: {} },
  vault: {
    isBitcoinBased: true,
    accounts: { HDAccount: { 0: { address: 'public-fixture-address' } } },
    activeAccount: { type: 'HDAccount', id: 0 },
    activeNetwork: { chainId: 57 },
  },
  vaultGlobal: { networkStatus: 'idle' },
});
const RouterConsumer = () => {
  useRouterLogic();
  useEffect(() => () => mockConsumerUnmounted(), []);
  const dapps = useSelector((state: any) => state.dapp.dapps);
  return (
    <output data-testid="connection-hosts">
      {Object.keys(dapps).join(',') || 'none'}
    </output>
  );
};
const Wallet = ({ showRouter = true }: { showRouter?: boolean }) => (
  <Provider store={mockStore}>
    <WalletBootstrap>
      {showRouter ? <RouterConsumer /> : <p>External approval is active</p>}
    </WalletBootstrap>
  </Provider>
);

const originalChrome = global.chrome;
let listeners: Set<(message: any) => unknown>;
let sendMessage: jest.Mock;
const emit = async (message: any) => {
  await act(async () => {
    [...listeners].forEach((listener) => listener(message));
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  mockHydrate.mockReset().mockImplementation((target, state) => {
    target.dispatch({ type: 'test/hydrate', payload: state });
    return Promise.resolve();
  });
  listeners = new Set();
  mockStore = configureStore({
    reducer: (state: any = initialState(), action: any) =>
      action.type === 'test/hydrate'
        ? action.payload
        : { ...state, dapp: dappReducer(state.dapp, action) },
  });
  jest.mocked(requestWalletState).mockResolvedValue(initialState());
  sendMessage = jest.fn((_message, callback) => callback?.());
  global.chrome = {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    },
  } as unknown as typeof chrome;
});
afterEach(() => {
  cleanup();
  global.chrome = originalChrome;
});

it('keeps controller updates subscribed while the guarded router is absent and remounts the latest connection', async () => {
  const view = render(<Wallet />);
  expect((await screen.findByTestId('connection-hosts')).textContent).toBe(
    'none'
  );
  expect(listeners.size).toBe(1);
  view.rerender(<Wallet showRouter={false} />);
  expect(mockConsumerUnmounted).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('connection-hosts')).toBeNull();
  await emit({
    type: 'CONTROLLER_DAPP_STATE_CHANGE',
    data: {
      dapps: {
        [ORIGIN]: { host: ORIGIN, accountId: 0, accountType: 'HDAccount' },
      },
    },
  });
  view.rerender(<Wallet />);
  expect(screen.getByTestId('connection-hosts').textContent).toBe(ORIGIN);
  expect(listeners.size).toBe(1);
  expect(requestWalletState).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(listeners.size).toBe(0);
});

it('subscribes only after authoritative hydration and before polling can publish', async () => {
  let finishHydration!: () => void;
  mockHydrate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishHydration = resolve;
      })
  );
  sendMessage.mockImplementation((_message, callback) => {
    expect(listeners.size).toBe(1);
    callback?.();
  });
  render(<Wallet />);
  await waitFor(() => expect(mockHydrate).toHaveBeenCalledTimes(1));
  expect(listeners.size).toBe(0);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(screen.queryByTestId('connection-hosts')).toBeNull();
  await act(async () => finishHydration());
  expect(screen.getByTestId('connection-hosts').textContent).toBe('none');
  expect(listeners.size).toBe(1);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledWith(
    { type: 'startPolling' },
    expect.any(Function)
  );
});

it('retains one live subscription under Strict Mode and removes it on final unmount', async () => {
  const view = render(
    <StrictMode>
      <Wallet />
    </StrictMode>
  );
  await screen.findByTestId('connection-hosts');
  expect(listeners.size).toBe(1);
  await emit({
    type: 'CONTROLLER_DAPP_STATE_CHANGE',
    data: { dapps: { [ORIGIN]: { host: ORIGIN } } },
  });
  expect(screen.getByTestId('connection-hosts').textContent).toBe(ORIGIN);
  view.unmount();
  expect(listeners.size).toBe(0);
});

it('preserves every incremental controller handler and both network status payload shapes', async () => {
  render(<Wallet />);
  await screen.findByTestId('connection-hosts');
  const dispatch = jest.spyOn(mockStore, 'dispatch');
  const dapps = { dapps: { [ORIGIN]: { host: ORIGIN } } };
  const accounts = { HDAccount: { 0: { address: 'updated-public-address' } } };
  const runtime = { networkStatus: 'connected', isConnected: true };
  const vault = { activeNetwork: { chainId: 1 } };
  const account = { id: 1, type: 'HDAccount' };
  const balance = {
    balances: { ethereum: 5 },
    id: 1,
    nativeBalanceCache: { 1: 5 },
    type: 'HDAccount',
    ignored: true,
  };
  for (const message of [
    { type: 'CONTROLLER_DAPP_STATE_CHANGE', data: dapps },
    { type: 'CONTROLLER_ACCOUNTS_CHANGE', data: accounts },
    { type: 'CONTROLLER_NETWORK_STATUS_CHANGE', data: 'switching' },
    { type: 'CONTROLLER_NETWORK_STATUS_CHANGE', data: runtime },
    {
      type: 'CONTROLLER_NETWORK_CHANGE',
      data: { vault, activeSlip44: 60, networkStatus: 'connected' },
    },
    { type: 'CONTROLLER_ACTIVE_ACCOUNT_CHANGE', data: account },
    { type: 'CONTROLLER_ACCOUNT_BALANCE_CHANGE', data: balance },
  ])
    await emit(message);
  expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'dapp/rehydrate', payload: dapps },
    { type: 'vault/setAccounts', payload: accounts },
    { type: 'vaultGlobal/setNetworkStatus', payload: 'switching' },
    { type: 'vaultGlobal/setNetworkRuntimeState', payload: runtime },
    { type: 'vault/rehydrate', payload: vault },
    { type: 'vaultGlobal/setActiveSlip44', payload: 60 },
    { type: 'vaultGlobal/setNetworkStatus', payload: 'connected' },
    { type: 'vault/setActiveAccount', payload: account },
    {
      type: 'vault/setAccountBalanceSnapshot',
      payload: {
        balances: balance.balances,
        id: balance.id,
        nativeBalanceCache: balance.nativeBalanceCache,
        type: balance.type,
      },
    },
  ]);
  dispatch.mockRestore();
});

it('preserves full-state serialization with only the latest pending snapshot', async () => {
  render(<Wallet />);
  await screen.findByTestId('connection-hosts');
  let finishFirst!: () => void;
  mockHydrate.mockClear().mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishFirst = resolve;
      })
  );
  const first = { ...initialState(), version: 1 };
  const skipped = { ...initialState(), version: 2 };
  const latest = { ...initialState(), version: 3 };
  await emit({ type: 'CONTROLLER_STATE_CHANGE', data: first });
  await emit({ type: 'CONTROLLER_STATE_CHANGE', data: skipped });
  await emit({ type: 'CONTROLLER_STATE_CHANGE', data: latest });
  expect(mockHydrate).toHaveBeenCalledTimes(1);
  expect(mockHydrate.mock.calls[0][1]).toBe(first);
  await act(async () => finishFirst());
  expect(mockHydrate).toHaveBeenCalledTimes(2);
  expect(mockHydrate.mock.calls[1][1]).toBe(latest);
});

it('discards queued follow-up hydration when the bootstrap owner unmounts', async () => {
  const view = render(<Wallet />);
  await screen.findByTestId('connection-hosts');
  let finishFirst!: () => void;
  mockHydrate.mockClear().mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishFirst = resolve;
      })
  );
  await emit({
    type: 'CONTROLLER_STATE_CHANGE',
    data: { ...initialState(), version: 1 },
  });
  await emit({
    type: 'CONTROLLER_STATE_CHANGE',
    data: { ...initialState(), version: 2 },
  });
  view.unmount();
  expect(listeners.size).toBe(0);
  await act(async () => finishFirst());
  expect(mockHydrate).toHaveBeenCalledTimes(1);
});
