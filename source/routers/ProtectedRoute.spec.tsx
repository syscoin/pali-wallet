/** @jest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react';
import React, { lazy, Suspense } from 'react';
import {
  HashRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { ProtectedRoute } from './ProtectedRoute';

let mockAuth: { isLoading: boolean; isUnlocked: boolean };
const mockAppReady = jest.fn();

jest.mock('hooks/useController', () => ({ useController: () => mockAuth }));
jest.mock('hooks/useAppReady', () => ({
  useAppReady: (ready: boolean) => mockAppReady(ready),
}));
jest.mock('components/Loader/AppLoadingSkeleton', () => ({
  AppLoadingSkeleton: () => <p role="status">Loading wallet view</p>,
}));

const routeHistory: string[] = [];
const RouteProbe = () => {
  const location = useLocation();
  routeHistory.push(location.pathname);
  return <span data-testid="route">{location.pathname}</span>;
};

const fixture = () => {
  let resolve!: (value: { default: React.ComponentType }) => void;
  const pendingAuth = new Promise<{ default: React.ComponentType }>((done) => {
    resolve = done;
  });
  const Auth = lazy(() => pendingAuth);
  const tree = () => (
    <HashRouter>
      <RouteProbe />
      <Suspense fallback={<p role="status">Loading authentication view</p>}>
        <Routes>
          <Route path="/" element={<Auth />}>
            <Route path="/" element={<p>Unlock wallet</p>} />
          </Route>
          <Route
            element={
              <ProtectedRoute element={<p>Protected wallet content</p>} />
            }
          >
            <Route path="/home" element={<p>Home</p>} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
  const resolveAuth = async () => {
    await act(async () => {
      resolve({ default: Outlet });
      await pendingAuth;
    });
  };
  return { tree, resolveAuth };
};

// Native fragment navigation is intentional: the saved restart trace used a
// same-document navigation while the first locked redirect was still loading.
// A native entry can reuse the initial "default" key, so pathname/key-only
// redirect dependencies do not cover returning to the same protected route.
const returnToHome = async () => {
  await act(async () => {
    const changed = new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
    });
    window.location.hash = '/home';
    await changed;
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  routeHistory.length = 0;
  mockAuth = { isLoading: false, isUnlocked: false };
  window.history.replaceState(null, '', '/app.html#/home');
});

it('recovers a repeated native Home navigation while the lazy locked route is pending', async () => {
  const app = fixture();
  render(app.tree());
  await waitFor(() =>
    expect(screen.getByTestId('route').textContent).toBe('/')
  );
  expect(screen.queryByText('Protected wallet content')).toBeNull();

  await returnToHome();
  await app.resolveAuth();

  await waitFor(() => expect(screen.getByText('Unlock wallet')).toBeTruthy());
  expect(window.location.hash).toBe('#/');
  expect(screen.queryByText('Protected wallet content')).toBeNull();
  expect(routeHistory.filter((route) => route === '/home')).toHaveLength(2);
});

it('redirects an ordinary locked wallet after its authentication chunk resolves', async () => {
  const app = fixture();
  render(app.tree());
  await app.resolveAuth();
  expect(screen.getByText('Unlock wallet')).toBeTruthy();
  expect(window.location.hash).toBe('#/');
  expect(screen.queryByText('Protected wallet content')).toBeNull();
});

it('redirects native Home navigation after authentication has already mounted', async () => {
  const app = fixture();
  render(app.tree());
  await app.resolveAuth();
  await returnToHome();
  expect(screen.getByText('Unlock wallet')).toBeTruthy();
  expect(window.location.hash).toBe('#/');
});

it('keeps content hidden while auth is pending and renders it only after unlock is confirmed', () => {
  mockAuth = { isLoading: true, isUnlocked: false };
  const app = fixture();
  const view = render(app.tree());
  expect(screen.getByRole('status').textContent).toBe('Loading wallet view');
  expect(window.location.hash).toBe('#/home');
  expect(screen.queryByText('Protected wallet content')).toBeNull();

  mockAuth = { isLoading: false, isUnlocked: true };
  view.rerender(app.tree());
  expect(screen.getByText('Protected wallet content')).toBeTruthy();
  expect(window.location.hash).toBe('#/home');
});

it('redirects when the pending auth read resolves locked, without showing protected content', async () => {
  mockAuth = { isLoading: true, isUnlocked: false };
  const app = fixture();
  const view = render(app.tree());
  mockAuth = { isLoading: false, isUnlocked: false };
  view.rerender(app.tree());
  await app.resolveAuth();
  expect(screen.getByText('Unlock wallet')).toBeTruthy();
  expect(screen.queryByText('Protected wallet content')).toBeNull();
});

it.each([false, true])(
  'preserves the external-document exception when unlocked is %s',
  (isUnlocked) => {
    window.history.replaceState(null, '', '/external.html#/home');
    mockAuth = { isLoading: false, isUnlocked };
    const app = fixture();
    render(app.tree());
    expect(screen.getByText('Protected wallet content')).toBeTruthy();
    expect(window.location.hash).toBe('#/home');
    expect(mockAppReady).toHaveBeenLastCalledWith(isUnlocked);
  }
);

it('still waits for an external auth read before rendering the external document', () => {
  window.history.replaceState(null, '', '/external.html#/home');
  mockAuth = { isLoading: true, isUnlocked: false };
  const app = fixture();
  render(app.tree());
  expect(screen.getByRole('status').textContent).toBe('Loading wallet view');
  expect(screen.queryByText('Protected wallet content')).toBeNull();
  expect(window.location.hash).toBe('#/home');
  expect(mockAppReady).toHaveBeenLastCalledWith(false);
});
