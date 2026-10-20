/** @jest-environment jsdom */
import { expect as playwrightExpect } from '@playwright/test';

import { PaliWallet } from '../../e2e/harness/pali';

jest.mock('@playwright/test', () => ({ expect: { poll: jest.fn() } }));

describe('Pali harness exact Home route', () => {
  const origin = 'chrome-extension://disposable-test-extension/app.html';
  const setup = (initialUrl: string, initiallyLocked = false) => {
    let url = initialUrl;
    let balanceVisible = !initiallyLocked;
    let controlsVisible = initiallyLocked;
    let submitEnabled = true;
    let observe: (attempt: number) => void = () => undefined;
    let afterSnapshot: () => void = () => undefined;
    document.body.innerHTML = `
      <div id="login"><input id="password"><button id="unlock-btn">Unlock</button></div>
    `;
    const loginElement = document.querySelector<HTMLElement>('#login')!;
    const passwordElement =
      document.querySelector<HTMLInputElement>('#password')!;
    const unlockElement =
      document.querySelector<HTMLButtonElement>('#unlock-btn')!;
    const syncDocument = () => {
      window.location.hash = new URL(url).hash;
      loginElement.style.visibility = controlsVisible ? 'visible' : 'hidden';
      passwordElement.style.visibility = controlsVisible ? 'visible' : 'hidden';
      unlockElement.style.visibility = controlsVisible ? 'visible' : 'hidden';
      unlockElement.disabled = !submitEnabled;
    };
    for (const element of [loginElement, passwordElement, unlockElement]) {
      jest.spyOn(element, 'getBoundingClientRect').mockImplementation(() => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 40,
        width: controlsVisible ? 100 : 0,
        height: controlsVisible ? 40 : 0,
        toJSON: () => ({}),
      }));
    }
    syncDocument();
    const isHome = () => new URL(url).hash.split('?')[0] === '#/home';
    const balance = {
      first: jest.fn(),
      isVisible: jest.fn(async () => isHome() && balanceVisible),
      waitFor: jest.fn(async () => {
        if (!isHome() || !balanceVisible)
          throw Error('Home balance is not visible');
      }),
    };
    balance.first.mockReturnValue(balance);
    const unlock = {
      isVisible: jest.fn(async () => controlsVisible),
      isEnabled: jest.fn(async () => {
        if (!controlsVisible)
          throw Error('Missing unlock locator would wait for its timeout');
        return submitEnabled;
      }),
    };
    const password = { isVisible: jest.fn(async () => controlsVisible) };
    const login = {
      isVisible: jest.fn(async () => controlsVisible),
      locator: jest.fn((selector: string) => {
        if (selector === '#password') return password;
        if (selector === '#unlock-btn') return unlock;
        throw Error(`Unexpected login locator: ${selector}`);
      }),
    };
    const page = {
      url: jest.fn(() => url),
      goto: jest.fn(async (next: string) => {
        url = next;
        syncDocument();
      }),
      evaluate: jest.fn(async (read: () => boolean) => {
        const result = read();
        afterSnapshot();
        return result;
      }),
      locator: jest.fn((selector: string) => {
        if (selector === '#home-balance, #home-balance-pending') return balance;
        if (selector === '#unlock-btn') return unlock;
        if (selector === '#login') return login;
        throw Error(`Unexpected locator: ${selector}`);
      }),
    };
    const wallet = Object.assign(Object.create(PaliWallet.prototype), {
      page,
      extensionId: 'disposable-test-extension',
      waitAppReady: jest.fn().mockResolvedValue(undefined),
      unlock: jest.fn(async () => {
        if (!controlsVisible || !submitEnabled)
          throw Error('No idle unlock form');
        controlsVisible = false;
        balanceVisible = true;
        url = origin + '#/home';
        syncDocument();
      }),
      dismissBlockingModals: jest.fn().mockResolvedValue(undefined),
    }) as PaliWallet;
    (playwrightExpect.poll as jest.Mock).mockImplementation(
      (read: () => Promise<boolean>) => ({
        toBe: async (expected: boolean) => {
          for (let attempt = 0; attempt < 4; attempt++) {
            observe(attempt);
            if ((await read()) === expected) return;
          }
          throw Error('Home did not become ready');
        },
      })
    );
    return {
      wallet,
      page,
      balance,
      unlock,
      setUrl: (next: string) => {
        url = next;
        syncDocument();
      },
      setBalanceVisible: (next: boolean) => {
        balanceVisible = next;
      },
      setControlsVisible: (next: boolean) => {
        controlsVisible = next;
        syncDocument();
      },
      setSubmitEnabled: (next: boolean) => {
        submitEnabled = next;
        syncDocument();
      },
      onPoll: (callback: (attempt: number) => void) => {
        observe = callback;
      },
      afterSnapshot: (callback: () => void) => {
        afterSnapshot = callback;
      },
    };
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
    const { wallet, page, balance, onPoll, setUrl } = setup(
      origin + '#/home',
      true
    );
    onPoll((attempt) => {
      if (attempt === 1) setUrl(origin + '#/');
    });
    await wallet.ensureOnHome();
    expect(page.goto).not.toHaveBeenCalled();
    expect(wallet.unlock).toHaveBeenCalledTimes(1);
    expect(balance.waitFor).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'never resubmits a stale Home-route unlock form (enabled=%s)',
    async (enabled) => {
      const { wallet, onPoll, setSubmitEnabled, setBalanceVisible } = setup(
        origin + '#/home',
        true
      );
      setSubmitEnabled(enabled);
      onPoll((attempt) => {
        if (attempt === 1) setBalanceVisible(true);
      });
      await wallet.ensureOnHome();
      expect(wallet.unlock).not.toHaveBeenCalled();
    }
  );

  it('waits for an in-flight unlock on the real root route instead of submitting twice', async () => {
    const { wallet, onPoll, setUrl, setSubmitEnabled, setBalanceVisible } =
      setup(origin + '#/home', true);
    setSubmitEnabled(false);
    onPoll((attempt) => {
      if (attempt === 0) setUrl(origin + '#/');
      if (attempt === 1) {
        setUrl(origin + '#/home');
        setBalanceVisible(true);
      }
    });
    await wallet.ensureOnHome();
    expect(wallet.unlock).not.toHaveBeenCalled();
  });

  it('ignores a non-login unlock button while Home is still mounting', async () => {
    const { wallet, page, onPoll, setBalanceVisible } = setup(
      origin + '#/home'
    );
    setBalanceVisible(false);
    const originalLocator = page.locator.getMockImplementation()!;
    page.locator.mockImplementation((selector: string) =>
      selector === '#unlock-btn'
        ? {
            isVisible: jest.fn(async () => true),
            isEnabled: jest.fn(async () => true),
          }
        : originalLocator(selector)
    );
    onPoll((attempt) => {
      if (attempt === 1) setBalanceVisible(true);
    });
    await wallet.ensureOnHome();
    expect(wallet.unlock).not.toHaveBeenCalled();
  });

  it('fails readiness instead of authenticating when the locked form stays busy', async () => {
    const { wallet, onPoll, setUrl, setSubmitEnabled } = setup(
      origin + '#/home',
      true
    );
    setSubmitEnabled(false);
    onPoll(() => setUrl(origin + '#/'));
    await expect(wallet.ensureOnHome()).rejects.toThrow(
      'Home did not become ready'
    );
    expect(wallet.unlock).not.toHaveBeenCalled();
  });

  it('never waits on a removed unlock locator when Login transitions to Home between reads', async () => {
    const fixture = setup(origin + '#/home', true);
    const finishNavigation = () => {
      fixture.setUrl(origin + '#/home');
      fixture.setControlsVisible(false);
      fixture.setBalanceVisible(true);
    };
    fixture.onPoll((attempt) => {
      if (attempt === 0) fixture.setUrl(origin + '#/');
    });
    // Reproduce the old multi-call boundary: Login was visible, then its
    // document transitioned before the separate waiting enabled query.
    fixture.unlock.isVisible.mockImplementation(async () => {
      finishNavigation();
      return true;
    });
    // The new atomic snapshot can finish just before the same transition;
    // its existing pre-submit recheck must then decline the stale unlock.
    fixture.afterSnapshot(finishNavigation);
    await fixture.wallet.ensureOnHome();
    expect(fixture.unlock.isEnabled).not.toHaveBeenCalled();
    expect(fixture.wallet.unlock).not.toHaveBeenCalled();
    expect(fixture.page.evaluate).toHaveBeenCalledTimes(2);
    expect(fixture.balance.waitFor).toHaveBeenCalledTimes(1);
  });

  it.each(['hidden', 'collapsed', 'zero-size', 'aria-disabled'])(
    'does not authenticate a %s login control',
    async (kind) => {
      const fixture = setup(origin + '#/home', true);
      const button = document.querySelector<HTMLButtonElement>('#unlock-btn')!;
      if (kind === 'hidden') button.style.visibility = 'hidden';
      if (kind === 'collapsed') button.style.visibility = 'collapse';
      if (kind === 'zero-size')
        jest.spyOn(button, 'getBoundingClientRect').mockReturnValue({
          width: 0,
          height: 0,
        } as DOMRect);
      if (kind === 'aria-disabled')
        button.setAttribute('aria-disabled', 'true');
      // Keep the deliberately unusable DOM state when changing route.
      fixture.onPoll(() => {
        fixture.setUrl(origin + '#/');
        if (kind === 'hidden') button.style.visibility = 'hidden';
        if (kind === 'collapsed') button.style.visibility = 'collapse';
      });
      await expect(fixture.wallet.ensureOnHome()).rejects.toThrow(
        'Home did not become ready'
      );
      expect(fixture.wallet.unlock).not.toHaveBeenCalled();
      expect(fixture.unlock.isEnabled).not.toHaveBeenCalled();
    }
  );
});
