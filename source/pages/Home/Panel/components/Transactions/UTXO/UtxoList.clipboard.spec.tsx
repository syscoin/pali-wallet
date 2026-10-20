/** @jest-environment jsdom */
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { TxsPanel } from 'pages/Home/TxsPanel';
import vaultReducer, {
  setAccountTransactions,
  setActiveAccount,
  setActiveNetwork,
} from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import vaultGlobalReducer, { setIsSwitchingAccount } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockStore: any;
const mockWrite = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();
const mockDismiss = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: () => 'Clipboard refused' },
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    success: (...args: any[]) => mockSuccess(...args),
    error: (...args: any[]) => mockError(...args),
    warning: jest.fn(),
    dismiss: (...args: any[]) => mockDismiss(...args),
  }),
}));
jest.mock('pages/Home/Panel/index', () => ({
  TransactionsPanel: jest.requireActual('pages/Home/Panel/ActivityPanel')
    .TransactionsPanel,
  AssetsPanel: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('components/Icon/Icon', () => ({
  ExternalLinkSvg: () => null,
  DetailArrowSvg: () => null,
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/TransactionOptions', () => ({
  TransactionOptions: () => null,
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: () => {
    throw new Error('Clipboard probe cannot query a provider');
  },
}));

const TYPE = KeyringAccountType.HDAccount;
const TXID = 'bb'.repeat(32);
const UTXO_A = 'tsys1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpmtdx9f';
const UTXO_B = 'tsys1qqgpqyqszqgpqyqszqgpqyqszqgpqyqsz20trwl';
let clock = 2_200_000_000_000;
const pending = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const settle = async () => {
  // Flush the native reply and React's copied-state effect before its toast
  // delivery timer, matching the browser's separate event-loop turns.
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
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: {
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      price: (state = { fiat: { asset: 'usd', price: 1 } }) => state,
    },
    preloadedState: {
      vault: {
        ...vault,
        activeAccount: { id: 0, type: TYPE },
        activeNetwork: {
          kind: INetworkType.Syscoin,
          chainId: 5700,
          slip44: 1,
          currency: 'tsys',
          label: 'Synthetic Syscoin',
          url: 'https://syscoin.synthetic.invalid/',
          explorer: 'https://syscoin.synthetic.invalid/',
        },
        isBitcoinBased: true,
        accounts: {
          ...vault.accounts,
          [TYPE]: {
            0: { id: 0, address: UTXO_A, xpub: 'public-xpub-a' },
            1: { id: 1, address: UTXO_B, xpub: 'public-xpub-b' },
          },
        },
        accountAssets: {
          ...vault.accountAssets,
          [TYPE]: {
            0: { ethereum: [], syscoin: [] },
            1: { ethereum: [], syscoin: [] },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 1 },
    },
  });
  [0, 1].forEach((accountId) =>
    mockStore.dispatch(
      setAccountTransactions({
        accountId,
        accountType: TYPE,
        chainId: 5700,
        networkType: TransactionsType.Syscoin,
        transactions: [
          {
            txid: TXID,
            value: '100000',
            fees: '1000',
            blockTime: 1790000000,
            blockHeight: 42,
            confirmations: 1,
            vin: [
              { addresses: [UTXO_A], value: '100000', isOwn: accountId === 0 },
            ],
            vout: [
              { addresses: [UTXO_B], value: '99000', isOwn: accountId === 1 },
            ],
          },
        ] as any,
      })
    )
  );
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
const mount = () =>
  render(
    <Provider store={mockStore}>
      <MemoryRouter
        initialEntries={['/home?tab=activity']}
        // eslint-disable-next-line camelcase
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <TxsPanel />
      </MemoryRouter>
    </Provider>
  );
const select = (id: number) => {
  mockStore.dispatch(setIsSwitchingAccount(true));
  mockStore.dispatch(setActiveAccount({ id, type: TYPE }));
  mockStore.dispatch(setIsSwitchingAccount(false));
};
const copy = () => {
  // This is the real list row's first native button, preceding Details.
  const row = screen.getByText(/bbbbbb/).closest('div.flex.py-2')!;
  fireEvent.click(row.querySelector('button')!);
};
it('waits for native clipboard completion before claiming the public transaction ID was copied', async () => {
  const held = pending();
  mockWrite.mockReturnValueOnce(held.promise);
  mount();
  copy();
  expect(mockWrite).toHaveBeenCalledWith(TXID);
  await settle();
  expect(mockSuccess).not.toHaveBeenCalled();
  await act(async () => held.resolve());
  await settle();
  expect(mockSuccess).toHaveBeenCalledWith('home.hashCopied', undefined);
});
it('keeps a late refusal from another account out of the reused public history row', async () => {
  const held = pending();
  mockWrite.mockReturnValueOnce(held.promise);
  const view = mount();
  const row = screen.getByText(/bbbbbb/).closest('div.flex.py-2');
  copy();
  await settle();
  act(() => select(1));
  expect(mockStore.getState().vault.activeAccount.id).toBe(1);
  expect(screen.getByText(/bbbbbb/).closest('div.flex.py-2')).toBe(row);
  mockError.mockClear();
  await act(async () =>
    held.reject(new Error('Late native clipboard refusal'))
  );
  await settle();
  expect(mockError).not.toHaveBeenCalled();
  copy();
  await settle();
  expect(mockSuccess).toHaveBeenCalledWith('home.hashCopied', undefined);
  view.unmount();
});
it('still reports a successful same-view copy of the exact public transaction ID', async () => {
  mount();
  copy();
  await settle();
  expect(mockWrite).toHaveBeenCalledWith(TXID);
  expect(mockSuccess).toHaveBeenCalledWith('home.hashCopied', undefined);
  expect(mockError).not.toHaveBeenCalled();
});
it('still reports a genuine same-view native clipboard refusal', async () => {
  mockWrite.mockRejectedValueOnce(new Error('Native clipboard refusal'));
  mount();
  copy();
  await settle();
  expect(mockWrite).toHaveBeenCalledWith(TXID);
  expect(mockError).toHaveBeenCalledWith('Clipboard refused');
});

it.each(['resolve', 'reject'] as const)(
  'retires a held %s across account A -> B -> A while preserving the new copy',
  async (outcome) => {
    const held = pending();
    mockWrite.mockReturnValueOnce(held.promise);
    mount();
    copy();
    act(() => {
      select(1);
    });
    act(() => {
      select(0);
    });
    await act(async () => {
      if (outcome === 'resolve') held.resolve();
      else held.reject(new Error('Retired clipboard request'));
    });
    await settle();
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
    copy();
    await settle();
    expect(mockSuccess).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls).toEqual([[TXID], [TXID]]);
  }
);

it('retires pending clipboard feedback when the same-chain endpoint changes', async () => {
  const held = pending();
  mockWrite.mockReturnValueOnce(held.promise);
  mount();
  const row = screen.getByText(/bbbbbb/).closest('div.flex.py-2');
  copy();
  act(() => {
    mockStore.dispatch(
      setActiveNetwork({
        ...mockStore.getState().vault.activeNetwork,
        url: 'https://replacement.synthetic.invalid/',
      })
    );
  });
  expect(screen.getByText(/bbbbbb/).closest('div.flex.py-2')).toBe(row);
  await act(async () => held.reject(new Error('Old endpoint copy refused')));
  await settle();
  expect(mockSuccess).not.toHaveBeenCalled();
  expect(mockError).not.toHaveBeenCalled();
});

it('checks current context again before delivering already-queued success feedback', async () => {
  const held = pending();
  mockWrite.mockReturnValueOnce(held.promise);
  mount();
  copy();
  await act(async () => held.resolve());
  // The native write completed, but useUtils has not delivered its timer yet.
  expect(mockSuccess).not.toHaveBeenCalled();
  act(() => {
    select(1);
  });
  await settle();
  expect(mockSuccess).not.toHaveBeenCalled();
  copy();
  await settle();
  // The retired notice must not consume the global message deduplication slot.
  expect(mockSuccess).toHaveBeenCalledTimes(1);
});

it('keeps the newest refusal after an older copy succeeds later', async () => {
  const older = pending();
  const newer = pending();
  mockWrite
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  mount();
  copy();
  copy();
  await act(async () => newer.reject(new Error('Current request refused')));
  await settle();
  expect(mockError).toHaveBeenCalledTimes(1);
  await act(async () => older.resolve());
  await settle();
  expect(mockSuccess).not.toHaveBeenCalled();
  expect(mockError).toHaveBeenCalledTimes(1);
});

it('keeps the newest success after an older copy is refused later', async () => {
  const older = pending();
  const newer = pending();
  mockWrite
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  mount();
  copy();
  copy();
  await act(async () => newer.resolve());
  await settle();
  expect(mockSuccess).toHaveBeenCalledTimes(1);
  await act(async () => older.reject(new Error('Retired request refused')));
  await settle();
  expect(mockError).not.toHaveBeenCalled();
  expect(mockSuccess).toHaveBeenCalledTimes(1);
});

it('does not deliver an older queued success while the latest copy is still pending', async () => {
  const older = pending();
  const newer = pending();
  mockWrite
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  mount();
  copy();
  await act(async () => older.resolve());
  copy();
  await settle();
  expect(mockSuccess).not.toHaveBeenCalled();
  await act(async () => newer.resolve());
  await settle();
  expect(mockSuccess).toHaveBeenCalledTimes(1);
});

it.each(['resolve', 'reject'] as const)(
  'retires clipboard %s feedback after leaving the owning history view',
  async (outcome) => {
    const held = pending();
    mockWrite.mockReturnValueOnce(held.promise);
    const view = mount();
    copy();
    view.unmount();
    await act(async () => {
      if (outcome === 'resolve') held.resolve();
      else held.reject(new Error('Unmounted clipboard request'));
    });
    await settle();
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  }
);
