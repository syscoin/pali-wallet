/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import WalletErrorBoundary from './WalletErrorBoundary';

const lockedErrors = [
  'Target keyring is locked',
  'Wallet must be unlocked',
  'Wallet is locked',
  'Please unlock the wallet first',
  'No unlocked keyring found',
];

// The boundary and router are real. Route contents are finite fixtures; no
// authentication, controller, signing, or financial operation is simulated.
const mount = (
  message: string,
  options: {
    initial?: string;
    preventRedirect?: boolean;
    rootThrows?: boolean;
  } = {}
) => {
  const navigated = jest.fn();
  const ProtectedChild = ({ fail }: { fail: boolean }) => {
    if (fail) throw new Error(message);
    return <p>Protected content</p>;
  };
  const Harness = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [fail, setFail] = React.useState(false);
    return (
      <>
        <p data-testid="route">{pathname}</p>
        <button onClick={() => navigate('/')}>Navigate to Unlock</button>
        <button onClick={() => setFail(true)}>Trigger render error</button>
        <WalletErrorBoundary
          pathname={pathname}
          navigate={
            ((...args: any[]) => {
              navigated(...args);
              if (!options.preventRedirect) (navigate as any)(...args);
            }) as any
          }
        >
          <Routes>
            <Route path="/protected" element={<ProtectedChild fail={fail} />} />
            <Route
              path="/"
              element={
                options.rootThrows ? (
                  <ProtectedChild fail={fail} />
                ) : (
                  <button>Unlock</button>
                )
              }
            />
          </Routes>
        </WalletErrorBoundary>
      </>
    );
  };
  render(
    <MemoryRouter initialEntries={[options.initial || '/protected']}>
      <Harness />
    </MemoryRouter>
  );
  // Mount the actual router before the render fault: useNavigate deliberately
  // ignores attempts made before its first subscription effect is installed.
  fireEvent.click(screen.getByRole('button', { name: 'Trigger render error' }));
  return navigated;
};

beforeEach(() => {
  // React reports intentionally thrown render errors to the console even when
  // a real error boundary handles them. Keep this finite error fixture quiet.
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each(lockedErrors)(
  'renders the actual Unlock route after a protected child throws "%s"',
  async (message) => {
    const navigated = mount(message);
    await waitFor(() =>
      expect(screen.getByTestId('route').textContent).toBe('/')
    );
    expect(navigated).toHaveBeenCalledWith('/', { replace: true });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unlock' })).toBeTruthy()
    );
    expect(screen.queryByText('Something went wrong')).toBeNull();
  }
);

it('keeps visible recovery feedback while a locked error has not changed the actual pathname', () => {
  const navigated = mount('Wallet is locked', { preventRedirect: true });
  expect(screen.getByTestId('route').textContent).toBe('/protected');
  expect(screen.getByRole('button', { name: 'Refresh Page' })).toBeTruthy();
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(navigated).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull();
});

it('never retries a persistent locked error at the same root pathname', () => {
  const navigated = mount('Wallet is locked', {
    initial: '/',
    rootThrows: true,
  });
  expect(screen.getByTestId('route').textContent).toBe('/');
  expect(screen.getByRole('button', { name: 'Refresh Page' })).toBeTruthy();
  expect(navigated).toHaveBeenCalledTimes(1);
});

it('bounds recovery when the redirected root itself throws the same locked error', () => {
  const navigated = mount('Wallet is locked', { rootThrows: true });
  expect(screen.getByTestId('route').textContent).toBe('/');
  expect(screen.getByRole('button', { name: 'Refresh Page' })).toBeTruthy();
  expect(navigated).toHaveBeenCalledTimes(2);
});

it('does not clear an arbitrary render error after navigation to root', () => {
  const navigated = mount('Unrelated render failure');
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(navigated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Navigate to Unlock' }));
  expect(screen.getByTestId('route').textContent).toBe('/');
  expect(screen.getByRole('button', { name: 'Refresh Page' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull();
});
