/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import en from 'assets/locales/en.json';

import { AppLayout } from './AppLayout';

let mockPath = '/receive';
let mockChanging = false;
let mockUnavailable = false;
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPath, search: '', hash: '', state: {} }),
  useNavigate: () => mockNavigate,
  Outlet: () => <main>Page content</main>,
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: { activeNetwork: { currency: 'tsys' } },
      vaultGlobal: { networkStatus: mockChanging ? 'switching' : 'idle' },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const catalog = jest.requireActual('assets/locales/en.json');
      const message = key
        .split('.')
        .reduce((entry: any, part) => entry?.[part], catalog);
      return typeof message === 'string'
        ? message.replace(/{{(\w+)}}/g, (_match, name) =>
            String(values[name] ?? '')
          )
        : key;
    },
  }),
}));
jest.mock('components/Header/Header', () => ({
  Header: () => <nav>Wallet navigation</nav>,
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  IconButton: (props: any) => <button {...props} />,
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useBrowsingNavigationScroll', () => ({
  useBrowsingNavigationScroll: jest.fn(),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ connectionUnavailable: mockUnavailable }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  ...jest.requireActual('hooks/usePageLoadingState'),
  usePageLoadingState: () => ({
    isLoading: true,
    isContextChanging: mockChanging,
    message: jest.requireActual('assets/locales/en.json').networkConnection
      .updatingBalances,
  }),
}));
jest.mock('utils/navigationState', () => ({
  navigateBack: jest.fn(),
  getWalletNavigationScope: () => ({
    account: 'synthetic',
    network: 'synthetic',
  }),
}));

const slowText = en.networkConnection.operationSlow.replace(
  '{{operation}}',
  en.networkConnection.updatingBalances
);
const advance = () =>
  act(() => {
    jest.advanceTimersByTime(2000);
  });
const layoutOwner = () =>
  document.querySelector('[data-navigation-scroll="wallet-layout"]')!;
const precedes = (first: Element, second: Element) =>
  Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING
  );

beforeEach(() => {
  jest.useFakeTimers();
  mockPath = '/receive';
  mockChanging = false;
  mockUnavailable = false;
  jest.clearAllMocks();
});
afterEach(() => {
  cleanup();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it.each(['/home', '/receive', '/settings/advanced'])(
  'places real slow status after available navigation/title and before page content at %s',
  (path) => {
    mockPath = path;
    render(
      <AppLayout>
        <button>Current page action</button>
      </AppLayout>
    );
    advance();
    const status = screen.getByText(slowText).closest('[role="status"]')!;
    const action = screen.getByRole('button', { name: 'Current page action' });
    expect(status.parentElement).toBe(layoutOwner());
    expect(status.nextElementSibling).toContainElement(action);
    expect(precedes(status, action)).toBe(true);
    expect(status.closest('[inert]')).toBeNull();
    expect(action.closest('[inert]')).toBeNull();
    const navigation = screen.queryByRole('navigation');
    if (navigation) expect(precedes(navigation, status)).toBe(true);
    const banner = layoutOwner().querySelector('img[alt=""]')?.parentElement;
    if (banner) expect(precedes(banner, status)).toBe(true);
    expect(status).toHaveClass('pointer-events-none', 'shrink-0');
    expect(status).not.toHaveClass('fixed');
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);

it.each(['/external/connect-wallet', '/external/settings/account/hardware'])(
  'retains the existing fixed slow status outside guarded content for headerless %s',
  (path) => {
    mockPath = path;
    render(
      <AppLayout>
        <div className="fixed inset-0 bg-brand-blue600">
          <button>Headerless page action</button>
        </div>
      </AppLayout>
    );
    advance();
    const status = screen.getByText(slowText).closest('[role="status"]')!;
    const action = screen.getByRole('button', {
      name: 'Headerless page action',
    });
    expect(status.parentElement).toBe(layoutOwner());
    expect(status.nextElementSibling).toContainElement(action);
    expect(status.closest('[inert]')).toBeNull();
    expect(status).toHaveClass(
      'fixed',
      'bottom-3',
      'left-3',
      'right-3',
      'z-[55]',
      'pointer-events-none'
    );
    expect(status).not.toHaveClass('mx-3');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);

it.each(['/receive', '/RECEIVE/', '/%72eceive'])(
  'keeps stale Receive content hidden at %s while the real slow status stays outside inert content',
  (path) => {
    mockPath = path;
    mockChanging = true;
    render(
      <AppLayout>
        <svg aria-label="Old receive QR" />
        <button>Copy old address</button>
      </AppLayout>
    );
    advance();
    const status = screen.getByText(slowText).closest('[role="status"]')!;
    expect(
      screen.queryByRole('button', { name: 'Copy old address' })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Old receive QR')).not.toBeInTheDocument();
    expect(status.closest('[inert]')).toBeNull();
    expect(status.nextElementSibling).toHaveAttribute('inert', '');
    expect(status.nextElementSibling).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('navigation').closest('[inert]')).toBeNull();
  }
);

it.each(['/settings/advanced', '/external/connect-wallet'])(
  'keeps %s actions inert throughout the slow phase without putting progress inside that guard',
  (path) => {
    mockPath = path;
    mockChanging = true;
    render(
      <AppLayout>
        <button>Context-sensitive action</button>
      </AppLayout>
    );
    advance();
    const status = screen.getByText(slowText).closest('[role="status"]')!;
    expect(
      screen.getByText('Context-sensitive action').closest('[inert]')
    ).not.toBeNull();
    expect(status.closest('[inert]')).toBeNull();
    expect(status.nextElementSibling).toHaveAttribute('aria-busy', 'true');
  }
);

it('keeps unavailable-worker progress outside guards while unmounting a cached secret view', () => {
  mockPath = '/settings/seed';
  mockUnavailable = true;
  render(
    <AppLayout>
      <p>Cached synthetic plaintext</p>
    </AppLayout>
  );
  const status = screen
    .getByText(en.components.walletServiceReconnecting)
    .closest('[role="status"]')!;
  expect(status.parentElement).toBe(layoutOwner());
  expect(status.closest('[inert]')).toBeNull();
  expect(status.nextElementSibling).toHaveAttribute('inert', '');
  expect(
    screen.queryByText('Cached synthetic plaintext')
  ).not.toBeInTheDocument();
  expect(screen.getByRole('navigation').closest('[inert]')).toBeNull();
});
