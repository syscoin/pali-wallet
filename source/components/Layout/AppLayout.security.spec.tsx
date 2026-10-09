import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppLayout } from './AppLayout';

let mockPath = '/home';
let mockUnavailable = false;
let mockChanging = false;
let mockOverlayLoading = true;
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
    isLoading: mockChanging && mockOverlayLoading,
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
    mockOverlayLoading = true;
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

  it.each(['/receive', '/RECEIVE/', '/%72eceive'])(
    'hides receive addresses at %s until context is authoritative',
    (path) => {
      mockPath = path;
      mockOverlayLoading = false;
      const ReceiveContent = jest.fn(() => (
        <div>
          <svg aria-label="Receive QR code" />
          <button>Copy old address</button>
        </div>
      ));
      for (const unavailable of [false, true]) {
        mockUnavailable = unavailable;
        mockChanging = !unavailable;
        const markup = renderToStaticMarkup(
          <AppLayout>
            <ReceiveContent />
          </AppLayout>
        );
        expect(ReceiveContent).not.toHaveBeenCalled();
        expect(markup).not.toContain('Receive QR code');
        expect(markup).not.toContain('Copy old address');
        expect(markup).toContain('Wallet navigation');
        expect(markup).toContain('inert=""');
      }
      mockUnavailable = false;
      mockChanging = false;
      const settled = renderToStaticMarkup(
        <AppLayout>
          <ReceiveContent />
        </AppLayout>
      );
      expect(settled).toContain('Receive QR code');
      expect(settled).toContain('Copy old address');
      expect(settled).not.toContain('inert=""');
    }
  );

  it.each(['/faucet', '/FAUCET/', '/%66aucet'])(
    'keeps faucet claims at %s inert until the wallet context settles',
    (path) => {
      mockPath = path;
      // The bounded loading overlay can already have stopped blocking while
      // the account/network is still changing or the worker is unavailable.
      mockOverlayLoading = false;
      const content = <button>Request faucet tokens</button>;
      for (const unavailable of [false, true]) {
        mockUnavailable = unavailable;
        mockChanging = !unavailable;
        const markup = renderToStaticMarkup(<AppLayout>{content}</AppLayout>);
        expect(markup).toContain('inert=""');
        expect(markup.indexOf('</nav>')).toBeLessThan(
          markup.indexOf('inert=""')
        );
        expect(markup.indexOf('inert=""')).toBeLessThan(
          markup.indexOf('Request faucet tokens')
        );
      }

      mockUnavailable = false;
      mockChanging = false;
      const settled = renderToStaticMarkup(<AppLayout>{content}</AppLayout>);
      expect(settled).not.toContain('inert=""');
      expect(settled).toContain('Request faucet tokens');
    }
  );

  it.each([
    '/settings/networks/edit',
    '/SETTINGS/NETWORKS/EDIT/',
    '/%73ettings/networks/%65dit',
    '/settings/networks/custom-rpc',
    '/SETTINGS/NETWORKS/CUSTOM-RPC/',
  ])(
    'keeps network mutations at %s guarded independently of the loading overlay',
    (path) => {
      mockPath = path;
      mockChanging = true;
      // The route guard must survive the overlay becoming nonblocking or being
      // excluded for CustomRPC; its safety depends on the transition itself.
      mockOverlayLoading = false;
      const content = <button>Delete or edit network</button>;
      const markup = renderToStaticMarkup(<AppLayout>{content}</AppLayout>);
      expect(markup).toContain('inert=""');
      expect(markup.indexOf('</nav>')).toBeLessThan(markup.indexOf('inert=""'));
      expect(markup.indexOf('inert=""')).toBeLessThan(
        markup.indexOf('Delete or edit network')
      );

      mockChanging = false;
      const settled = renderToStaticMarkup(<AppLayout>{content}</AppLayout>);
      expect(settled).not.toContain('inert=""');
      expect(settled).toContain('Delete or edit network');
    }
  );

  it.each([
    '/external/connect-wallet',
    '/external/change-account',
    '/external/change-active-connected-account',
  ])(
    'disables account consent at %s during a transition or disconnection',
    (path) => {
      mockPath = path;
      for (const unavailable of [false, true]) {
        mockUnavailable = unavailable;
        mockChanging = !unavailable;
        const markup = renderToStaticMarkup(
          <AppLayout>
            <button>Confirm account permission</button>
          </AppLayout>
        );
        expect(markup).toContain('inert=""');
        expect(markup.indexOf('inert=""')).toBeLessThan(
          markup.indexOf('Confirm account permission')
        );
      }
    }
  );
});
