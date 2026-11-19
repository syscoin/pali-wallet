/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { UtxoTransactionsList } from './UtxoList';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
let mockBase: any[] = [];
let mockNetwork: any;
let mockAccount: any;
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeNetwork: mockNetwork,
        isBitcoinBased: true,
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => mockAccount,
  selectActiveAccountRef: () => ({ id: mockAccount.id, type: 'HDAccount' }),
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
  mockNetwork = {
    chainId: 0,
    currency: 'btc',
    url: 'https://synthetic.example/',
  };
  mockAccount = {
    id: 0,
    xpub: 'synthetic-public-xpub',
    address: 'synthetic-public-address',
  };
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
      ['synthetic-public-xpub', 'https://synthetic.example/', 2, 30, true]
    );
    const more = screen.getByRole('button', { name: 'buttons.loadMore' });
    await act(async () => {
      fireEvent.click(more);
    });
    expect(mockEmitter).toHaveBeenLastCalledWith(
      ['wallet', 'getSysTransactionsPage'],
      ['synthetic-public-xpub', 'https://synthetic.example/', 3, 30, true]
    );
    expect(screen.getByText(tx(99).txid)).toBeTruthy();
  }
);

it('uses Blockbook exhaustion even when the final first or second page contains 30 rows', async () => {
  const tree = (firstPageHasMore: boolean) => (
    <MemoryRouter>
      <UtxoTransactionsList
        userTransactions={mockBase}
        firstPageHasMore={firstPageHasMore}
      />
    </MemoryRouter>
  );
  const view = render(tree(false));
  expect(screen.queryByRole('button', { name: 'buttons.loadMore' })).toBeNull();
  view.rerender(tree(true));
  mockEmitter.mockResolvedValue({
    rows: Array.from({ length: 30 }, (_, i) => tx(i + 31)),
    hasMore: false,
  });
  await loadMore();
  expect(screen.getByText(tx(60).txid)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'buttons.loadMore' })).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

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

const liveHistory = () => {
  let rows = Array.from({ length: 120 }, (_, index) => tx(index + 1));
  mockBase = rows.slice(0, 30);
  const page = (number: number) => rows.slice((number - 1) * 30, number * 30);
  mockEmitter.mockImplementation(async (_methods: any, args: any[]) =>
    page(args[2])
  );
  const tree = () => (
    <MemoryRouter>
      <UtxoTransactionsList userTransactions={mockBase} />
    </MemoryRouter>
  );
  const view = render(tree());
  return {
    page,
    update: async (next: any[]) => {
      rows = next;
      mockBase = rows.slice(0, 30);
      await act(async () => view.rerender(tree()));
    },
    rows: () => rows,
  };
};
const loadMore = async () => {
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }))
  );
};
const pages = () => mockEmitter.mock.calls.map((call: any[]) => call[1][2]);
const settled = () =>
  waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'buttons.loadMore' })
    ).not.toBeDisabled()
  );

it('retains the loaded depth and bridges shifted offset pages when a new head arrives', async () => {
  const history = liveHistory();
  await loadMore();
  expect(screen.getByText(tx(60).txid)).toBeVisible();
  await history.update([tx(0), ...history.rows()]);
  await settled();
  expect(pages()).toEqual([2, 2, 3]);
  for (let id = 0; id <= 60; id++)
    expect(screen.getAllByText(tx(id).txid)).toHaveLength(1);
  expect(screen.queryByText(tx(61).txid)).toBeNull();
  await loadMore(); // Reread the partially retained offset page's older tail.
  expect(pages()).toEqual([2, 2, 3, 3]);
  await loadMore();
  expect(pages()).toEqual([2, 2, 3, 3, 4]);
  for (let id = 0; id <= 119; id++)
    expect(screen.getAllByText(tx(id).txid)).toHaveLength(1);
});

it.each([false, true])(
  'reconciles deletions and reorgs without chasing a vanished oldest anchor=%s',
  async (oldestDeleted) => {
    const history = liveHistory();
    await loadMore();
    await history.update(
      history
        .rows()
        .filter(
          (row) =>
            ![
              tx(1).txid,
              tx(45).txid,
              ...(oldestDeleted ? [tx(60).txid] : []),
            ].includes(row.txid)
        )
    );
    await settled();
    expect(pages()).toEqual([2, 2]);
    expect(screen.queryByText(tx(1).txid)).toBeNull();
    expect(screen.queryByText(tx(45).txid)).toBeNull();
    if (oldestDeleted) expect(screen.queryByText(tx(60).txid)).toBeNull();
    else expect(screen.getByText(tx(60).txid)).toBeVisible();
    expect(screen.getByText(tx(oldestDeleted ? 63 : 62).txid)).toBeVisible();
    await loadMore();
    expect(pages()).toEqual([2, 2, 3]);
    expect(screen.getByText(tx(64).txid)).toBeVisible();
  }
);

it('reconciles an in-flight older page after a live head change', async () => {
  const history = liveHistory();
  let finish!: (rows: any[]) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await loadMore();
  await history.update([tx(0), ...history.rows()]);
  expect(pages()).toEqual([2]);
  await act(async () =>
    finish(Array.from({ length: 30 }, (_, index) => tx(index + 31)))
  );
  await settled();
  expect(pages()).toEqual([2, 2, 3]);
  for (let id = 0; id <= 60; id++)
    expect(screen.getAllByText(tx(id).txid)).toHaveLength(1);
});

it('retains rows on reconciliation failure and retries the same prefix explicitly', async () => {
  const history = liveHistory();
  await loadMore();
  mockEmitter.mockRejectedValueOnce(new Error('Refresh unavailable'));
  await history.update([tx(0), ...history.rows()]);
  await settled();
  expect(mockAlert.error).toHaveBeenCalledWith('Refresh unavailable');
  expect(screen.getByText(tx(30).txid)).toBeVisible();
  expect(screen.getByText(tx(60).txid)).toBeVisible();
  expect(pages()).toEqual([2, 2]);
  await loadMore();
  await settled();
  expect(pages()).toEqual([2, 2, 2, 3]);
  expect(screen.getAllByText(tx(60).txid)).toHaveLength(1);
});

it('does not refetch offsets for confirmation-only updates', async () => {
  const history = liveHistory();
  await loadMore();
  await history.update(
    history.rows().map((row) => ({ ...row, confirmations: 4 }))
  );
  expect(pages()).toEqual([2]);
  expect(screen.getByText(tx(60).txid)).toBeVisible();
  await loadMore();
  expect(pages()).toEqual([2, 3]);
  expect(screen.getByText(tx(90).txid)).toBeVisible();
});

it('keeps repeated live-head reconciliation bounded to the retained depth', async () => {
  const history = liveHistory();
  await loadMore();
  for (let index = 0; index < 4; index++) {
    const incoming = { ...tx(500 + index), blockTime: 1700000010 + index };
    await history.update([incoming, ...history.rows()]);
    await settled();
    expect(pages()).toEqual([
      2,
      ...Array.from({ length: index + 1 }, () => [2, 3]).flat(),
    ]);
    expect(screen.getByText(tx(60).txid)).toBeVisible();
    expect(screen.queryByText(tx(61).txid)).toBeNull();
  }
  await loadMore();
  expect(pages().slice(-1)).toEqual([3]);
  for (let id = 1; id <= 86; id++)
    expect(screen.getAllByText(tx(id).txid)).toHaveLength(1);
});

it('bridges one offset overlap when the backend shifts beyond the observed live prefix', async () => {
  const history = liveHistory();
  await loadMore();
  mockEmitter.mockImplementation(async (_methods: any, args: any[]) =>
    Array.from({ length: 30 }, (_, index) => tx((args[2] - 1) * 30 + index + 1))
  );
  await history.update(history.rows().slice(1));
  await settled();
  expect(pages()).toEqual([2, 2, 3]);
  expect(screen.queryByText(tx(1).txid)).toBeNull();
  for (let id = 2; id <= 61; id++)
    expect(screen.getAllByText(tx(id).txid)).toHaveLength(1);
  await loadMore();
  expect(pages()).toEqual([2, 2, 3, 3]);
  expect(screen.getByText(tx(90).txid)).toBeVisible();
});

it('keeps retained rows when full duplicate pages cannot establish a refreshed prefix', async () => {
  const history = liveHistory();
  await loadMore();
  mockEmitter.mockImplementation(async () => mockBase);
  await history.update([tx(0), ...history.rows()]);
  await settled();
  expect(pages()).toEqual([2, 2, 3, 4]);
  expect(screen.getByText(tx(30).txid)).toBeVisible();
  expect(screen.getByText(tx(60).txid)).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'buttons.loadMore' })
  ).not.toBeDisabled();
});

it('enables older-page loading when an initially empty history becomes a full live prefix', async () => {
  mockBase = [];
  const tree = () => (
    <MemoryRouter>
      <UtxoTransactionsList userTransactions={mockBase} />
    </MemoryRouter>
  );
  const view = render(tree());
  expect(screen.queryByRole('button', { name: 'buttons.loadMore' })).toBeNull();
  mockBase = Array.from({ length: 30 }, (_, index) => tx(index + 1));
  mockEmitter.mockResolvedValue(
    Array.from({ length: 30 }, (_, index) => tx(index + 31))
  );
  await act(async () => view.rerender(tree()));
  await loadMore();
  expect(pages()).toEqual([2]);
  expect(screen.getByText(tx(60).txid)).toBeVisible();
});

it('reconciles a nonoverlapping reorg even without previously fetched pages', async () => {
  const history = liveHistory();
  await history.update(
    Array.from({ length: 30 }, (_, index) => tx(index + 200))
  );
  await waitFor(() => expect(screen.queryByText(tx(1).txid)).toBeNull());
  expect(pages()).toEqual([2]);
  expect(screen.getByText(tx(229).txid)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'buttons.loadMore' })).toBeNull();
});

it('ignores an obsolete reconciliation after a newer live head finishes', async () => {
  const history = liveHistory();
  await loadMore();
  let finish!: (rows: any[]) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await history.update([tx(0), ...history.rows()]);
  await history.update([
    { ...tx(500), blockTime: 1700000010 },
    ...history.rows(),
  ]);
  await settled();
  expect(pages()).toEqual([2, 2, 2, 3]);
  await act(async () => finish([{ ...tx(999), blockTime: 1700000020 }]));
  expect(screen.queryByText(tx(999).txid)).toBeNull();
  expect(screen.getByText(tx(500).txid)).toBeVisible();
  expect(screen.getAllByText(tx(30).txid)).toHaveLength(1);
  expect(screen.getByText(tx(60).txid)).toBeVisible();
});

it('stops a stalled reconciliation at its deadline and keeps a manual retry available', async () => {
  const history = liveHistory();
  await loadMore();
  let finish!: (rows: any[]) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  jest.useFakeTimers();
  try {
    await history.update([tx(0), ...history.rows()]);
    await act(async () => jest.advanceTimersByTimeAsync(10_000));
    expect(mockAlert.error).toHaveBeenCalledWith('settings.apiTimeout');
    expect(screen.getByText(tx(30).txid)).toBeVisible();
    expect(screen.getByText(tx(60).txid)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'buttons.loadMore' })
    ).not.toBeDisabled();
    await loadMore();
    expect(pages()).toEqual([2, 2, 2, 3]);
    await act(async () => finish([{ ...tx(999), blockTime: 1700000020 }]));
    expect(screen.queryByText(tx(999).txid)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it.each(['account', 'network'])(
  'resets real %s ownership and ignores a late old page',
  async (boundary) => {
    const history = liveHistory();
    let finish!: (rows: any[]) => void;
    mockEmitter.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await loadMore();
    if (boundary === 'account')
      mockAccount = { ...mockAccount, id: 1, xpub: 'second-public-xpub' };
    else mockNetwork = { ...mockNetwork, url: 'https://second.example/' };
    await history.update(
      Array.from({ length: 60 }, (_, index) => tx(index + 200))
    );
    await act(async () =>
      finish(Array.from({ length: 30 }, (_, index) => tx(index + 31)))
    );
    expect(screen.queryByText(tx(31).txid)).toBeNull();
    expect(screen.getByText(tx(200).txid)).toBeVisible();
    await loadMore();
    expect(pages()).toEqual([2, 2]);
    expect(mockEmitter.mock.calls[1][1]).toEqual([
      mockAccount.xpub,
      mockNetwork.url,
      2,
      30,
      true,
    ]);
    expect(screen.getByText(tx(259).txid)).toBeVisible();
  }
);
