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
  ])('keeps the global overlay off dapp switch approval %s', (pathname) => {
    expect(isPageLoadingOverlayExcluded(pathname)).toBe(true);
  });

  it('still permits the overlay on ordinary wallet pages', () => {
    expect(isPageLoadingOverlayExcluded('/home')).toBe(false);
  });
});

describe('context-sensitive actions', () => {
  it.each([
    '/send/eth',
    '/external/tx/sign',
    '/tokens/add',
    '/settings/account/new',
    '/settings/account/private-key',
    '/settings/account/import',
    '/settings/edit-account',
    '/settings/forget-wallet',
    '/settings/seed',
    '/external/settings/account/hardware',
    '/external/smart-account',
    '/external/smart-account-modules',
    '/external/watch-asset',
  ])('guards %s during account/network transitions', (route) => {
    expect(isContextSensitiveWalletRoute(route)).toBe(true);
  });
  it.each([
    '/home',
    '/receive',
    '/settings/manage-accounts',
    '/switch-network',
    '/settings/networks/custom-rpc',
  ])('keeps navigation and recovery route %s available', (route) => {
    expect(isContextSensitiveWalletRoute(route)).toBe(false);
  });
});
