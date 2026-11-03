/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
  BrowserRouter,
  HashRouter,
  Outlet,
  useLocation,
} from 'react-router-dom';

import { Router } from './index';

let mockUnlocked = true;
jest.mock('hooks/useController', () => ({
  useController: () => ({ isUnlocked: mockUnlocked, isLoading: false }),
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useNavigationState', () => ({
  useNavigationState: jest.fn(),
}));
jest.mock('hooks/useOnboardingSecrets', () => ({
  OnboardingSecretsProvider: ({ children }: any) => children,
}));
jest.mock('routers/useRouterLogic', () => ({
  useRouterLogic: () => ({
    showModal: false,
    setShowModal: jest.fn(),
    showUtf8ErrorModal: false,
    handleUtf8ErrorClose: jest.fn(),
    t: (key: string) => key,
  }),
}));
jest.mock('components/Modal', () => ({ WarningModal: () => null }));
jest.mock('components/Loader/AppLoadingSkeleton', () => ({
  AppLoadingSkeleton: () => <span>Loading route</span>,
}));
jest.mock('components/Layout/AppLayout', () => ({
  AppLayout: () => <Outlet />,
}));
jest.mock('./routes/AuthRoutes', () => ({
  __esModule: true,
  default: () => <Outlet />,
}));
jest.mock('pages/Start/Start', () => ({
  Start: () => <span>Unlock fixture</span>,
}));
jest.mock('pages/Connections/ConnectWallet', () => ({
  ConnectWallet: () => <span>Connect fixture</span>,
}));
jest.mock('pages/Transactions/SignEth', () => ({
  __esModule: true,
  default: () => <span>Sign fixture</span>,
}));
jest.mock('pages/Settings/SmartAccountPolicy', () => ({
  __esModule: true,
  default: () => <span>Policy fixture</span>,
}));

const Probe = () => {
  const location = useLocation();
  return <output data-testid="location">{JSON.stringify(location)}</output>;
};
const location = () => JSON.parse(screen.getByTestId('location').textContent!);
const renderExternal = () =>
  render(
    <BrowserRouter useTransitions={false}>
      <Probe />
      <Router />
    </BrowserRouter>
  );

beforeEach(() => {
  mockUnlocked = true;
  jest.clearAllMocks();
});

it('opens a protected popup deep link without changing the extension document path', async () => {
  window.history.replaceState(
    null,
    '',
    '/app.html#/settings/account/smart-account-policy?tab=limits'
  );
  render(
    <HashRouter useTransitions={false}>
      <Probe />
      <Router />
    </HashRouter>
  );
  await screen.findByText('Policy fixture');
  expect(location().pathname).toBe('/settings/account/smart-account-policy');
  expect(location().search).toBe('?tab=limits');
  expect(window.location.pathname).toBe('/app.html');
});

it.each([
  ['connect-wallet', 'Connect fixture'],
  ['tx/ethSign', 'Sign fixture'],
])(
  'opens external %s and preserves encoded approval data',
  async (route, label) => {
    const data = JSON.stringify({ requestId: 17, text: 'a&b=+#%/?' });
    const query = new URLSearchParams({ route, data });
    window.history.replaceState(null, '', `/external.html?${query}`);
    renderExternal();
    await screen.findByText(label);
    expect(location().pathname).toBe(`/external/${route}`);
    expect(new URLSearchParams(location().search).get('data')).toBe(data);
    expect(window.location.origin).toBe('http://localhost');
  }
);

it('keeps the requested external route and data while routing a locked wallet to login', async () => {
  mockUnlocked = false;
  const data = JSON.stringify({ requestId: 18, text: 'pending approval' });
  const query = new URLSearchParams({ route: 'tx/ethSign', data });
  window.history.replaceState(null, '', `/external.html?${query}`);
  renderExternal();
  await screen.findByText('Unlock fixture');
  expect(location().pathname).toBe('/');
  const saved = new URLSearchParams(location().search);
  expect(saved.get('externalRoute')).toBe('tx/ethSign');
  expect(saved.get('data')).toBe(data);
});

it('closes an already-unlocked external login window exactly once', async () => {
  const close = jest.spyOn(window, 'close').mockImplementation(() => undefined);
  window.history.replaceState(null, '', '/external.html?route=login');
  renderExternal();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  close.mockRestore();
});

it.each(['//attacker.invalid', '\\attacker.invalid', '/\\attacker.invalid'])(
  'keeps ambiguous external route input %s within the current origin',
  async (route) => {
    const query = new URLSearchParams({ route });
    window.history.replaceState(null, '', `/external.html?${query}`);
    renderExternal();
    await waitFor(() => expect(location().pathname).not.toBe('/external.html'));
    expect(window.location.origin).toBe('http://localhost');
    expect(location().pathname).toMatch(/^\/external\//);
  }
);
