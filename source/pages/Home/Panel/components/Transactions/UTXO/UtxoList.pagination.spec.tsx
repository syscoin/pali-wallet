/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { UtxoTransactionsList } from './UtxoList';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
let mockBase: any[] = [];
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeNetwork: {
          chainId: 0,
          currency: 'btc',
          url: 'https://synthetic.example/',
        },
        isBitcoinBased: true,
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({
    id: 0,
    xpub: 'synthetic-public-xpub',
    address: 'synthetic-public-address',
  }),
  selectActiveAccountRef: () => ({ id: 0, type: 'HDAccount' }),
  selectActiveAccountAssets: () => ({ syscoin: [] }),
  selectActiveAccountTransactions: () => ({ syscoin: { 0: mockBase } }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'public-account',
    network: 'synthetic-network',
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    useCopyClipboard: () => [false, jest.fn()],
    alert: mockAlert,
  }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DetailArrowSvg: () => null,
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('utils/index', () => ({
  getTokenLogo: () => undefined,
  ellipsis: (value: string) => value,
}));
const tx = (id: number) => ({
  txid: id.toString(16).padStart(64, '0'),
  blockTime: 1700000000 - id,
  blockHeight: 100,
  confirmations: 3,
  vin: [],
  vout: [],
  addressValueIn: '0',
  addressValueOut: '100000000',
  fees: '1000',
});
beforeEach(() => {
  jest.clearAllMocks();
  mockBase = Array.from({ length: 30 }, (_, i) => tx(i + 1));
});
it.each([false, true])(
  'does not infer exhaustion from a full page (duplicates=%s)',
  async (duplicates) => {
    const second = duplicates
      ? mockBase
      : Array.from({ length: 30 }, (_, i) => tx(i + 31));
    mockEmitter.mockImplementation(async (_methods: any, args: any[]) =>
      args[2] === 2 ? second : [tx(99)]
    );
    render(
      <MemoryRouter>
        <UtxoTransactionsList userTransactions={mockBase} />
      </MemoryRouter>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
    });
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getSysTransactionsPage'],
      ['synthetic-public-xpub', 'https://synthetic.example/', 2, 30]
    );
    const more = screen.getByRole('button', { name: 'buttons.loadMore' });
    await act(async () => {
      fireEvent.click(more);
    });
    expect(mockEmitter).toHaveBeenLastCalledWith(
      ['wallet', 'getSysTransactionsPage'],
      ['synthetic-public-xpub', 'https://synthetic.example/', 3, 30]
    );
    expect(screen.getByText(tx(99).txid)).toBeTruthy();
  }
);

it('advances past a partly duplicate full page without duplicating visible rows', async () => {
  const second = mockBase
    .slice(0, 15)
    .concat(Array.from({ length: 15 }, (_, i) => tx(i + 31)));
  mockEmitter.mockImplementation(async (_methods: any, args: any[]) =>
    args[2] === 2 ? second : [tx(99)]
  );
  render(
    <MemoryRouter>
      <UtxoTransactionsList userTransactions={mockBase} />
    </MemoryRouter>
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  });
  expect(screen.getAllByText(tx(1).txid)).toHaveLength(1);
  expect(screen.getByText(tx(45).txid)).toBeTruthy();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  });
  expect(mockEmitter.mock.calls[1][1][2]).toBe(3);
  expect(screen.getByText(tx(99).txid)).toBeTruthy();
});

it.each([[[]], [[tx(1), tx(2)]], [[tx(99)]]])(
  'keeps empty and short-page exhaustion (%j)',
  async (rows) => {
    mockEmitter.mockResolvedValue(rows);
    render(
      <MemoryRouter>
        <UtxoTransactionsList userTransactions={mockBase} />
      </MemoryRouter>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
    });
    expect(
      screen.queryByRole('button', { name: 'buttons.loadMore' })
    ).toBeNull();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);

it('retries a failed page before advancing past a recovered duplicate-only page', async () => {
  mockEmitter
    .mockRejectedValueOnce(new Error('Synthetic history unavailable'))
    .mockResolvedValueOnce(mockBase)
    .mockResolvedValueOnce([tx(99)]);
  render(
    <MemoryRouter>
      <UtxoTransactionsList userTransactions={mockBase} />
    </MemoryRouter>
  );
  const load = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
    });
  };
  await load();
  expect(mockAlert.error).toHaveBeenCalledWith('Synthetic history unavailable');
  await load();
  expect(mockEmitter.mock.calls.map((call: any[]) => call[1][2])).toEqual([
    2, 2,
  ]);
  expect(screen.getAllByText(tx(1).txid)).toHaveLength(1);
  await load();
  expect(mockEmitter.mock.calls.map((call: any[]) => call[1][2])).toEqual([
    2, 2, 3,
  ]);
  expect(screen.getByText(tx(99).txid)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'buttons.loadMore' })).toBeNull();
});
