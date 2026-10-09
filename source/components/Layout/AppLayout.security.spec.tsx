import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppLayout } from './AppLayout';

let mockPath = '/home';
let mockUnavailable = false;
let mockChanging = false;
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPath }),
  useNavigate: () => jest.fn(),
  Outlet: () => <main>Secret view</main>,
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: { activeNetwork: { currency: 'sys' } },
      vaultGlobal: { networkStatus: mockChanging ? 'switching' : 'idle' },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Header/Header', () => ({
  Header: () => <nav>Wallet navigation</nav>,
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  IconButton: () => <button>Back</button>,
}));
jest.mock('components/Loading/PageLoadingOverlay', () => ({
  PageLoadingOverlay: () => null,
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ connectionUnavailable: mockUnavailable }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  ...jest.requireActual('hooks/usePageLoadingState'),
  usePageLoadingState: () => ({
    isLoading: mockChanging,
    isContextChanging: mockChanging,
  }),
}));
jest.mock('utils/navigationState', () => ({
  navigateBack: jest.fn(),
  clearNavigationState: jest.fn(),
}));

describe('wallet content safety during background changes', () => {
  beforeEach(() => {
    mockPath = '/home';
    mockUnavailable = false;
    mockChanging = false;
  });

  it.each([
    '/settings/seed',
    '/settings/account/private-key',
    '/settings/forget-wallet',
    '/settings/seed/',
    '/Settings/Seed',
    '/settings/account/private-key/',
    '/SETTINGS/ACCOUNT/PRIVATE-KEY',
    '/settings/forget-wallet/',
    '/SETTINGS/FORGET-WALLET',
    '/%73ettings/%73eed',
  ])('unmounts secret content at %s while preserving navigation', (path) => {
    mockPath = path;
    mockUnavailable = true;
    const SecretContent = jest.fn(() => <p>Cached plaintext secret</p>);
    const markup = renderToStaticMarkup(
      <AppLayout>
        <SecretContent />
      </AppLayout>
    );
    expect(SecretContent).not.toHaveBeenCalled();
    expect(markup).not.toContain('Cached plaintext secret');
    expect(markup).toContain('Wallet navigation');
    expect(markup).toContain('Reconnect to your wallet');
  });

  it.each(['/home', '/HOME/', '/%68ome'])(
    'makes Home actions inert at %s during a transition but keeps the header outside',
    (path) => {
      mockPath = path;
      mockChanging = true;
      const markup = renderToStaticMarkup(
        <AppLayout>
          <button>Delete token</button>
        </AppLayout>
      );
      expect(markup).toContain('inert=""');
      expect(markup.indexOf('</nav>')).toBeLessThan(markup.indexOf('inert=""'));
      expect(markup.indexOf('inert=""')).toBeLessThan(
        markup.indexOf('Delete token')
      );
    }
  );

  it('keeps ordinary wallet content visible during reconnection', () => {
    mockUnavailable = true;
    const markup = renderToStaticMarkup(
      <AppLayout>
        <p>Account balances</p>
      </AppLayout>
    );
    expect(markup).toContain('Account balances');
    expect(markup).toContain('Wallet navigation');
  });
});
