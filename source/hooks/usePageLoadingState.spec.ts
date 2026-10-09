import {
  isContextSensitiveWalletRoute,
  isPageLoadingOverlayExcluded,
} from './usePageLoadingState';

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
    '/receive',
    '/switch-network',
    '/settings/about',
    '/settings/networks/connected-sites',
    '/settings/networks/trusted-sites',
  ])('keeps navigation and recovery route %s available', (route) => {
    expect(isContextSensitiveWalletRoute(route)).toBe(false);
  });
});
