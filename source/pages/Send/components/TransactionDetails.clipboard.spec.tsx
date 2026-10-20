/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import store from 'state/store';
import {
  restoreVaultSnapshot,
  setActiveAccount,
  setNetworkChange,
} from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import { TransactionDetailsComponent } from './TransactionDetails';

const mockWrite = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
const mockDismiss = jest.fn();
const FROM = `0x${'11'.repeat(20)}`;
const TO = `0x${'22'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const initialVault = clone(store.getState().vault);
let clock = 1_920_000_000_000;

jest.mock('hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => jest.fn(),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: async () => ({ isBlacklisted: false }),
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    info: (...args: any[]) => mockInfo(...args),
    error: (...args: any[]) => mockError(...args),
    success: jest.fn(),
    dismiss: (...args: any[]) => mockDismiss(...args),
  }),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
};

// Ordinary SendTransaction Details props, rendered with the actual Redux
// store, IconButton and clipboard hook. Only native clipboard IO is controlled.
const contents = (from = FROM, to = TO) => (
  <Provider store={store}>
    <TransactionDetailsComponent
      tx={{ from, to, value: '1', nonce: 0 } as any}
      decodedTx={{ method: 'Transfer' } as any}
      fee={{
        baseFee: 1,
        gasLimit: 21000,
        maxFeePerGas: 2,
        maxPriorityFeePerGas: 1,
      }}
      customFee={{
        isCustom: false,
        gasLimit: 0,
        gasPrice: 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
      }}
      setCustomFee={jest.fn()}
      setCustomNonce={jest.fn()}
      setFee={jest.fn()}
      setHaveError={jest.fn()}
      setIsOpen={jest.fn()}
    />
  </Provider>
);
const clickCopy = (field = 0) =>
  fireEvent.click(screen.getAllByRole('button')[field]);
const flush = async () => {
  // Keep native settlement/React effects separate from toast delivery.
  await act(async () => Promise.resolve());
  await act(async () => jest.advanceTimersByTimeAsync(0));
};

beforeEach(() => {
  jest.useFakeTimers();
  clock += 60_000;
  jest.setSystemTime(clock);
  jest.clearAllMocks();
  mockWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
  store.dispatch(
    restoreVaultSnapshot({
      ...clone(initialVault),
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        slip44: 60,
        currency: 'eth',
        label: 'Synthetic Ethereum',
        url: 'https://rpc.synthetic.invalid',
      },
      accounts: {
        ...initialVault.accounts,
        [KeyringAccountType.HDAccount]: {
          0: { ...initialVault.accounts.HDAccount[0], id: 0, address: FROM },
          1: { ...initialVault.accounts.HDAccount[0], id: 1, address: OTHER },
        },
      },
    })
  );
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('does not report an address copied while its native write is still pending', async () => {
  const pending = deferred();
  mockWrite.mockReturnValueOnce(pending.promise);
  render(contents());
  clickCopy();
  expect(mockWrite).toHaveBeenCalledWith(FROM);
  await flush();
  expect(mockInfo).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await flush();
  expect(mockInfo).toHaveBeenCalledTimes(1);
});

it('does not report copied for a refused native address write', async () => {
  mockWrite.mockRejectedValueOnce(new Error('Synthetic clipboard denied'));
  render(contents());
  clickCopy(1);
  await flush();
  expect(mockWrite).toHaveBeenCalledWith(TO);
  expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockInfo).not.toHaveBeenCalled();
});

it.each([0, 1])(
  'preserves healthy exact address copy for field %s',
  async (field) => {
    render(contents());
    clickCopy(field);
    await flush();
    expect(mockWrite).toHaveBeenCalledWith(field === 0 ? FROM : TO);
    expect(mockInfo).toHaveBeenCalledWith('home.addressCopied', undefined);
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockError).not.toHaveBeenCalled();
  }
);

it.each(['resolve', 'reject'] as const)(
  'retires a pending %s when retained review address props change',
  async (outcome) => {
    const pending = deferred();
    mockWrite.mockReturnValueOnce(pending.promise);
    const view = render(contents());
    const firstButton = screen.getAllByRole('button')[0];
    clickCopy();
    view.rerender(contents(OTHER, TO));
    expect(screen.getAllByRole('button')[0]).toBe(firstButton);
    await act(async () => {
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(new Error('Old review refused'));
    });
    await flush();
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
    clickCopy();
    await flush();
    expect(mockWrite).toHaveBeenLastCalledWith(OTHER);
    expect(mockInfo).toHaveBeenCalledTimes(1);
  }
);

it.each(['account', 'endpoint', 'aba'] as const)(
  'retires pending feedback after a real Redux %s scope change',
  async (change) => {
    const pending = deferred();
    mockWrite.mockReturnValueOnce(pending.promise);
    render(contents());
    clickCopy();
    if (change === 'endpoint') {
      act(() =>
        store.dispatch(
          setNetworkChange({
            activeNetwork: {
              ...store.getState().vault.activeNetwork,
              url: 'https://second.synthetic.invalid',
            },
          })
        )
      );
    } else {
      act(() =>
        store.dispatch(
          setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
        )
      );
      if (change === 'aba') {
        act(() =>
          store.dispatch(
            setActiveAccount({ id: 0, type: KeyringAccountType.HDAccount })
          )
        );
      }
    }
    await act(async () => pending.resolve());
    await flush();
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  }
);

it('retires an accepted copy notice still queued when review props change', async () => {
  const view = render(contents());
  clickCopy();
  await act(async () => Promise.resolve());
  expect(mockInfo).not.toHaveBeenCalled();
  view.rerender(contents(FROM, OTHER));
  await flush();
  expect(mockInfo).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'retires the pending native %s on unmount',
  async (outcome) => {
    const pending = deferred();
    mockWrite.mockReturnValueOnce(pending.promise);
    const view = render(contents());
    clickCopy();
    view.unmount();
    await act(async () => {
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(new Error('Closed review refused'));
    });
    await flush();
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  }
);

it('does not let an earlier success replace the newest copy refusal', async () => {
  const pending = deferred();
  mockWrite.mockReturnValueOnce(pending.promise);
  mockWrite.mockRejectedValueOnce(new Error('Latest refused'));
  render(contents());
  clickCopy();
  clickCopy(1);
  await flush();
  await act(async () => pending.resolve());
  await flush();
  expect(mockError).toHaveBeenCalledTimes(1);
  expect(mockInfo).not.toHaveBeenCalled();
});
