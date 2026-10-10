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
  HashRouter,
  MemoryRouter,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { NavigationRestorer } from 'routers/index';

const mockLoad = jest.fn();
const mockSave = jest.fn();
const mockClear = jest.fn();
let mockScope: { account: string; network: string };
let mockAuth: {
  connectionUnavailable: boolean;
  isLoading: boolean;
  isUnlocked: boolean;
};

jest.mock('react-redux', () => ({ useSelector: (select: any) => select() }));
jest.mock('hooks/useController', () => ({ useController: () => mockAuth }));
jest.mock('routers/useRouterLogic', () => ({ useRouterLogic: jest.fn() }));
jest.mock('components/Layout/AppLayout', () => ({ AppLayout: () => null }));
jest.mock('components/Modal', () => ({ WarningModal: () => null }));
jest.mock('utils/navigationState', () => ({
  loadNavigationState: () => mockLoad(),
  saveNavigationState: (...args: any[]) => mockSave(...args),
  clearNavigationState: () => mockClear(),
  getWalletNavigationScope: () => mockScope,
  isRestorableWalletRoute: (path: string) =>
    [
      '/home',
      '/home/smart-account',
      '/home/details',
      '/receive',
      '/settings/about',
      '/settings/account/smart-account-policy',
      '/settings/manage-accounts',
      '/send/eth',
      '/send/sys',
    ].includes(path.split(/[?#]/)[0]),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const saved = () => ({
  currentPath: '/home/smart-account',
  state: { smartAccountPickerOpen: true, smartAccountPickerSearch: 'account' },
  returnContext: { returnRoute: '/home?tab=assets' },
  scrollPosition: 20,
  scrollPositions: { 'wallet-page': 180 },
  walletScope: mockScope,
  timestamp: Date.now(),
  version: 2,
});
const Probe = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <NavigationRestorer />
      <output data-testid="route">{location.pathname + location.search}</output>
      <output data-testid="state">{JSON.stringify(location.state)}</output>
      <button onClick={() => navigate('/settings/about')}>Open About</button>
      <button
        onClick={() =>
          navigate('/home?tab=activity', {
            state: { tab: 'activity', searchValue: 'new filter' },
          })
        }
      >
        Change view
      </button>
    </>
  );
};
const tree = (entry: any = '/') => (
  <MemoryRouter initialEntries={[entry]}>
    <Probe />
  </MemoryRouter>
);
const mount = (entry: any = '/') => render(tree(entry));

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/app.html');
  mockScope = { account: 'account-a', network: 'network-a' };
  mockAuth = {
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  };
  mockLoad.mockResolvedValue(null);
  mockSave.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
});

it('restores the saved safe leaf immediately after authentication, with context and scroll metadata', async () => {
  mockLoad.mockResolvedValue(saved());
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('route').textContent).toBe('/home/smart-account')
  );
  expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({
    ...saved().state,
    returnContext: saved().returnContext,
    scrollPosition: 20,
    scrollPositions: { 'wallet-page': 180 },
    walletScope: mockScope,
  });
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockSave).not.toHaveBeenCalled();
});

it('does not overwrite storage while auth or saved-state loading is pending', async () => {
  mockAuth.isLoading = true;
  const loaded = deferred<any>();
  mockLoad.mockReturnValue(loaded.promise);
  const view = mount();
  expect(mockLoad).not.toHaveBeenCalled();
  fireEvent(window, new Event('pagehide'));
  expect(mockSave).not.toHaveBeenCalled();
  mockAuth.isLoading = false;
  view.rerender(tree());
  expect(mockLoad).toHaveBeenCalledTimes(1);
  fireEvent(window, new Event('pagehide'));
  expect(mockSave).not.toHaveBeenCalled();
  await act(async () => loaded.resolve(saved()));
  expect(screen.getByTestId('route').textContent).toBe('/home/smart-account');
});

it.each([
  { document: '/external.html?route=connect-wallet', route: '/home' },
  { document: '/external/connect-wallet', route: '/home' },
  { document: '/app.html?route=connect-wallet', route: '/home' },
  { document: '/app.html?externalRoute=connect-wallet', route: '/' },
  { document: '/app.html', route: '/?externalRoute=connect-wallet' },
  { document: '/app.html', route: '/external/connect-wallet' },
])(
  'never restores or stores an approval document or external routing query: %j',
  ({ document, route }) => {
    window.history.replaceState(null, '', document);
    mount(route);
    fireEvent(window, new Event('pagehide'));
    fireEvent(window.document, new Event('scroll'));
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  }
);

it('cancels a delayed restore when the user navigates elsewhere', async () => {
  const loaded = deferred<any>();
  mockLoad.mockReturnValue(loaded.promise);
  mount();
  fireEvent.click(screen.getByText('Open About'));
  await act(async () => loaded.resolve(saved()));
  expect(screen.getByTestId('route').textContent).toBe('/settings/about');
  expect(mockSave).toHaveBeenCalledWith(
    '/settings/about',
    undefined,
    null,
    undefined
  );
});

it.each(['lock', 'scope', 'connection'])(
  'cancels a delayed restore after %s changes',
  async (change) => {
    const loaded = deferred<any>();
    const oldSaved = saved();
    mockLoad.mockReturnValueOnce(loaded.promise).mockResolvedValue(null);
    const view = mount();
    if (change === 'lock') mockAuth.isUnlocked = false;
    if (change === 'scope')
      mockScope = { account: 'account-b', network: 'network-b' };
    if (change === 'connection') mockAuth.connectionUnavailable = true;
    view.rerender(tree());
    await act(async () => loaded.resolve(oldSaved));
    expect(screen.getByTestId('route').textContent).toBe(
      change === 'scope' ? '/home' : '/'
    );
    if (change === 'lock') expect(mockClear).toHaveBeenCalled();
  }
);

it('ignores a delayed restore after unmount', async () => {
  const loaded = deferred<any>();
  mockLoad.mockReturnValue(loaded.promise);
  const view = mount();
  view.unmount();
  await act(async () => loaded.resolve(saved()));
  expect(mockSave).not.toHaveBeenCalled();
});

it('checks the live store scope before restoring even before a selector rerender', async () => {
  const loaded = deferred<any>();
  const oldSaved = saved();
  mockLoad.mockReturnValue(loaded.promise);
  mount();
  mockScope = { account: 'new-account', network: 'new-network' };
  await act(async () => loaded.resolve(oldSaved));
  expect(screen.getByTestId('route').textContent).toBe('/');
  expect(mockSave).not.toHaveBeenCalled();
});

it.each(['scope', 'connection', 'loading'])(
  'a neutral startup restabilizes after %s cancellation instead of getting stuck at Start',
  async (change) => {
    const loaded = deferred<any>();
    const oldSaved = saved();
    mockLoad.mockReturnValueOnce(loaded.promise).mockResolvedValueOnce(null);
    const view = mount('/');
    if (change === 'scope')
      mockScope = { account: 'new-account', network: 'new-network' };
    if (change === 'connection') mockAuth.connectionUnavailable = true;
    if (change === 'loading') mockAuth.isLoading = true;
    view.rerender(tree('/'));
    await act(async () => loaded.resolve(oldSaved));
    mockAuth.connectionUnavailable = false;
    mockAuth.isLoading = false;
    view.rerender(tree('/'));
    await waitFor(() =>
      expect(screen.getByTestId('route').textContent).toBe('/home')
    );
    expect(mockLoad).toHaveBeenCalledTimes(2);
  }
);

it.each([
  '/send/confirm',
  '/external/tx/sign',
  '/settings/seed',
  '/settings/account/private-key',
  '/phrase',
  '/create-password',
])(
  'refuses saved secret, approval, setup, or confirmation leaf %s',
  async (path) => {
    mockLoad.mockResolvedValue({ ...saved(), currentPath: path });
    mount();
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('route').textContent).toBe('/');
  }
);

it('respects an explicit safe entry and saves its metadata without loading another leaf', () => {
  mount({ pathname: '/settings/about', state: { tab: 'support' } });
  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockSave).toHaveBeenCalledWith(
    '/settings/about',
    'support',
    { tab: 'support' },
    undefined
  );
});

it.each([
  '/home',
  '/home?tab=assets',
  '/home?tab=activity',
  '/home#transactions',
])(
  'does not replace explicit Home entry %s with another saved leaf',
  (entry) => {
    mockLoad.mockResolvedValue(saved());
    mount(entry);
    expect(mockLoad).not.toHaveBeenCalled();
    expect(screen.getByTestId('route').textContent).toBe(entry.split('#')[0]);
  }
);

it('respects a fresh explicit app.html#/home entry over a saved Policy leaf', async () => {
  mockLoad.mockResolvedValue({
    ...saved(),
    currentPath: '/settings/account/smart-account-policy',
  });
  window.history.replaceState(null, '', '/app.html#/home');
  render(
    <HashRouter>
      <Probe />
    </HashRouter>
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByTestId('route').textContent).toBe('/home');
  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockSave).toHaveBeenCalledWith('/home', undefined, null, undefined);
});

it('restores a saved leaf from the manifest default bare app.html popup', async () => {
  mockLoad.mockResolvedValue(saved());
  render(
    <HashRouter>
      <Probe />
    </HashRouter>
  );
  await waitFor(() =>
    expect(screen.getByTestId('route').textContent).toBe('/home/smart-account')
  );
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(mockSave).not.toHaveBeenCalled();
});

it('saves ordinary tab and state changes immediately', async () => {
  mount('/home');
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  mockSave.mockClear();
  fireEvent.click(screen.getByText('Change view'));
  expect(mockSave).toHaveBeenCalledWith(
    '/home?tab=activity',
    'activity',
    { tab: 'activity', searchValue: 'new filter' },
    undefined
  );
});

it('an initially offline neutral popup reaches Home after trusted reconnection with no snapshot', async () => {
  mockAuth.connectionUnavailable = true;
  const view = mount('/');
  expect(mockLoad).not.toHaveBeenCalled();
  mockAuth.connectionUnavailable = false;
  view.rerender(tree('/'));
  await waitFor(() =>
    expect(screen.getByTestId('route').textContent).toBe('/home')
  );
  expect(mockLoad).toHaveBeenCalledTimes(1);
});

it('an initially offline popup still preserves an explicit route after reconnection', () => {
  mockAuth.connectionUnavailable = true;
  const view = mount('/home?tab=activity');
  mockAuth.connectionUnavailable = false;
  view.rerender(tree('/home?tab=activity'));
  expect(screen.getByTestId('route').textContent).toBe('/home?tab=activity');
  expect(mockLoad).not.toHaveBeenCalled();
});

it('throttles nested scroll writes and flushes the latest position on pagehide', async () => {
  jest.useFakeTimers();
  try {
    mount('/settings/about');
    mockSave.mockClear();
    for (let index = 0; index < 10; index++)
      fireEvent(document, new Event('scroll'));
    expect(mockSave).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(200));
    expect(mockSave).toHaveBeenCalledTimes(1);
    fireEvent(document, new Event('scroll'));
    fireEvent(window, new Event('pagehide'));
    expect(mockSave).toHaveBeenCalledTimes(2);
    act(() => jest.advanceTimersByTime(200));
    expect(mockSave).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

it.each(['/send/eth', '/send/sys'])(
  'does not overwrite live form-owned draft values on %s',
  (path) => {
    mount({ pathname: path, state: { formValues: { amount: 'stale' } } });
    fireEvent(window, new Event('pagehide'));
    expect(mockSave).not.toHaveBeenCalled();
  }
);

it('restores a sanitized scoped draft without automatically saving the old form snapshot', async () => {
  mockLoad.mockResolvedValue({
    ...saved(),
    currentPath: '/send/eth',
    state: {
      formValues: { amount: '1.00001', receiver: 'synthetic-recipient' },
    },
  });
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('route').textContent).toBe('/send/eth')
  );
  expect(
    JSON.parse(screen.getByTestId('state').textContent!).formValues.amount
  ).toBe('1.00001');
  fireEvent(window, new Event('pagehide'));
  expect(mockSave).not.toHaveBeenCalled();
});
