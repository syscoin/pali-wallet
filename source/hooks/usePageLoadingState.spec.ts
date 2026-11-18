/** @jest-environment jsdom */

import { renderHook } from '@testing-library/react';

import {
  isContextSensitiveWalletRoute,
  isPageLoadingOverlayExcluded,
  usePageLoadingState,
} from './usePageLoadingState';

let mockPathname = '/home';
let mockNetworkStatus = 'idle';
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: (state: unknown) => unknown) =>
    select({
      vaultGlobal: {
        networkStatus: mockNetworkStatus,
        isSwitchingAccount: false,
        loadingStates: { isLoadingBalances: true },
        isPollingUpdate: false,
      },
    }),
}));

describe('wallet loading feedback', () => {
  it.each(['/send/eth', '/send/sys', '/send/confirm', '/EXTERNAL/SEND/ETH/'])(
    'keeps balance-only updates from covering %s',
    (pathname) => {
      mockPathname = pathname;
      mockNetworkStatus = 'idle';
      const { result, rerender } = renderHook(() => usePageLoadingState());
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isContextChanging).toBe(false);

      mockNetworkStatus = 'switching';
      rerender();
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isContextChanging).toBe(true);
    }
  );

  it('still provides explicit balance refresh feedback on Home', () => {
    mockPathname = '/home';
    mockNetworkStatus = 'idle';
    const { result } = renderHook(() => usePageLoadingState());
    expect(result.current).toEqual({
      isLoading: true,
      isContextChanging: false,
      message: 'networkConnection.updatingBalances',
    });
  });
});

describe('isPageLoadingOverlayExcluded', () => {
  it.each([
    '/external/switch-network',
    '/external/add-EthChain',
    '/external/switch-EthChain',
    '/external/switch-UtxoEvm',
    '/EXTERNAL/SWITCH-ETHCHAIN/',
    '/settings/networks/custom-rpc',
  ])('keeps the global overlay off dapp switch approval %s', (pathname) => {
    expect(isPageLoadingOverlayExcluded(pathname)).toBe(true);
  });

  it('still permits the overlay on ordinary wallet pages', () => {
    expect(isPageLoadingOverlayExcluded('/home')).toBe(false);
  });
});

describe('context-sensitive actions', () => {
  it.each([
    '/home',
    '/receive',
    '/RECEIVE/',
    '/%72eceive',
    '/faucet',
    '/FAUCET/',
    '/%66aucet',
    '/send/eth',
    '/external/tx/sign',
    '/tokens/add',
    '/settings/account/new',
    '/settings/account/private-key',
    '/settings/account/import',
    '/settings/edit-account',
    '/settings/manage-accounts',
    '/SETTINGS/MANAGE-ACCOUNTS/',
    '/%73ettings/manage-accounts',
    '/settings/forget-wallet',
    '/settings/seed',
    '/settings/advanced',
    '/SETTINGS/ADVANCED/',
    '/settings/networks/edit',
    '/SETTINGS/NETWORKS/EDIT/',
    '/%73ettings/networks/%65dit',
    '/settings/networks/custom-rpc',
    '/SETTINGS/NETWORKS/CUSTOM-RPC/',
    '/%73ettings/networks/custom-rpc',
    '/external/settings/account/hardware',
    '/external/smart-account',
    '/external/smart-account-modules',
    '/external/watch-asset',
    '/HOME/',
    '/SEND/ETH/',
    '/Settings/Seed/',
    '/settings/forget-wallet/',
    '/%73ettings/account/private-key',
    '/EXTERNAL/SMART-ACCOUNT/',
    '/external/connect-wallet',
    '/external/change-account',
    '/external/change-active-connected-account',
    '/EXTERNAL/CONNECT-WALLET/',
  ])('guards %s during account/network transitions', (route) => {
    expect(isContextSensitiveWalletRoute(route)).toBe(true);
  });
  it.each([
    '/switch-network',
    '/settings/about',
    '/settings/networks/connected-sites',
    '/settings/networks/trusted-sites',
  ])('keeps navigation and recovery route %s available', (route) => {
    expect(isContextSensitiveWalletRoute(route)).toBe(false);
  });
});
