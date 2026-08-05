import { isPageLoadingOverlayExcluded } from './usePageLoadingState';

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
