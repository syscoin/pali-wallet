/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import {
  IHistoryPage,
  useHistoryBrowsingState,
} from './Panel/components/Transactions/useHistoryBrowsingState';
import {
  getHomeBrowsingScope,
  useHomeBrowsingState,
} from './useHomeBrowsingState';

let scope = 'account-a:network-a';

const AssetsPage = () => {
  const [view, setView] = useHomeBrowsingState('homeAssets', scope, {
    searchValue: '',
    visibleCount: 50,
  });
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <input
        aria-label="Asset search"
        value={view.searchValue}
        onChange={(event) =>
          setView({ ...view, searchValue: event.target.value })
        }
      />
      <button onClick={() => setView({ ...view, visibleCount: 100 })}>
        More assets
      </button>
      <output data-testid="count">{view.visibleCount}</output>
      <output data-testid="route-state">
        {JSON.stringify(location.state)}
      </output>
      <button
        onClick={() => navigate('/details', { state: { origin: location } })}
      >
        Details
      </button>
    </>
  );
};

type FetchPage = (page: number) => Promise<IHistoryPage<{ hash: string }>>;
const HistoryPage = ({ fetchPage }: { fetchPage?: FetchPage }) => {
  const view = useHistoryBrowsingState<{ hash: string }>(
    scope,
    true,
    fetchPage
  );
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button
        onClick={() => {
          view.setExtraTransactions([{ hash: 'older-public-transaction' }]);
          view.setVisibleCount(80);
          view.setNextPage(3);
        }}
      >
        More history
      </button>
      <output data-testid="count">{view.visibleCount}</output>
      <output data-testid="next-page">{view.nextPage}</output>
      <output data-testid="restoring">{String(view.isRestoringPages)}</output>
      <output data-testid="rows">
        {view.extraTransactions.map((row) => row.hash).join(',')}
      </output>
      <output data-testid="route-state">
        {JSON.stringify(location.state)}
      </output>
      <button
        onClick={() => navigate('/details', { state: { origin: location } })}
      >
        Details
      </button>
    </>
  );
};

const DetailsPage = () => {
  const { state } = useLocation();
  const navigate = useNavigate();
  return (
    <button
      onClick={() =>
        navigate(`${state.origin.pathname}${state.origin.search}`, {
          state: state.origin.state,
        })
      }
    >
      Back
    </button>
  );
};

const App = ({
  history = false,
  fetchPage,
  state,
}: {
  fetchPage?: FetchPage;
  history?: boolean;
  state?: any;
}) => (
  <MemoryRouter
    initialEntries={[
      { pathname: '/home', search: '?tab=assets&filter=keep', state },
    ]}
    // eslint-disable-next-line camelcase -- React Router API field names
    future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
  >
    <Routes>
      <Route
        path="/home"
        element={
          history ? <HistoryPage fetchPage={fetchPage} /> : <AssetsPage />
        }
      />
      <Route path="/details" element={<DetailsPage />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  scope = 'account-a:network-a';
});

it('fingerprints exact account/network identity without storing endpoint credentials', () => {
  const account = { type: 'HDAccount', id: 1, address: '0xaccount' };
  const network = {
    chainId: 1,
    url: 'https://rpc.example/private-key',
    apiUrl: 'https://explorer.example/api?apikey=private-api-key',
  };
  const fingerprint = getHomeBrowsingScope(account, network);
  expect(fingerprint).toMatch(/^0x[0-9a-f]{64}$/);
  expect(fingerprint).not.toContain('private');
  expect(
    getHomeBrowsingScope({ ...account, address: '0xother' }, network)
  ).not.toBe(fingerprint);
  expect(
    getHomeBrowsingScope(account, {
      ...network,
      url: 'https://rpc.example/another-key',
    })
  ).not.toBe(fingerprint);
  expect(getHomeBrowsingScope(account, network, true)).not.toBe(fingerprint);
});

it('restores the actual asset search and loaded rows after a detail round trip', () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText('Asset search'), {
    target: { value: 'USDC' },
  });
  fireEvent.click(screen.getByText('More assets'));
  fireEvent.click(screen.getByText('Details'));
  fireEvent.click(screen.getByText('Back'));
  expect(
    (screen.getByLabelText('Asset search') as HTMLInputElement).value
  ).toBe('USDC');
  expect(screen.getByTestId('count').textContent).toBe('100');
});

it('does not restore another account or network view', () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText('Asset search'), {
    target: { value: 'USDC' },
  });
  fireEvent.click(screen.getByText('More assets'));
  fireEvent.click(screen.getByText('Details'));
  scope = 'account-b:network-b';
  fireEvent.click(screen.getByText('Back'));
  expect(
    (screen.getByLabelText('Asset search') as HTMLInputElement).value
  ).toBe('');
  expect(screen.getByTestId('count').textContent).toBe('50');
});

it('restores paged history while retaining rows only in memory', () => {
  render(<App history />);
  fireEvent.click(screen.getByText('More history'));
  expect(screen.getByTestId('route-state').textContent).not.toContain(
    'older-public-transaction'
  );
  fireEvent.click(screen.getByText('Details'));
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByTestId('rows').textContent).toBe(
    'older-public-transaction'
  );
  expect(screen.getByTestId('count').textContent).toBe('80');
});

it('does not restore cached history to another account', () => {
  render(<App history />);
  fireEvent.click(screen.getByText('More history'));
  fireEvent.click(screen.getByText('Details'));
  scope = 'other-account:network-a';
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByTestId('rows').textContent).toBe('');
  expect(screen.getByTestId('count').textContent).toBe('50');
});

const reopenedState = (nextPage: number, cacheKey: string) => ({
  homeActivity: {
    scope,
    value: { nextPage, visibleCount: 200, hasMoreServer: true, cacheKey },
  },
});

it('reopens a saved history list by replaying missing pages from page 2', async () => {
  const fetchPage = jest.fn(async (page: number) => ({
    rows: [{ hash: `replayed-page-${page}` }],
    hasMore: true,
  }));
  render(
    <App
      history
      fetchPage={fetchPage}
      state={reopenedState(4, 'closed-document-cache')}
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('restoring').textContent).toBe('false')
  );
  expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([2, 3]);
  expect(screen.getByTestId('rows').textContent).toBe(
    'replayed-page-2,replayed-page-3'
  );
  expect(screen.getByTestId('next-page').textContent).toBe('4');
  expect(screen.getByTestId('count').textContent).toBe('200');
  expect(screen.getByTestId('route-state').textContent).not.toContain(
    'replayed-page'
  );
});

it('bounds reopen replay to five pages and leaves Load More at the first missing page', async () => {
  const fetchPage = jest.fn(async (page: number) => ({
    rows: [{ hash: `bounded-page-${page}` }],
    hasMore: true,
  }));
  render(
    <App
      history
      fetchPage={fetchPage}
      state={reopenedState(20, 'many-closed-pages')}
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('restoring').textContent).toBe('false')
  );
  expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([2, 3, 4, 5, 6]);
  expect(screen.getByTestId('next-page').textContent).toBe('7');
});

it('keeps recovered pages and retries the failed page after a provider error', async () => {
  const fetchPage = jest.fn(async (page: number) => {
    if (page === 4) throw new Error('Explorer unavailable');
    return { rows: [{ hash: `recovered-page-${page}` }], hasMore: true };
  });
  render(
    <App
      history
      fetchPage={fetchPage}
      state={reopenedState(6, 'provider-failure-cache')}
    />
  );
  await waitFor(() =>
    expect(screen.getByTestId('restoring').textContent).toBe('false')
  );
  expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([2, 3, 4]);
  expect(screen.getByTestId('rows').textContent).toBe(
    'recovered-page-2,recovered-page-3'
  );
  expect(screen.getByTestId('next-page').textContent).toBe('4');
});

it('rejects a replay response after the account or network changes', async () => {
  let resolve!: (value: IHistoryPage<{ hash: string }>) => void;
  const fetchPage = jest.fn(
    () =>
      new Promise<IHistoryPage<{ hash: string }>>((done) => {
        resolve = done;
      })
  );
  const { rerender } = render(
    <App
      history
      fetchPage={fetchPage}
      state={reopenedState(4, 'cancelled-replay')}
    />
  );
  expect(fetchPage).toHaveBeenCalledWith(2);
  scope = 'account-b:network-b';
  rerender(<App history fetchPage={fetchPage} />);
  await act(async () =>
    resolve({ rows: [{ hash: 'stale-row' }], hasMore: true })
  );
  expect(screen.getByTestId('rows').textContent).toBe('');
  expect(screen.getByTestId('next-page').textContent).toBe('2');
});

it('ends replay at the ten-second deadline without skipping the timed-out page', async () => {
  jest.useFakeTimers();
  try {
    const fetchPage = jest.fn(
      () => new Promise<IHistoryPage<{ hash: string }>>(() => undefined)
    );
    render(
      <App
        history
        fetchPage={fetchPage}
        state={reopenedState(4, 'deadline-replay')}
      />
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId('restoring').textContent).toBe('false');
    expect(screen.getByTestId('next-page').textContent).toBe('2');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
