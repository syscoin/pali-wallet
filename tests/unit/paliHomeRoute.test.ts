import { expect as playwrightExpect } from '@playwright/test';

import { PaliWallet } from '../../e2e/harness/pali';

jest.mock('@playwright/test', () => ({ expect: { poll: jest.fn() } }));

describe('Pali harness exact Home route', () => {
  const origin = 'chrome-extension://disposable-test-extension/app.html';
  const setup = (initialUrl: string, initiallyLocked = false) => {
    let url = initialUrl;
    let locked = initiallyLocked;
    const isHome = () => new URL(url).hash.split('?')[0] === '#/home';
    const balance = {
      first: jest.fn(),
      isVisible: jest.fn(async () => isHome() && !locked),
      waitFor: jest.fn(async () => {
        if (!isHome() || locked) throw Error('Home balance is not visible');
      }),
    };
    balance.first.mockReturnValue(balance);
    const unlock = { isVisible: jest.fn(async () => locked) };
    const page = {
      url: jest.fn(() => url),
      goto: jest.fn(async (next: string) => {
        url = next;
      }),
      locator: jest.fn((selector: string) => {
        if (selector === '#home-balance, #home-balance-pending') return balance;
        if (selector === '#unlock-btn') return unlock;
        throw Error(`Unexpected locator: ${selector}`);
      }),
    };
    const wallet = Object.assign(Object.create(PaliWallet.prototype), {
      page,
      extensionId: 'disposable-test-extension',
      waitAppReady: jest.fn().mockResolvedValue(undefined),
      unlock: jest.fn(async () => {
        locked = false;
      }),
      dismissBlockingModals: jest.fn().mockResolvedValue(undefined),
    }) as PaliWallet;
    (playwrightExpect.poll as jest.Mock).mockImplementation(
      (read: () => Promise<boolean>) => ({
        toBe: async (expected: boolean) => expect(await read()).toBe(expected),
      })
    );
    return { wallet, page, balance };
  };

  beforeEach(() => jest.clearAllMocks());

  it.each([
    '#/home/smart-account',
    '#/home/smart-account?tab=validators',
    '#/home-other',
    '#/home/',
    '#/settings?returnTo=/home',
    '#/send/eth?next=%23%2Fhome',
  ])('navigates from %s using the ordinary Home driver path', async (route) => {
    const { wallet, page, balance } = setup(origin + route);
    await wallet.ensureOnHome();
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith(origin + '#/home');
    expect(wallet.waitAppReady).toHaveBeenCalledTimes(1);
    expect(balance.waitFor).toHaveBeenCalledWith({
      state: 'visible',
      timeout: 60000,
    });
    expect(wallet.dismissBlockingModals).toHaveBeenCalledTimes(1);
  });

  it.each([
    origin + '#/home',
    origin + '#/home?tab=activity',
    origin + '?document=value#/home?tab=activity&returnTo=%2Fsmart-account',
  ])('retains an exact Home path and ignores its query: %s', async (url) => {
    const { wallet, page, balance } = setup(url);
    await wallet.ensureOnHome();
    expect(page.goto).not.toHaveBeenCalled();
    expect(balance.waitFor).toHaveBeenCalledTimes(1);
    expect(wallet.dismissBlockingModals).toHaveBeenCalledTimes(1);
  });

  it('still unlocks an exact Home route that redirects through the normal lock UI', async () => {
    const { wallet, page, balance } = setup(origin + '#/home', true);
    await wallet.ensureOnHome();
    expect(page.goto).not.toHaveBeenCalled();
    expect(wallet.unlock).toHaveBeenCalledTimes(1);
    expect(balance.waitFor).toHaveBeenCalledTimes(1);
  });
});
