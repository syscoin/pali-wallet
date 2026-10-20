/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import { TxsPanel } from '../TxsPanel';
import vaultReducer, {
  setAccountTransactions,
  setAccountAssets,
  setAccounts,
  setActiveAccount,
  setActiveNetwork,
  setIsBitcoinBased,
} from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import vaultGlobalReducer, { setIsSwitchingAccount } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockStore: any;
const mockSuccess = jest.fn();
const mockTranslate = (key: string) =>
  ({ 'send.pending': 'Pending', 'send.confirmed': 'Confirmed' }[key] || key);

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    success: (...args: any[]) => mockSuccess(...args),
    error: jest.fn(),
    warning: jest.fn(),
    dismiss: jest.fn(),
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
    throw new Error(
      'Confirmation scope test must not query an external provider'
    );
  },
}));

const TYPE = KeyringAccountType.HDAccount;
const A = `0x${'11'.repeat(20)}`;
const B = `0x${'22'.repeat(20)}`;
// Public P2WPKH addresses derived from fixed 20-byte hashes (no private keys).
const UTXO_A = 'tsys1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpmtdx9f';
const UTXO_B = 'tsys1qqgpqyqszqgpqyqszqgpqyqszqgpqyqsz20trwl';
const HASH = `0x${'aa'.repeat(32)}`;
const TXID = 'bb'.repeat(32);
type Family = 'ethereum' | 'syscoin';
const network = (family: Family) => ({
  kind: family === 'ethereum' ? INetworkType.Ethereum : INetworkType.Syscoin,
  chainId: family === 'ethereum' ? 1 : 5700,
  slip44: family === 'ethereum' ? 60 : 1,
  currency: family === 'ethereum' ? 'eth' : 'tsys',
  label: `Synthetic ${family}`,
  url: `https://${family}.synthetic.invalid/`,
  explorer: `https://${family}.synthetic.invalid/`,
});
const transaction = (
  family: Family,
  confirmed: boolean,
  hash?: string,
  owner = 0
) =>
  family === 'ethereum'
    ? {
        hash: hash || HASH,
        from: A,
        to: B,
        input: '0x',
        value: '1000000000000000000',
        chainId: 1,
        nonce: 8,
        type: 2,
        timestamp: 1790000000,
        blockNumber: confirmed ? 42 : null,
        confirmations: confirmed ? 1 : 0,
        // eslint-disable-next-line camelcase
        txreceipt_status: confirmed ? '1' : null,
      }
    : {
        txid: hash || TXID,
        value: '100000',
        fees: '1000',
        blockTime: 1790000000,
        blockHeight: confirmed ? 42 : 0,
        confirmations: confirmed ? 1 : 0,
        vin: [{ addresses: [UTXO_A], value: '100000', isOwn: owner === 0 }],
        vout: [{ addresses: [UTXO_B], value: '99000', isOwn: owner === 1 }],
      };

const setTransactions = (
  accountId: number,
  family: Family,
  rows: any[],
  accountType = TYPE
) =>
  mockStore.dispatch(
    setAccountTransactions({
      accountId,
      accountType,
      chainId: network(family).chainId,
      networkType:
        family === 'ethereum'
          ? TransactionsType.Ethereum
          : TransactionsType.Syscoin,
      transactions: rows,
    })
  );
const select = (id: number) => {
  // Same Redux publication sequence as MainController.setAccount. These are
  // cached histories of a transfer visible to both accounts, not new receipts.
  mockStore.dispatch(setIsSwitchingAccount(true));
  mockStore.dispatch(setActiveAccount({ id, type: TYPE }));
  mockStore.dispatch(setIsSwitchingAccount(false));
};
let clock = 2_100_000_000_000;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime((clock += 10_000));
  jest.clearAllMocks();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
const setup = (
  family: Family,
  secondRows = [transaction(family, true, undefined, 1)]
) => {
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
        activeNetwork: network(family),
        isBitcoinBased: family === 'syscoin',
        accounts: {
          ...vault.accounts,
          [TYPE]: {
            0: {
              id: 0,
              address: family === 'ethereum' ? A : UTXO_A,
              xpub: 'public-xpub-a',
            },
            1: {
              id: 1,
              address: family === 'ethereum' ? B : UTXO_B,
              xpub: 'public-xpub-b',
            },
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
      vaultGlobal: { ...global, activeSlip44: network(family).slip44 },
    },
  });
  setTransactions(0, family, [transaction(family, false)]);
  setTransactions(1, family, secondRows);
};
const mount = () =>
  render(
    <Provider store={mockStore}>
      <MemoryRouter initialEntries={['/home?tab=activity']}>
        <TxsPanel />
      </MemoryRouter>
    </Provider>
  );
const settle = async () => {
  await act(async () => Promise.resolve());
  await act(async () => jest.advanceTimersByTimeAsync(0));
};

describe.each(['ethereum', 'syscoin'] as const)(
  '%s confirmation scope',
  (family) => {
    it('does not announce a cached confirmation when switching to the other owner of the same transfer', async () => {
      setup(family);
      const view = mount();
      await settle();
      expect(screen.getByText('Pending')).toBeInTheDocument();
      const list = view.container.querySelector('#activity-panel-list');
      expect(mockSuccess).not.toHaveBeenCalled();
      act(() => select(1));
      await settle();
      expect(screen.queryByText('Pending')).not.toBeInTheDocument();
      expect(view.container.querySelector('#activity-panel-list')).toBe(list);
      expect(mockStore.getState().vault.activeAccount.id).toBe(1);
      expect(mockSuccess).not.toHaveBeenCalled();
    });

    it('still announces a genuine pending-to-confirmed update in the current account', async () => {
      setup(family);
      mount();
      await settle();
      expect(mockSuccess).not.toHaveBeenCalled();
      act(() => setTransactions(0, family, [transaction(family, true)]));
      await settle();
      expect(screen.queryByText('Pending')).not.toBeInTheDocument();
      expect(mockSuccess).toHaveBeenCalledTimes(1);
      expect(mockSuccess).toHaveBeenCalledWith('send.txSuccessfull', {
        autoClose: 5000,
      });
    });

    it('does not import an offscreen cached confirmation on an A -> B -> A visit', async () => {
      setup(family, [transaction(family, false, undefined, 1)]);
      mount();
      await settle();
      act(() => select(1));
      await settle();
      act(() => setTransactions(0, family, [transaction(family, true)]));
      await settle();
      expect(mockSuccess).not.toHaveBeenCalled();
      act(() => select(0));
      await settle();
      expect(mockSuccess).not.toHaveBeenCalled();
    });

    it('does not notify when an empty account receives its first cached page and mounts a new list', async () => {
      setup(family, []);
      mount();
      await settle();
      act(() => select(1));
      await settle();
      expect(document.querySelector('#activity-panel-list')).toBeNull();
      act(() => setTransactions(1, family, [transaction(family, true)]));
      await settle();
      expect(document.querySelector('#activity-panel-list')).not.toBeNull();
      expect(mockSuccess).not.toHaveBeenCalled();
    });

    it('does not notify on a fresh mount containing only confirmed history', async () => {
      setup(family);
      act(() => select(1));
      mount();
      await settle();
      expect(mockSuccess).not.toHaveBeenCalled();
    });

    it.each(['account', 'account type', 'endpoint', 'ABA', 'unmount'] as const)(
      'retires an already queued genuine confirmation after %s changes before the real alert timer runs',
      async (change) => {
        setup(family, [transaction(family, false, undefined, 1)]);
        const view = mount();
        await settle();
        act(() => setTransactions(0, family, [transaction(family, true)]));
        // The real useUtils alert owns a zero-delay timer. Do not flush it
        // until the next view has committed; no alert callback is mocked.
        expect(mockSuccess).not.toHaveBeenCalled();
        if (change === 'unmount') view.unmount();
        else if (change === 'account type')
          act(() => {
            const account = mockStore.getState().vault.accounts[TYPE];
            const imported = KeyringAccountType.Imported;
            mockStore.dispatch(
              setAccounts({
                ...mockStore.getState().vault.accounts,
                [TYPE]: { 0: account[0] },
                [imported]: { 1: account[1] },
              })
            );
            mockStore.dispatch(
              setAccountAssets({
                accountId: 1,
                accountType: imported,
                assets: { ethereum: [], syscoin: [] },
              })
            );
            setTransactions(
              1,
              family,
              [transaction(family, false, undefined, 1)],
              imported
            );
            mockStore.dispatch(setActiveAccount({ id: 1, type: imported }));
          });
        else if (change === 'endpoint')
          act(() =>
            mockStore.dispatch(
              setActiveNetwork({
                ...network(family),
                url: 'https://other-endpoint.synthetic.invalid/',
              } as any)
            )
          );
        else {
          act(() => select(1));
          if (change === 'ABA') act(() => select(0));
        }
        await settle();
        expect(mockSuccess).not.toHaveBeenCalled();
        if (change === 'account') {
          act(() =>
            setTransactions(1, family, [
              transaction(family, true, undefined, 1),
            ])
          );
          await settle();
          expect(mockSuccess).toHaveBeenCalledTimes(1);
        }
      }
    );

    it('observes a real confirmation even when the history count and confirmation sum stay equal', async () => {
      setup(family);
      const hash = (digit: string) =>
        `${family === 'ethereum' ? '0x' : ''}${digit.repeat(64)}`;
      act(() =>
        setTransactions(0, family, [
          transaction(family, false),
          { ...transaction(family, true, hash('c')), nonce: 7 },
        ])
      );
      mount();
      await settle();
      expect(mockSuccess).not.toHaveBeenCalled();
      act(() =>
        setTransactions(0, family, [
          transaction(family, true),
          { ...transaction(family, false, hash('d')), nonce: 9 },
        ])
      );
      await settle();
      expect(mockSuccess).toHaveBeenCalledTimes(1);
    });

    it('keeps the three-second throttle in one context without applying it to another account', async () => {
      setup(family, [transaction(family, false, undefined, 1)]);
      mount();
      await settle();
      act(() => setTransactions(0, family, [transaction(family, true)]));
      await settle();
      expect(mockSuccess).toHaveBeenCalledTimes(1);
      act(() => select(1));
      await settle();
      // The common alert's two-second duplicate window is over, but the old
      // account's three-second confirmation throttle must not affect this one.
      await act(async () => jest.advanceTimersByTimeAsync(2100));
      act(() =>
        setTransactions(1, family, [transaction(family, true, undefined, 1)])
      );
      await settle();
      expect(mockSuccess).toHaveBeenCalledTimes(2);
      const nextHash = `${family === 'ethereum' ? '0x' : ''}${'e'.repeat(64)}`;
      act(() =>
        setTransactions(1, family, [
          { ...transaction(family, false, nextHash, 1), nonce: 9 },
        ])
      );
      await settle();
      act(() =>
        setTransactions(1, family, [
          { ...transaction(family, true, nextHash, 1), nonce: 9 },
        ])
      );
      await settle();
      expect(mockSuccess).toHaveBeenCalledTimes(2);
    });
  }
);

it('starts a fresh baseline when changing from EVM to a UTXO history', async () => {
  setup('ethereum');
  setTransactions(0, 'syscoin', [transaction('syscoin', true)]);
  mount();
  await settle();
  act(() => {
    mockStore.dispatch(setActiveNetwork(network('syscoin') as any));
    mockStore.dispatch(setIsBitcoinBased(true));
  });
  await settle();
  expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  expect(mockSuccess).not.toHaveBeenCalled();
});
