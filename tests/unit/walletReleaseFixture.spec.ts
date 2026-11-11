import { launchExtension } from '../../e2e/harness/launch';
import { PaliWallet } from '../../e2e/harness/pali';
import {
  fulfillOfflineWalletRelease,
  installOfflineWalletRelease,
} from '../../e2e/harness/walletReleaseFixture';
import { WALLET_RELEASE_FEED_URL } from '../../source/shared/walletRelease';

import type { Page, Route } from '@playwright/test';

jest.mock('../../e2e/harness/launch', () => ({ launchExtension: jest.fn() }));
jest.mock('../../e2e/harness/runtimeIdentity', () => ({
  verifyExecutingWorker: jest.fn(),
}));
jest.mock('../../e2e/harness/summary', () => ({
  JourneySummary: jest.fn(() => ({ addStep: jest.fn(), finish: jest.fn() })),
}));

const fixtureRoute = (
  url = WALLET_RELEASE_FEED_URL,
  method = 'GET',
  body: string | null = null
) => ({
  request: () => ({
    url: () => url,
    method: () => method,
    postData: () => body,
  }),
  fulfill: jest.fn().mockResolvedValue(undefined),
  abort: jest.fn().mockResolvedValue(undefined),
});

afterEach(() => jest.restoreAllMocks());

it('fulfills only the known public GET with a deterministic empty release feed', async () => {
  const route = fixtureRoute();
  await fulfillOfflineWalletRelease(route as unknown as Route);
  expect(route.fulfill).toHaveBeenCalledWith({
    status: 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
    body: '{"version":1,"releases":[]}',
  });
  expect(route.abort).not.toHaveBeenCalled();
});

it.each([
  [WALLET_RELEASE_FEED_URL, 'POST', null],
  [WALLET_RELEASE_FEED_URL, 'HEAD', null],
  [WALLET_RELEASE_FEED_URL, 'GET', 'unexpected body'],
  [WALLET_RELEASE_FEED_URL + '?unexpected=1', 'GET', null],
  [WALLET_RELEASE_FEED_URL + '#fragment', 'GET', null],
])(
  'rejects altered method, query or body: %s %s',
  async (url, method, body) => {
    const route = fixtureRoute(url, method, body);
    await expect(
      fulfillOfflineWalletRelease(route as unknown as Route)
    ).rejects.toThrow('Unexpected offline wallet release request');
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(route.fulfill).not.toHaveBeenCalled();
  }
);

it('intercepts only the fixed feed origin and path, including invalid query variants', async () => {
  const page = { route: jest.fn().mockResolvedValue(undefined) };
  await installOfflineWalletRelease(page as unknown as Page);
  const [matches, handler] = page.route.mock.calls[0];
  expect(matches(new URL(WALLET_RELEASE_FEED_URL))).toBe(true);
  expect(matches(new URL(WALLET_RELEASE_FEED_URL + '?unexpected=1'))).toBe(
    true
  );
  expect(
    matches(
      new URL(
        'https://other.invalid' + new URL(WALLET_RELEASE_FEED_URL).pathname
      )
    )
  ).toBe(false);
  expect(matches(new URL('https://raw.githubusercontent.com/unrelated'))).toBe(
    false
  );
  expect(handler).toBe(fulfillOfflineWalletRelease);
});

it.each([true, false])(
  'installs the fixture before wallet navigation only for fenced launches (%s)',
  async (fenced) => {
    let finishRoute!: () => void;
    const routeReady = new Promise<void>((resolve) => {
      finishRoute = resolve;
    });
    const page = { route: jest.fn(() => routeReady) };
    const context = { pages: () => [page], close: jest.fn() };
    (launchExtension as jest.Mock).mockResolvedValue({
      context,
      extensionId: 'fixture',
      profileDir: '/fixture',
    });
    const navigate = jest
      .spyOn(PaliWallet.prototype, 'gotoRoute')
      .mockResolvedValue(undefined);
    const pending = PaliWallet.launch(
      'release-feed-fixture',
      fenced ? { offlineHttpProxy: 'http://127.0.0.1:61421' } : {}
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    if (fenced) {
      expect(page.route).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();
    } else expect(page.route).not.toHaveBeenCalled();
    finishRoute();
    await pending;
    expect(navigate).toHaveBeenCalledWith('#/');
    if (fenced)
      expect(page.route.mock.invocationCallOrder[0]).toBeLessThan(
        navigate.mock.invocationCallOrder[0]
      );
  }
);
