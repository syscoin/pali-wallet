/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React, { useLayoutEffect } from 'react';
import { Provider, useSelector } from 'react-redux';

import { ConnectionStatusIndicator } from 'components/Header/ConnectionStatusIndicator';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import vault from 'state/vault';
import vaultGlobal from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';

let mockStore: any;
const mockNavigate = jest.fn();
const mockReadBalance = jest.fn();
const mockT = (key: string) => key;
let observations: Array<{ loading: boolean; message: string | null }> = [];
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children, content }: any) => (
    <div data-testid="indicator-tooltip" data-content={content || ''}>
      {children}
    </div>
  ),
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
    throw new Error('Public HTTP forbidden in feedback probe');
  },
}));
const type = KeyringAccountType.HDAccount;
const network = {
  chainId: 5700,
  kind: 'ethereum',
  url: 'https://synthetic.invalid',
  slip44: 60,
  currency: 'SYS',
  label: 'Synthetic EVM',
};
let controller: any;
const pending = () => {
  let resolve!: (balance: string) => void, reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tooltip = () => screen.getByTestId('indicator-tooltip');
const indicator = () => tooltip().querySelector('div')!;
const advance = async (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
const begin = () => {
  let result!: Promise<boolean>;
  // Same public method invoked by MasterController.refresh; only balance I/O
  // is deferred. The real method controls loading, quality and status reducers.
  act(() => {
    result = controller.getLatestUpdateForCurrentAccount();
  });
  return result;
};
const ObserveActivity = () => {
  const loading = useSelector(
    (state: any) => state.vaultGlobal.loadingStates.isLoadingBalances
  );
  useLayoutEffect(() => {
    observations.push({
      loading,
      message: tooltip().getAttribute('data-content'),
    });
  }, [loading]);
  return <ConnectionStatusIndicator />;
};
beforeEach(() => {
  jest.useFakeTimers({ now: 1000000 });
  jest.clearAllMocks();
  observations = [];
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  const initial = vault(undefined, { type: 'test/init' }),
    global = vaultGlobal(undefined, { type: 'test/init' });
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
  render(
    <Provider store={mockStore}>
      <ObserveActivity />
    </Provider>
  );
});
afterEach(() => {
  cleanup();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});
it('idle indicator is not presented as activity', () => {
  expect(tooltip()).toHaveAttribute('data-content', '');
  expect(indicator()).toHaveClass('opacity-0');
});
it('one current refresh progresses to success then hides', async () => {
  const read = pending();
  mockReadBalance.mockReturnValueOnce(read.promise);
  const work = begin();
  expect(tooltip()).toHaveAttribute(
    'data-content',
    'networkConnection.updatingBalances'
  );
  expect(indicator()).toHaveClass('bg-brand-blue500');
  await advance(100);
  await act(async () => {
    read.resolve('2');
    await work;
  });
  expect(tooltip()).toHaveAttribute(
    'data-content',
    'networkConnection.operationCompleted'
  );
  expect(indicator()).toHaveClass('bg-green-500');
  await advance(2000);
  expect(tooltip()).toHaveAttribute('data-content', '');
});
it('a first pending refresh shows slow and critical feedback', async () => {
  const read = pending();
  mockReadBalance.mockReturnValueOnce(read.promise);
  const work = begin();
  try {
    await advance(5000);
    expect(indicator()).toHaveClass('bg-orange-500');
    await advance(4000);
    expect(tooltip()).toHaveAttribute(
      'data-content',
      'networkConnection.operationFailing'
    );
    expect(indicator()).toHaveClass('bg-red-600');
  } finally {
    await act(async () => {
      read.resolve('2');
      await work;
    });
  }
});
it('an actual current refresh failure remains an actionable error', async () => {
  const read = pending();
  mockReadBalance.mockReturnValueOnce(read.promise);
  const work = begin();
  await advance(100);
  await act(async () => {
    read.reject(new Error('Synthetic offline'));
    await work;
  });
  expect(mockStore.getState().vaultGlobal.networkStatus).toBe('error');
  expect(tooltip()).toHaveAttribute(
    'data-content',
    'networkConnection.networkError'
  );
  expect(indicator()).toHaveClass('bg-red-600');
  fireEvent.click(indicator());
  expect(mockNavigate).toHaveBeenCalledWith('/chain-fail-to-connect');
});
it.each([0, 350, 6250, 9500])(
  'a second real pending refresh must not retain the prior success after %sms',
  async (elapsed) => {
    const first = pending();
    mockReadBalance.mockReturnValueOnce(first.promise);
    const initial = begin();
    await advance(100);
    await act(async () => {
      first.resolve('2');
      await initial;
    });
    expect(tooltip()).toHaveAttribute(
      'data-content',
      'networkConnection.operationCompleted'
    );
    const second = pending();
    mockReadBalance.mockReturnValueOnce(second.promise);
    const work = begin();
    try {
      // Layout effects see the committed frame before passive success retirement.
      expect(
        observations.filter((entry) => entry.loading).at(-1)?.message
      ).toBe('networkConnection.updatingBalances');
      await advance(elapsed);
      expect(
        mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
      ).toBe(true);
      expect(mockReadBalance).toHaveBeenCalledTimes(2);
      expect(tooltip()).toHaveAttribute(
        'data-content',
        elapsed >= 9000
          ? 'networkConnection.operationFailing'
          : elapsed >= 5000
          ? 'networkConnection.operationSlow'
          : 'networkConnection.updatingBalances'
      );
      expect(indicator()).not.toHaveClass('bg-green-500');
    } finally {
      await act(async () => {
        second.resolve('2');
        await work;
      });
    }
  }
);

it.each([
  [1500, 'bg-orange-500', 'networkConnection.networkQualitySlow'],
  [10000, 'bg-red-600', 'networkConnection.networkCriticalError'],
])(
  'retains completed quality feedback after %sms',
  async (elapsed, color, message) => {
    const read = pending();
    mockReadBalance.mockReturnValueOnce(read.promise);
    const work = begin();
    await advance(Number(elapsed));
    await act(async () => {
      read.resolve('2');
      await work;
    });
    expect(indicator()).toHaveClass(String(color));
    expect(tooltip()).toHaveAttribute('data-content', String(message));
  }
);

it('gives the second completed refresh its own full success interval', async () => {
  const first = pending();
  mockReadBalance.mockReturnValueOnce(first.promise);
  const initial = begin();
  await advance(100);
  await act(async () => {
    first.resolve('2');
    await initial;
  });
  const second = pending();
  mockReadBalance.mockReturnValueOnce(second.promise);
  const work = begin();
  await advance(350);
  await act(async () => {
    second.resolve('2');
    await work;
  });
  await advance(1999);
  expect(tooltip()).toHaveAttribute(
    'data-content',
    'networkConnection.operationCompleted'
  );
  await advance(1);
  expect(tooltip()).toHaveAttribute('data-content', '');
});
