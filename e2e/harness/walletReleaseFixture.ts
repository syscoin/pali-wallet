import { WALLET_RELEASE_FEED_URL } from '../../source/shared/walletRelease';

import type { Page, Route } from '@playwright/test';

const feed = new URL(WALLET_RELEASE_FEED_URL);

/** A fixed public-metadata response for launch-time fenced wallet fixtures. */
export async function fulfillOfflineWalletRelease(route: Route) {
  const request = route.request();
  if (
    request.url() !== WALLET_RELEASE_FEED_URL ||
    request.method() !== 'GET' ||
    request.postData() !== null
  ) {
    await route.abort('blockedbyclient');
    throw new Error('Unexpected offline wallet release request');
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ version: 1, releases: [] }),
  });
}

export async function installOfflineWalletRelease(page: Page) {
  // Page routes take precedence over later context-level deny handlers.
  // Match malformed variants too so a query/body/method cannot be hidden.
  await page.route(
    (url) => url.origin === feed.origin && url.pathname === feed.pathname,
    fulfillOfflineWalletRelease
  );
}
